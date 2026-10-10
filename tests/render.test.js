import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoPattern, pianoDemoPattern, STEPS } from '../src/lib/pattern.js';
import { patternEvents, renderPattern } from '../src/lib/render.js';
import { encodeMp3, encodeWav } from '../src/lib/audiofile.js';
import { resolvePreset } from '../src/lib/presets.js';
import { PHYS_PARAMS } from '../src/dsp/params.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';

const SR = 48000;

test('pattern events: one note-on / note-off per note per loop, at the sequencer timing', () => {
  const p = demoPattern();
  const { ev, length } = patternEvents(p, SR, 2);
  const stepDur = 60 / p.bpm / 4;
  assert.equal(length, Math.round(2 * STEPS * stepDur * SR));
  assert.equal(ev.synth.filter((e) => e[1] === 0x90).length, 2 * p.notes.length);
  assert.equal(ev.synth.filter((e) => e[1] === 0x80).length, 2 * p.notes.length);
  assert.equal(ev.drums.length, 2 * p.drums.length);
  assert.equal(ev.phys.length, 0);
  const first = p.notes.find((n) => n.start === 1) ?? p.notes[0];
  assert.ok(ev.synth.some((e) => e[1] === 0x90 && e[2] === first.note && e[0] === Math.round(first.start * stepDur * SR)));
  for (const k of ['synth', 'drums']) for (let i = 1; i < ev[k].length; i++) assert.ok(ev[k][i][0] >= ev[k][i - 1][0]);
});

test('render: the whole pattern plus its tail, finite, audible, and it ends', () => {
  const p = pianoDemoPattern();
  const params = { phys: resolvePreset(PHYS_PARAMS, PHYS_PRESETS.find((x) => x.name === 'Grand Piano')) };
  const res = renderPattern({ pattern: p, params, sampleRate: SR, loops: 1, maxTail: 6 });
  const len = Math.round(STEPS * (60 / p.bpm / 4) * SR);
  assert.ok(res.left.length > len && res.left.length <= len + 6 * SR, `${res.left.length} frames`);
  assert.ok(res.left.every(Number.isFinite) && res.right.every(Number.isFinite));
  assert.ok(res.peak > 0.05 && res.peak <= 2, `peak ${res.peak}`);
  // the pp opening is quieter than the ff third bar
  const rms = (a, b) => {
    let e = 0;
    for (let i = a; i < b; i++) e += res.left[i] ** 2;
    return Math.sqrt(e / (b - a));
  };
  const bar = Math.floor(len / 4);
  const half = Math.floor(bar / 2);
  assert.ok(rms(2 * bar, 2 * bar + half) > 2 * rms(0, half), `crescendo ${rms(0, half)} -> ${rms(2 * bar, 2 * bar + half)}`);
});

test('WAV and MP3 encoders produce valid files', async () => {
  const n = SR;
  const l = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / SR));
  const r = l.map((x) => -x);
  const wav = encodeWav(l, r, SR);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), SR);
  assert.equal(wav.length, 44 + n * 4);
  assert.ok(Math.abs(v.getInt16(44 + 4 * 27, true) / 32767 - l[27]) < 1e-4);
  assert.ok(Math.abs(v.getInt16(44 + 4 * 27 + 2, true) / 32768 - r[27]) < 1e-4, 'right channel');
  const mp3 = await encodeMp3(l, r, SR, 192);
  // ~1 s at 192 kbit/s = ~24 kB, starting with an MPEG frame sync
  assert.ok(mp3.length > 20000 && mp3.length < 30000, `${mp3.length} bytes`);
  assert.equal(mp3[0], 0xff);
  assert.equal(mp3[1] & 0xe0, 0xe0);
});
