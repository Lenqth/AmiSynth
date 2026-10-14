// Standard MIDI File (format 1) export of the 4-bar pattern or the whole song, so it can be dropped
// into REAPER onto the AmiSynth JSFX instruments.
//   track 0: tempo, track 1: melodic notes (channel 1), track 2: drums (channel 10)
// And import of SMF format 0 / 1 files (quantized to the 16th-step grid; channel 10 -> drum steps).

import { DRUM_PARTS } from '../dsp/params.js';
import { STEPS, STEPS_PER_BEAT } from './pattern.js';
import { BPM_MAX, BPM_MIN } from './song.js';

const PPQ = 480;
const TICKS_PER_STEP = PPQ / STEPS_PER_BEAT;

function vlq(n) {
  const bytes = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return bytes;
}

function chunk(type, data) {
  const len = data.length;
  return [...type].map((c) => c.charCodeAt(0)).concat([(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255], data);
}

/** events: [tick, bytes[]] -> track chunk (sorted, delta-timed, with end-of-track) */
function track(events, name) {
  const named = [[0, [0xff, 0x03, ...vlq(name.length), ...[...name].map((c) => c.charCodeAt(0) & 0x7f)]], ...events];
  // note-offs before note-ons at the same tick so repeated notes retrigger
  named.sort((a, b) => a[0] - b[0] || ((a[1][0] & 0xf0) === 0x80 ? -1 : 0) - ((b[1][0] & 0xf0) === 0x80 ? -1 : 0));
  const data = [];
  let last = 0;
  for (const [tick, bytes] of named) {
    data.push(...vlq(tick - last), ...bytes);
    last = tick;
  }
  data.push(0, 0xff, 0x2f, 0x00);
  return chunk('MTrk', data);
}

/** @param {import('./song.js').Timeline} tl patterns played one after another @returns {Uint8Array} */
export function timelineToMidi(tl) {
  const usPerBeat = Math.round(60000000 / tl.bpm);
  const tempo = track([[0, [0xff, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255]], [0, [0xff, 0x58, 0x04, 4, 2, 24, 8]]], 'AmiSynth');
  const melodic = [];
  const drums = [];
  tl.entries.forEach(({ pattern }, i) => {
    const base = i * STEPS * TICKS_PER_STEP;
    for (const n of pattern.notes) {
      const on = base + n.start * TICKS_PER_STEP;
      melodic.push([on, [0x90, n.note & 127, Math.max(1, Math.min(127, n.vel))]]);
      melodic.push([on + n.len * TICKS_PER_STEP, [0x80, n.note & 127, 0]]);
    }
    for (const h of pattern.drums) {
      const on = base + h.step * TICKS_PER_STEP;
      drums.push([on, [0x99, h.note & 127, Math.max(1, Math.min(127, h.vel))]]);
      drums.push([on + TICKS_PER_STEP / 2, [0x89, h.note & 127, 0]]);
    }
  });
  const header = chunk('MThd', [0, 1, 0, 3, (PPQ >> 8) & 255, PPQ & 255]);
  const inst = tl.melodic === 'phys' ? 'AmiSynth Physical' : 'AmiSynth Synth';
  return new Uint8Array([...header, ...tempo, ...track(melodic, inst), ...track(drums, 'AmiSynth Drums')]);
}

/** @param {import('./pattern.js').Pattern} pattern @returns {Uint8Array} */
export function patternToMidi(pattern) {
  return timelineToMidi({ bpm: pattern.bpm, melodic: pattern.melodic === 'phys' ? 'phys' : 'synth', entries: [{ pattern, slot: -1, index: 0 }] });
}

/** Save bytes as a .mid download (browser only). */
export function downloadMidi(bytes, filename) {
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadPatternMidi(pattern, filename = 'amisynth-pattern.mid') {
  downloadMidi(patternToMidi(pattern), filename);
}

// ---- import ------------------------------------------------------------------------------

/** Largest file / event count we try to read (the file is untrusted input). */
export const MIDI_MAX_BYTES = 4 * 1024 * 1024;
const MAX_NOTE_EVENTS = 200000;

/**
 * GM percussion (channel 10) -> the AmiSynth drum part that plays it. The parts themselves map to
 * themselves; similar GM sounds are folded onto the nearest part; anything else is dropped.
 */
export const GM_DRUM_MAP = (() => {
  /** @type {Record<number, number>} */
  const m = {};
  for (const p of DRUM_PARTS) m[p.note] = p.note;
  const alias = {
    35: 36, // acoustic bass drum -> kick
    40: 38, // electric snare -> snare
    44: 42, // pedal hi-hat -> closed hat
    41: 45, 43: 45, // low floor / high floor tom -> low tom
    48: 50, // hi-mid tom -> high tom
    52: 49, 55: 49, 57: 49, // china / splash / crash 2 -> crash
    53: 51, 59: 51, // ride bell / ride 2 -> ride
    54: 70, 69: 70, 82: 70, // tambourine / cabasa / shaker -> shaker
    31: 37, // sticks -> rimshot
  };
  for (const [from, to] of Object.entries(alias)) m[Number(from)] = to;
  return m;
})();

/**
 * Parse a Standard MIDI File (format 0 or 1, PPQ timing).
 * @param {Uint8Array} bytes
 * @returns {{format:number, ppq:number, tempo:number|null, tempoChanges:number,
 *   notes: {ch:number, note:number, vel:number, on:number, off:number}[], lastTick:number}}
 *   notes in ticks (note-on/off paired per channel and key, first-in first-out)
 */
export function parseMidi(bytes) {
  const u = bytes;
  if (!(u instanceof Uint8Array)) throw new Error('MIDI データではありません');
  if (u.length > MIDI_MAX_BYTES) throw new Error('MIDI ファイルが大きすぎます');
  const str = (o) => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
  const u32 = (o) => ((u[o] << 24) >>> 0) + ((u[o + 1] << 16) | (u[o + 2] << 8) | u[o + 3]);
  if (u.length < 14 || str(0) !== 'MThd') throw new Error('Standard MIDI File (.mid) ではありません');
  const hlen = u32(4);
  if (hlen < 6 || 8 + hlen > u.length) throw new Error('MIDI ヘッダーが壊れています');
  const format = (u[8] << 8) | u[9];
  const ntracks = (u[10] << 8) | u[11];
  const division = (u[12] << 8) | u[13];
  if (format > 1) throw new Error(`MIDI format ${format} には対応していません (format 0 / 1 のみ)`);
  if (division & 0x8000) throw new Error('SMPTE タイムベースの MIDI には対応していません');
  const ppq = division;
  if (ppq === 0) throw new Error('MIDI の分解能 (PPQ) が 0 です');
  let o = 8 + hlen;
  /** @type {{tick:number, order:number, kind:'on'|'off'|'tempo', ch?:number, note?:number, vel?:number, us?:number}[]} */
  const events = [];
  let order = 0;
  let lastTick = 0;
  for (let t = 0; t < ntracks && o + 8 <= u.length; t++) {
    const len = u32(o + 4);
    const isTrack = str(o) === 'MTrk';
    const start = o + 8;
    const end = Math.min(u.length, start + len);
    o = start + len;
    if (!isTrack) continue; // unknown chunk: skip
    let p = start;
    let tick = 0;
    let running = 0;
    const vlqAt = () => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) throw new Error('MIDI トラックが途中で切れています');
        const b = u[p++];
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new Error('MIDI の可変長数値が不正です');
    };
    while (p < end) {
      tick += vlqAt();
      if (p >= end) break;
      let status = u[p];
      if (status === 0xff) {
        const type = u[p + 1];
        p += 2;
        const l = vlqAt();
        if (p + l > end) throw new Error('MIDI メタイベントが途中で切れています');
        if (type === 0x51 && l === 3) events.push({ tick, order: order++, kind: 'tempo', us: (u[p] << 16) | (u[p + 1] << 8) | u[p + 2] });
        p += l;
        if (type === 0x2f) break; // end of track
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        p++;
        const l = vlqAt();
        p += l;
        continue;
      }
      if (status & 0x80) {
        running = status;
        p++;
      } else if (running) {
        status = running;
      } else {
        throw new Error('MIDI データが不正です (ランニングステータスなし)');
      }
      const type = status & 0xf0;
      const n = type === 0xc0 || type === 0xd0 ? 1 : 2;
      if (p + n > end) throw new Error('MIDI イベントが途中で切れています');
      const d1 = u[p] & 0x7f;
      const d2 = n === 2 ? u[p + 1] & 0x7f : 0;
      p += n;
      if (type === 0x90 || type === 0x80) {
        if (events.length >= MAX_NOTE_EVENTS) throw new Error('MIDI のノートが多すぎます');
        const on = type === 0x90 && d2 > 0;
        events.push({ tick, order: order++, kind: on ? 'on' : 'off', ch: status & 0x0f, note: d1, vel: d2 });
      }
      lastTick = Math.max(lastTick, tick);
    }
    lastTick = Math.max(lastTick, tick);
  }
  // merge the tracks in time order (format 1), keeping the file order at equal ticks
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let tempo = null;
  let tempoChanges = 0;
  /** @type {Map<number, {vel:number, on:number}[]>} */
  const open = new Map();
  const notes = [];
  for (const e of events) {
    if (e.kind === 'tempo') {
      if (tempo === null) tempo = e.us;
      else if (e.us !== tempo) tempoChanges++;
      continue;
    }
    const key = e.ch * 128 + e.note;
    if (e.kind === 'on') {
      if (!open.has(key)) open.set(key, []);
      open.get(key).push({ vel: e.vel, on: e.tick });
    } else {
      const q = open.get(key);
      const n = q?.shift();
      if (n) notes.push({ ch: e.ch, note: e.note, vel: n.vel, on: n.on, off: e.tick });
    }
  }
  // notes never released: end them at the end of the file
  for (const [key, q] of open) for (const n of q) notes.push({ ch: Math.floor(key / 128), note: key % 128, vel: n.vel, on: n.on, off: Math.max(n.on, lastTick) });
  notes.sort((a, b) => a.on - b.on || a.note - b.note);
  return { format, ppq, tempo, tempoChanges, notes, lastTick };
}

/**
 * Notes of a parsed MIDI file on the 16th-step grid, counted from the start of the file:
 * channel 10 -> drum hits (GM_DRUM_MAP), everything else -> piano-roll notes.
 * @param {ReturnType<typeof parseMidi>} midi
 * @param {{lowNote?:number, highNote?:number, maxSteps?:number}} [opts]
 */
export function midiToSteps(midi, opts = {}) {
  const low = opts.lowNote ?? 0;
  const high = opts.highNote ?? 127;
  const maxSteps = opts.maxSteps ?? Infinity;
  const perStep = midi.ppq / STEPS_PER_BEAT;
  const warnings = [];
  const notes = [];
  /** @type {Map<number, {note:number, step:number, vel:number}>} */
  const drums = new Map();
  const seen = new Set();
  let unmapped = 0;
  let outOfRange = 0;
  let beyond = 0;
  for (const n of midi.notes) {
    const start = Math.round(n.on / perStep);
    if (start >= maxSteps) {
      beyond++;
      continue;
    }
    if (n.ch === 9) {
      const note = GM_DRUM_MAP[n.note];
      if (note === undefined) {
        unmapped++;
        continue;
      }
      const key = start * 128 + note;
      const prev = drums.get(key);
      if (!prev || prev.vel < n.vel) drums.set(key, { note, step: start, vel: n.vel });
      continue;
    }
    if (n.note < low || n.note > high) {
      outOfRange++;
      continue;
    }
    const end = Math.round(n.off / perStep);
    const key = `${start}:${n.note}`;
    if (seen.has(key)) continue; // same key at the same step (e.g. doubled on two channels)
    seen.add(key);
    notes.push({ note: n.note, start, len: Math.max(1, end - start), vel: n.vel });
  }
  if (unmapped) warnings.push(`対応するドラムパートがない ch10 のノート ${unmapped} 個を省きました`);
  if (outOfRange) warnings.push(`ピアノロールの音域外のノート ${outOfRange} 個を省きました`);
  if (beyond) warnings.push(`読み込める長さを超えた ${beyond} 個のノートを省きました`);
  if (midi.tempoChanges) warnings.push('テンポチェンジは最初のテンポだけを使いました');
  const bpm = midi.tempo ? Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round((60000000 / midi.tempo) * 100) / 100)) : null;
  return { bpm, notes, drums: [...drums.values()].sort((a, b) => a.step - b.step || a.note - b.note), warnings };
}
