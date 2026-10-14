import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultValues, DRUM_PARAMS, PHYS_PARAMS, SYNTH_PARAMS } from '../src/dsp/params.js';
import {
  buildSharePayload, decodeShare, deflate, encodeShare, fromBase64Url, parseSharePayload, SHARE_MAX_JSON, SHARE_PREFIX, toBase64Url,
} from '../src/lib/share.js';
import { addPattern, addSlot, demoSong, MAX_PATTERNS } from '../src/lib/song.js';
import { resolvePreset } from '../src/lib/presets.js';
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';

function state() {
  const song = demoSong();
  addPattern(song);
  song.patterns[1].name = 'Bridge 日本語';
  song.patterns[1].notes.push({ note: 72, start: 63, len: 1, vel: 1 });
  addSlot(song, 0);
  addSlot(song, 1);
  song.arrangement[0].repeat = 3;
  song.bpm = 101.5;
  song.melodic = 'phys';
  song.current = 1;
  const synth = resolvePreset(SYNTH_PARAMS, SYNTH_PRESETS[5]);
  synth.tuning_divisions = 19;
  synth.tuning_ref_hz = 432;
  const phys = resolvePreset(PHYS_PARAMS, PHYS_PRESETS[3], synth);
  const drums = defaultValues(DRUM_PARAMS);
  drums[DRUM_PARAMS[0].id] = DRUM_PARAMS[0].max;
  return { song, mode: 'song', synth, phys, drums, scale: { name: 'Pelog-ish', cents: [120, 270, 540, 670, 785, 950, 1200] } };
}

const encodeJson = async (obj) => SHARE_PREFIX + toBase64Url(await deflate(new TextEncoder().encode(JSON.stringify(obj))));

test('share link round trip: song, mode, sounds (as diffs), tuning and scale', async () => {
  const s = state();
  const frag = await encodeShare(s);
  assert.ok(frag.startsWith('s1.'));
  assert.match(frag.slice(3), /^[A-Za-z0-9_-]+$/, 'URL-safe');
  assert.ok(frag.length < 4000, `${frag.length} chars`);
  const out = await decodeShare(`#${frag}`);
  assert.deepEqual(out.song, s.song);
  assert.equal(out.mode, 'song');
  assert.deepEqual(out.synth, s.synth);
  assert.deepEqual(out.phys, s.phys);
  assert.deepEqual(out.drums, s.drums);
  assert.deepEqual(out.scale, s.scale);
  // payload holds only differences from the defaults
  const payload = buildSharePayload(s);
  assert.deepEqual(payload.tuning, { tuning_divisions: 19, tuning_ref_hz: 432 });
  assert.ok(!Object.keys(payload.params.synth).some((id) => id.startsWith('tuning_')));
  assert.equal(Object.keys(payload.params.drums).length, 1);
  // all defaults, no scale
  const plain = { song: demoSong(), mode: 'pattern', synth: defaultValues(SYNTH_PARAMS), phys: defaultValues(PHYS_PARAMS), drums: defaultValues(DRUM_PARAMS), scale: null };
  const back = await decodeShare(await encodeShare(plain));
  assert.deepEqual(back, plain);
});

test('share link: hostile / malformed values are clamped or dropped', async () => {
  const frag = await encodeJson({
    v: 1,
    bpm: 1e9,
    melodic: '<script>',
    mode: 'evil',
    current: -5,
    patterns: [
      { name: '<img src=x onerror=alert(1)>'.repeat(5), notes: [[60, 0, 4, 100], [999, 0, 1, 1], [60, 70, 1, 1], 'x', [62, 1.4, 1e6, -3], null], drums: [[36, 0, 300], [36, 0, 1], [36, -1, 1]] },
      ...Array.from({ length: MAX_PATTERNS + 10 }, () => ({ name: 'p' })),
    ],
    arrangement: [[0, 1e6], [9999, 1], ['0', 1], [1], null],
    params: {
      synth: { filter_cutoff_hz: 1e12, osc1_waveform: 2.7, tuning_divisions: 5, not_a_param: 3, amp_attack_ms: 'NaN' },
      phys: [1, 2, 3],
      drums: null,
    },
    tuning: { tuning_divisions: 1e9, tuning_period_cents: -1, tuning_ref_hz: Infinity },
    scale: { name: 'x', cents: [700, 500, 1200] },
  });
  const out = await decodeShare(frag);
  assert.equal(out.song.bpm, 240);
  assert.equal(out.song.melodic, 'synth');
  assert.equal(out.mode, 'pattern');
  assert.equal(out.song.current, 0);
  assert.equal(out.song.patterns.length, MAX_PATTERNS);
  const a = out.song.patterns[0];
  assert.equal(a.name.length, 24);
  assert.deepEqual(a.notes, [{ note: 60, start: 0, len: 4, vel: 100 }, { note: 62, start: 1, len: 63, vel: 1 }]);
  assert.deepEqual(a.drums, [{ note: 36, step: 0, vel: 127 }]);
  assert.deepEqual(out.song.arrangement, [{ pattern: a.id, repeat: 16 }, { pattern: out.song.patterns[1].id, repeat: 1 }]);
  const cutoff = SYNTH_PARAMS.find((d) => d.id === 'filter_cutoff_hz');
  assert.equal(out.synth.filter_cutoff_hz, cutoff.max);
  assert.ok(Number.isInteger(out.synth.osc1_waveform));
  assert.ok(!('not_a_param' in out.synth));
  assert.equal(out.synth.amp_attack_ms, SYNTH_PARAMS.find((d) => d.id === 'amp_attack_ms').default);
  // tuning only from the tuning block, clamped; shared by both melodic instruments
  assert.equal(out.synth.tuning_divisions, 72);
  assert.equal(out.synth.tuning_period_cents, 100);
  assert.equal(out.synth.tuning_ref_hz, 440);
  assert.equal(out.phys.tuning_divisions, 72);
  assert.deepEqual(out.phys, { ...defaultValues(PHYS_PARAMS), tuning_divisions: 72, tuning_period_cents: 100 });
  assert.deepEqual(out.drums, defaultValues(DRUM_PARAMS));
  assert.equal(out.scale, null, 'non-ascending scale rejected');
  for (const v of Object.values(out.synth)) assert.ok(Number.isFinite(v));
});

test('share link: "__proto__" keys in the JSON neither pollute nor set params', async () => {
  const text = '{"v":1,"__proto__":{"bpm":200},"patterns":[{"__proto__":{"name":"X"}}],'
    + '"params":{"synth":{"__proto__":{"filter_cutoff_hz":5,"polluted":1}}},"tuning":{"__proto__":{"tuning_divisions":7}}}';
  const out = await decodeShare(SHARE_PREFIX + toBase64Url(await deflate(new TextEncoder().encode(text))));
  assert.equal(out.song.bpm, 120);
  assert.equal(out.song.patterns[0].name, 'A');
  assert.deepEqual(out.synth, defaultValues(SYNTH_PARAMS));
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('share link: rejects what is not an AmiSynth share', async () => {
  await assert.rejects(decodeShare('#nope'), /共有リンクではありません/);
  await assert.rejects(decodeShare('#s1.'), /長さ/);
  await assert.rejects(decodeShare('#s1.abc$%^'), /文字が不正/);
  await assert.rejects(decodeShare(`#s1.${'A'.repeat(300000)}`), /長さ/);
  await assert.rejects(decodeShare('#s1.AAAAAAAAAAAA'), /展開できません/);
  await assert.rejects(decodeShare(`#s1.${toBase64Url(new Uint8Array([1, 2, 3, 4, 5]))}`), /展開できません/);
  await assert.rejects(decodeShare(SHARE_PREFIX + toBase64Url(await deflate(new TextEncoder().encode('{not json')))), /JSON/);
  await assert.rejects(decodeShare(await encodeJson({ v: 2 })), /形式/);
  await assert.rejects(decodeShare(await encodeJson([1, 2])), /形式/);
  await assert.rejects(decodeShare(await encodeJson(null)), /形式/);
  // decompression bomb: tiny link, huge output
  const bomb = SHARE_PREFIX + toBase64Url(await deflate(new Uint8Array(SHARE_MAX_JSON + 1024).fill(32)));
  assert.ok(bomb.length < 10000);
  await assert.rejects(decodeShare(bomb), /大きすぎ/);
  assert.throws(() => parseSharePayload('string'), /形式/);
  assert.deepEqual([...fromBase64Url(toBase64Url(new Uint8Array([0, 255, 250, 1])))], [0, 255, 250, 1]);
});
