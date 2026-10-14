// Share by URL: the song (patterns + arrangement), the instrument sounds (as diffs from the defaults,
// like presets) and the tuning, packed into the URL fragment:
//
//   #s1.<base64url(deflate-raw(JSON))>
//
// "s1." is the format version. The fragment never reaches a server. Everything decoded from a URL
// is untrusted: sizes are capped before and after decompression, and every value is validated and
// clamped (sanitizeSong / clampParam) — unknown or malformed fields are dropped.

import { clampParam, defaultValues, DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS } from '../dsp/params.js';
import { diffFromDefaults } from './presets.js';
import { MAX_PATTERNS, MAX_SLOTS, sanitizeSong } from './song.js';

export const SHARE_PREFIX = 's1.';
/** longest fragment we accept (characters after '#') */
export const SHARE_MAX_CHARS = 200000;
/** largest decompressed JSON we accept (bytes) */
export const SHARE_MAX_JSON = 2 * 1024 * 1024;
const MAX_SCALE = 255;

const DEFS = { synth: SYNTH_PARAMS, phys: PHYS_PARAMS, drums: DRUM_PARAMS };
const TUNING_DEFS = SYNTH_PARAMS.filter((d) => d.id.startsWith('tuning_'));

// ---- bytes <-> base64url ------------------------------------------------------------------

export function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('共有リンクの文字が不正です');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  let bin;
  try {
    bin = atob(b64);
  } catch {
    throw new Error('共有リンクを読めません (base64)');
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream, maxOut) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxOut) {
      reader.cancel().catch(() => {});
      throw new Error('共有リンクのデータが大きすぎます');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'), Infinity);

export async function inflate(bytes, maxOut = SHARE_MAX_JSON) {
  try {
    return await pipe(bytes, new DecompressionStream('deflate-raw'), maxOut);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('共有リンク')) throw e;
    throw new Error('共有リンクを展開できません (データが壊れています)');
  }
}

// ---- payload (compact JSON) -----------------------------------------------------------------

/**
 * The JSON object stored in a share link.
 * @param {{song: import('./song.js').Song, mode: string, synth: object, phys: object, drums: object,
 *   scale: {name:string, cents:number[]} | null}} s
 */
export function buildSharePayload(s) {
  const song = s.song;
  const tuning = {};
  for (const d of TUNING_DEFS) if (Math.abs(s.synth[d.id] - d.default) > 1e-9) tuning[d.id] = s.synth[d.id];
  return {
    v: 1,
    bpm: song.bpm,
    melodic: song.melodic,
    mode: s.mode === 'song' ? 'song' : 'pattern',
    current: song.current,
    // notes as [note, start, len, vel], hits as [note, step, vel]: about half the size of objects
    patterns: song.patterns.map((p) => ({
      name: p.name,
      notes: p.notes.map((n) => [n.note, n.start, n.len, n.vel]),
      drums: p.drums.map((h) => [h.note, h.step, h.vel]),
    })),
    // [pattern index, repeat]
    arrangement: song.arrangement.map((a) => [song.patterns.findIndex((p) => p.id === a.pattern), a.repeat]),
    params: {
      synth: diffFromDefaults(SYNTH_PARAMS, s.synth),
      phys: diffFromDefaults(PHYS_PARAMS, s.phys),
      drums: diffFromDefaults(DRUM_PARAMS, s.drums),
    },
    tuning,
    scale: s.scale ? { name: s.scale.name, cents: [...s.scale.cents] } : null,
  };
}

/** Full parameter values from untrusted {id: value} diffs (tuning ids are ignored here). */
function paramsFrom(defs, raw) {
  const v = defaultValues(defs);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return v;
  for (const d of defs) {
    if (d.id.startsWith('tuning_') || !Object.hasOwn(raw, d.id)) continue;
    const x = raw[d.id];
    if (typeof x === 'number' && Number.isFinite(x)) v[d.id] = clampParam(d, x);
  }
  return v;
}

/** A Scala-style scale ({name, cents}: positive, ascending, at most 255 degrees) or null. */
export function sanitizeScale(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cents)) return null;
  const cents = raw.cents;
  if (cents.length < 1 || cents.length > MAX_SCALE) return null;
  let prev = 0;
  for (const c of cents) {
    if (typeof c !== 'number' || !Number.isFinite(c) || c <= prev || c > 100000) return null;
    prev = c;
  }
  // eslint-disable-next-line no-control-regex
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120) : 'Custom scale';
  return { name: name || 'Custom scale', cents: [...cents] };
}

/**
 * Validate a decoded payload. Never throws for odd values (they are dropped or clamped);
 * throws only if it is not an AmiSynth share at all.
 * @returns {{song: import('./song.js').Song, mode: 'pattern'|'song', synth: Record<string,number>,
 *   phys: Record<string,number>, drums: Record<string,number>, scale: {name:string,cents:number[]}|null}}
 */
export function parseSharePayload(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.v !== 1) throw new Error('AmiSynth の共有リンクではありません (形式が違います)');
  const rawPatterns = Array.isArray(obj.patterns) ? obj.patterns.slice(0, MAX_PATTERNS) : [];
  const tuple = (a, keys) => (Array.isArray(a) ? Object.fromEntries(keys.map((k, i) => [k, a[i]])) : null);
  const song = sanitizeSong({
    bpm: obj.bpm,
    melodic: obj.melodic,
    current: obj.current,
    patterns: rawPatterns.map((p, i) => ({
      id: i,
      name: p?.name,
      notes: Array.isArray(p?.notes) ? p.notes.map((n) => tuple(n, ['note', 'start', 'len', 'vel'])) : [],
      drums: Array.isArray(p?.drums) ? p.drums.map((h) => tuple(h, ['note', 'step', 'vel'])) : [],
    })),
    arrangement: Array.isArray(obj.arrangement) ? obj.arrangement.slice(0, MAX_SLOTS).map((a) => tuple(a, ['pattern', 'repeat'])) : [],
  });
  const params = obj.params && typeof obj.params === 'object' ? obj.params : {};
  const out = {
    song,
    mode: /** @type {'pattern'|'song'} */ (obj.mode === 'song' ? 'song' : 'pattern'),
    synth: paramsFrom(DEFS.synth, params.synth),
    phys: paramsFrom(DEFS.phys, params.phys),
    drums: paramsFrom(DEFS.drums, params.drums),
    scale: sanitizeScale(obj.scale),
  };
  // tuning is shared by both melodic instruments
  const tuning = obj.tuning && typeof obj.tuning === 'object' && !Array.isArray(obj.tuning) ? obj.tuning : {};
  for (const d of TUNING_DEFS) {
    const x = Object.hasOwn(tuning, d.id) ? tuning[d.id] : undefined;
    const v = typeof x === 'number' && Number.isFinite(x) ? clampParam(d, x) : d.default;
    out.synth[d.id] = v;
    if (d.id in out.phys) out.phys[d.id] = v;
  }
  return out;
}

// ---- fragment ---------------------------------------------------------------------------------

/** @param {Parameters<typeof buildSharePayload>[0]} state @returns {Promise<string>} fragment without '#' */
export async function encodeShare(state) {
  const json = JSON.stringify(buildSharePayload(state));
  return SHARE_PREFIX + toBase64Url(await deflate(new TextEncoder().encode(json)));
}

/** Does this URL fragment (with or without '#') look like a share link? */
export function isShareFragment(hash) {
  return typeof hash === 'string' && hash.replace(/^#/, '').startsWith(SHARE_PREFIX);
}

/** @param {string} hash fragment (with or without '#') @returns {Promise<ReturnType<typeof parseSharePayload>>} */
export async function decodeShare(hash) {
  const frag = String(hash).replace(/^#/, '');
  if (!frag.startsWith(SHARE_PREFIX)) throw new Error('AmiSynth の共有リンクではありません');
  const body = frag.slice(SHARE_PREFIX.length);
  if (body.length === 0 || body.length > SHARE_MAX_CHARS) throw new Error('共有リンクの長さが不正です');
  const json = await inflate(fromBase64Url(body));
  let obj;
  try {
    obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json));
  } catch {
    throw new Error('共有リンクの中身を読めません (JSON)');
  }
  return parseSharePayload(obj);
}
