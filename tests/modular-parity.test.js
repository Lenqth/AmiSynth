// The Web and native Modular engines are separate sample loops over one catalog.
// Render the same patches and notes through both and require the same audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULAR_PRESETS, MODULAR_TYPES, modular_init, modular_midi, modular_render, modular_set_patch } from '../src/dsp/modular.js';

const win = process.platform === 'win32';
const tool = join(import.meta.dirname, '..', '.cache', 'clap-build', win ? 'Release' : '', win ? 'modular_render.exe' : 'modular_render');
const rate = 48000;
const notes = [
  { key: 48, velocity: 100, on: 0, off: 9000 },
  { key: 55, velocity: 64, on: 3000, off: 14000 },
  { key: 79, velocity: 127, on: 6000, off: 7000 },
];
const samples = 24000;

function renderWeb(patch) {
  const s = {};
  modular_init(s, rate);
  modular_set_patch(s, patch);
  const out = new Float32Array(samples);
  for (let n = 0; n < samples; n++) {
    for (const note of notes) {
      if (note.on === n) modular_midi(s, 0x90, note.key, note.velocity);
      if (note.off === n) modular_midi(s, 0x80, note.key, 0);
    }
    modular_render(s);
    out[n] = s.out_l;
  }
  return out;
}

function renderNative(patch, dir) {
  const spec = join(dir, 'spec.json'), out = join(dir, 'out.f32');
  writeFileSync(spec, JSON.stringify({ rate, samples, patch, notes }));
  execFileSync(tool, [spec, out]);
  const bytes = readFileSync(out);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

const voice = (extra, cables) => ({
  nodes: [{ id: 'note', type: 'midi' }, { id: 'out', type: 'output' }, ...extra],
  cables,
});
const PATCHES = {
  'wavefolder and soft clip': voice([
    { id: 'osc', type: 'vco', params: { wave: 0 } },
    { id: 'fold', type: 'wavefolder', params: { drive: 8, bias: 0.2 } },
    { id: 'shape', type: 'wavefolder', params: { drive: 3, shape: 1, mix: 0.6 } },
  ], [
    { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
    { from: 'osc', port: 'out', to: 'fold', input: 'in' },
    { from: 'fold', port: 'out', to: 'shape', input: 'in' },
    { from: 'shape', port: 'out', to: 'out', input: 'audio' },
  ]),
  'filter modes and key tracking': voice([
    { id: 'osc', type: 'vco', params: { wave: 1 } },
    { id: 'lp', type: 'vcf', params: { mode: 0, keytrack: 1, resonance: 0.6, cutoff: 800 } },
    { id: 'hp', type: 'vcf', params: { mode: 1, cutoff: 1500 } },
    { id: 'bp', type: 'vcf', params: { mode: 2, cutoff: 3000 } },
    { id: 'notch', type: 'vcf', params: { mode: 3, cutoff: 600 } },
    { id: 'sum', type: 'mix', params: { a: 0.5, b: 0.5 } },
    { id: 'sum2', type: 'mix', params: { a: 1, b: 0.5 } },
    { id: 'env', type: 'adsr', params: { release: 0.05 } },
    { id: 'amp', type: 'vca' },
  ], [
    { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
    { from: 'note', port: 'pitch', to: 'lp', input: 'pitch' },
    { from: 'osc', port: 'out', to: 'lp', input: 'audio' },
    { from: 'lp', port: 'out', to: 'hp', input: 'audio' },
    { from: 'osc', port: 'out', to: 'bp', input: 'audio' },
    { from: 'osc', port: 'out', to: 'notch', input: 'audio' },
    { from: 'hp', port: 'out', to: 'sum', input: 'a' },
    { from: 'bp', port: 'out', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'sum2', input: 'a' },
    { from: 'notch', port: 'out', to: 'sum2', input: 'b' },
    { from: 'sum2', port: 'out', to: 'amp', input: 'audio' },
    { from: 'note', port: 'gate', to: 'env', input: 'gate' },
    { from: 'env', port: 'out', to: 'amp', input: 'gain' },
    { from: 'amp', port: 'out', to: 'out', input: 'audio' },
  ]),
  'noise, sample and hold, slew and ring modulation': voice([
    { id: 'white', type: 'noise', params: { color: 0, level: 0.3 } },
    { id: 'pink', type: 'noise', params: { color: 1, level: 0.3 } },
    { id: 'clock', type: 'lfo', params: { rate: 13, wave: 1 } },
    { id: 'random', type: 'sh', params: { rate: 9 } },
    { id: 'stepped', type: 'sh' },
    { id: 'glide', type: 'slew', params: { rise: 0.02, fall: 0.2 } },
    { id: 'osc', type: 'vco', params: { wave: 2 } },
    { id: 'ring', type: 'ring', params: { level: 0.8 } },
    { id: 'sum', type: 'mix', params: { a: 1, b: 1 } },
    { id: 'env', type: 'adsr', params: { release: 0.1 } },
    { id: 'amp', type: 'vca' },
  ], [
    { from: 'random', port: 'out', to: 'osc', input: 'fm' },
    { from: 'white', port: 'out', to: 'stepped', input: 'in' },
    { from: 'clock', port: 'out', to: 'stepped', input: 'trigger' },
    { from: 'note', port: 'pitch', to: 'glide', input: 'in' },
    { from: 'glide', port: 'out', to: 'osc', input: 'pitch' },
    { from: 'osc', port: 'out', to: 'ring', input: 'a' },
    { from: 'stepped', port: 'out', to: 'ring', input: 'b' },
    { from: 'ring', port: 'out', to: 'sum', input: 'a' },
    { from: 'pink', port: 'out', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'amp', input: 'audio' },
    { from: 'note', port: 'gate', to: 'env', input: 'gate' },
    { from: 'env', port: 'out', to: 'amp', input: 'gain' },
    { from: 'amp', port: 'out', to: 'out', input: 'audio' },
  ]),
  'comb filter and envelope follower': voice([
    { id: 'osc', type: 'vco', params: { wave: 1 } },
    { id: 'env', type: 'adsr', params: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 } },
    { id: 'amp', type: 'vca' },
    { id: 'comb', type: 'comb', params: { time: 7.3, feedback: -0.85, damping: 0.4, mix: 0.7 } },
    { id: 'follow', type: 'follower', params: { attack: 0.002, release: 0.08, gain: 1.5 } },
    { id: 'duck', type: 'vca' },
  ], [
    { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
    { from: 'osc', port: 'out', to: 'amp', input: 'audio' },
    { from: 'note', port: 'gate', to: 'env', input: 'gate' },
    { from: 'env', port: 'out', to: 'amp', input: 'gain' },
    { from: 'amp', port: 'out', to: 'comb', input: 'in' },
    { from: 'comb', port: 'out', to: 'follow', input: 'in' },
    { from: 'comb', port: 'out', to: 'duck', input: 'audio' },
    { from: 'follow', port: 'out', to: 'duck', input: 'gain' },
    { from: 'duck', port: 'out', to: 'out', input: 'audio' },
  ]),
  'plucked string and struck modal bar': voice([
    { id: 'string', type: 'string', params: { decay: 2, release: 0.15, brightness: 0.7 } },
    { id: 'bar', type: 'modal', params: { material: 4, decay: 1.5, release: 0.3, brightness: 0.4 } },
    { id: 'tine', type: 'modal', params: { material: 7 } },
    { id: 'sum', type: 'mix', params: { a: 0.6, b: 0.6 } },
    { id: 'sum2', type: 'mix', params: { a: 1, b: 0.4 } },
  ], [
    { from: 'note', port: 'pitch', to: 'string', input: 'pitch' },
    { from: 'note', port: 'gate', to: 'string', input: 'gate' },
    { from: 'note', port: 'pitch', to: 'bar', input: 'pitch' },
    { from: 'note', port: 'gate', to: 'bar', input: 'gate' },
    { from: 'note', port: 'pitch', to: 'tine', input: 'pitch' },
    { from: 'string', port: 'out', to: 'sum', input: 'a' },
    { from: 'bar', port: 'out', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'sum2', input: 'a' },
    { from: 'tine', port: 'out', to: 'sum2', input: 'b' },
    { from: 'sum2', port: 'out', to: 'out', input: 'audio' },
  ]),
  'pulse width, hard sync, phase modulation, 24 dB slope and drive': voice([
    { id: 'master', type: 'vco', params: { wave: 0, level: 1 } },
    { id: 'slave', type: 'vco', params: { wave: 1, octave: 1, detune: 700 } },
    { id: 'pulse', type: 'vco', params: { wave: 2, pw: 0.2 } },
    { id: 'pwm', type: 'lfo', params: { rate: 4, depth: 0.3 } },
    { id: 'width', type: 'cv', params: { offset: 0.5 } },
    { id: 'carrier', type: 'vco', params: { wave: 0 } },
    { id: 'index', type: 'vca', params: { level: 2.5 } },
    { id: 'sum', type: 'mix', params: { a: 0.6, b: 0.6 } },
    { id: 'sum2', type: 'mix', params: { a: 1, b: 0.6 } },
    { id: 'filter', type: 'vcf', params: { cutoff: 900, resonance: 0.7, slope: 1, drive: 0.6, mode: 0 } },
    { id: 'bandpass', type: 'vcf', params: { cutoff: 1200, slope: 1, mode: 2 } },
    { id: 'sum3', type: 'mix', params: { a: 1, b: 1 } },
  ], [
    { from: 'note', port: 'pitch', to: 'master', input: 'pitch' },
    { from: 'note', port: 'pitch', to: 'slave', input: 'pitch' },
    { from: 'master', port: 'out', to: 'slave', input: 'sync' },
    { from: 'note', port: 'pitch', to: 'pulse', input: 'pitch' },
    { from: 'pwm', port: 'out', to: 'width', input: 'in' },
    { from: 'width', port: 'out', to: 'pulse', input: 'param:pw' },
    { from: 'note', port: 'pitch', to: 'carrier', input: 'pitch' },
    { from: 'master', port: 'out', to: 'index', input: 'audio' },
    { from: 'index', port: 'out', to: 'carrier', input: 'pm' },
    { from: 'slave', port: 'out', to: 'sum', input: 'a' },
    { from: 'pulse', port: 'out', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'sum2', input: 'a' },
    { from: 'carrier', port: 'out', to: 'sum2', input: 'b' },
    { from: 'sum2', port: 'out', to: 'filter', input: 'audio' },
    { from: 'sum2', port: 'out', to: 'bandpass', input: 'audio' },
    { from: 'filter', port: 'out', to: 'sum3', input: 'a' },
    { from: 'bandpass', port: 'out', to: 'sum3', input: 'b' },
    { from: 'sum3', port: 'out', to: 'out', input: 'audio' },
  ]),
};
// The overlapping notes exercise last-note priority, retriggering and returning to a held key.
for (const [mode, glideMode] of [[1, 0], [2, 1], [2, 0]]) {
  const patch = MODULAR_PRESETS[0].patch();
  patch.nodes.find(n => n.type === 'midi').params = { voices: mode, glide: 0.08, glideMode };
  PATCHES[`${['', 'mono', 'legato'][mode]} voice with glide mode ${glideMode}`] = patch;
}
for (const preset of MODULAR_PRESETS) PATCHES['factory: ' + preset.name] = preset.patch();

test('the parity patches use every module type', () => {
  const used = new Set(Object.values(PATCHES).flatMap(p => p.nodes.map(n => n.type)));
  assert.deepEqual([...Object.keys(MODULAR_TYPES)].filter(t => !used.has(t) && t !== 'delay' && t !== 'cv' && t !== 'macro'), []);
});

for (const [name, patch] of Object.entries(PATCHES)) {
  test(`Web and native engines render the same audio: ${name}`, { skip: !existsSync(tool) && 'modular_render unavailable' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'amisynth-parity-'));
    try {
      const web = renderWeb(patch), native = renderNative(patch, dir);
      assert.equal(native.length, web.length);
      let worst = 0, at = 0, energy = 0;
      for (let i = 0; i < web.length; i++) {
        const diff = Math.abs(web[i] - native[i]);
        if (diff > worst) { worst = diff; at = i; }
        energy += web[i] * web[i];
      }
      assert.ok(energy > 1e-3, `${name} is silent`);
      assert.ok(worst < 1e-4, `${name} differs by ${worst} at sample ${at}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
