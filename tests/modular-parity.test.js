// The Web and native Modular engines are separate sample loops over one catalog.
// Render the same patches and notes through both and require the same audio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MODULAR_PRESETS, MODULAR_TYPES, modular_init, modular_midi, modular_render, modular_set_patch, modular_transport } from '../src/dsp/modular.js';

const win = process.platform === 'win32';
const tool = join(import.meta.dirname, '..', '.cache', 'clap-build', win ? 'Release' : '', win ? 'modular_render.exe' : 'modular_render');
const rate = 48000;
const notes = [
  { key: 48, velocity: 100, on: 0, off: 9000 },
  { key: 55, velocity: 64, on: 3000, off: 14000 },
  { key: 79, velocity: 127, on: 6000, off: 7000 },
];
const samples = 24000;

function renderWeb(patch, right = false, midi = [], transport = []) {
  const s = {};
  modular_init(s, rate);
  modular_set_patch(s, patch);
  const out = new Float32Array(samples);
  for (let n = 0; n < samples; n++) {
    for (const note of notes) {
      if (note.on === n) modular_midi(s, 0x90, note.key, note.velocity);
      if (note.off === n) modular_midi(s, 0x80, note.key, 0);
    }
    for (const t of transport) if (t.at === n) modular_transport(s, t.bpm, t.playing, t.beat);
    for (const event of midi) if (event.at === n) modular_midi(s, ...event.data);
    modular_render(s);
    out[n] = right ? s.out_r : s.out_l;
  }
  return out;
}

function renderNative(patch, dir, right = false, midi = [], expressions = [], transport = []) {
  const spec = join(dir, 'spec.json'), out = join(dir, 'out.f32');
  writeFileSync(spec, JSON.stringify({ rate, samples, patch, notes, right, midi, expressions, transport }));
  execFileSync(tool, [spec, out]);
  const bytes = readFileSync(out);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

const voice = (extra, cables) => ({
  nodes: [{ id: 'note', type: 'midi' }, { id: 'out', type: 'output' }, ...extra],
  cables,
});
const PATCHES = {
  'wavetable sync, FM, and phase modulation': voice([
    { id: 'sync', type: 'vco', params: { wave: 0, octave: -1 } },
    { id: 'table', type: 'wavetable', params: { bank: 1, position: 0.67, octave: 1, phase: 0.15 } },
  ], [
    { from: 'note', port: 'pitch', to: 'sync', input: 'pitch' },
    { from: 'note', port: 'pitch', to: 'table', input: 'pitch' },
    { from: 'sync', port: 'sync', to: 'table', input: 'sync' },
    { from: 'sync', port: 'out', to: 'table', input: 'fm' },
    { from: 'sync', port: 'out', to: 'table', input: 'pm' },
    { from: 'table', port: 'out', to: 'out', input: 'audio' },
  ]),
  'looping function generator and end-of-cycle pulse': voice([
    { id: 'fn', type: 'functionGen', params: { rise: 0.003, fall: 0.01, curve: 0.3, loop: 1 } },
    { id: 'sum', type: 'mix' },
  ], [
    { from: 'fn', port: 'out', to: 'sum', input: 'a' },
    { from: 'fn', port: 'eoc', to: 'sum', input: 'b' },
    { from: 'sum', port: 'out', to: 'out', input: 'audio' },
  ]),
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
  'autonomous stereo clock division, probability, and quantized steps': {
    nodes: [
      { id: 'clock', type: 'clock', params: { bpm: 300, pulses: 12, duty: 0.25 } },
      { id: 'divide', type: 'divider', params: { division: 3 } },
      { id: 'seq', type: 'sequencer', params: { length: 3, step1: 48, step2: 51.4, step3: 55, probability: 0.7 } },
      { id: 'scale', type: 'quantizer', params: { scale: 1 } },
      { id: 'osc', type: 'vco' },
      { id: 'amp', type: 'vca' },
      { id: 'pan', type: 'pan' },
      { id: 'out', type: 'output' },
    ],
    cables: [
      { from: 'clock', port: 'gate', to: 'divide', input: 'clock' },
      { from: 'divide', port: 'gate', to: 'seq', input: 'clock' },
      { from: 'seq', port: 'cv', to: 'scale', input: 'pitch' },
      { from: 'scale', port: 'out', to: 'osc', input: 'pitch' },
      { from: 'seq', port: 'gate', to: 'amp', input: 'gain' },
      { from: 'osc', port: 'out', to: 'amp', input: 'audio' },
      { from: 'amp', port: 'out', to: 'pan', input: 'in' },
      { from: 'clock', port: 'phase', to: 'pan', input: 'param:pan' },
      { from: 'pan', port: 'left', to: 'out', input: 'audio' },
      { from: 'pan', port: 'right', to: 'out', input: 'right' },
    ],
  },
  'stereo pan and voice spread': voice([
    { id: 'osc', type: 'vco' },
    { id: 'pan', type: 'pan', params: { pan: 0.2, spread: 0.85 } },
  ], [
    { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
    { from: 'osc', port: 'out', to: 'pan', input: 'in' },
    { from: 'pan', port: 'left', to: 'out', input: 'audio' },
    { from: 'pan', port: 'right', to: 'out', input: 'right' },
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
const drumNames = ['kick', 'snare', 'clap', 'closed hat', 'open hat', 'tom',
  'rimshot', 'cowbell', 'shaker', 'crash', 'ride'];
for (const [sound, name] of drumNames.entries()) {
  PATCHES['drum voice: ' + name] = voice([{ id: 'drum', type: 'drumVoice', params: { sound } }], [
    { from: 'note', port: 'gate', to: 'drum', input: 'trigger' },
    { from: 'note', port: 'velocity', to: 'drum', input: 'velocity' },
    { from: 'drum', port: 'out', to: 'out', input: 'audio' },
  ]);
}
for (const preset of MODULAR_PRESETS) PATCHES['factory: ' + preset.name] = preset.patch();
const fastGrid = MODULAR_PRESETS.find(preset => preset.name === 'Four Lane Beat').patch();
fastGrid.nodes.find(node => node.type === 'gatedClock').params = { bpm: 300, pulses: 8 };
const longGrid = fastGrid.nodes.find(node => node.type === 'beatGrid');
longGrid.params = { length: 12 };
longGrid.grid.push(0, 0, 0, 9);
PATCHES['Beat Grid exercises four output lanes and columns beyond eight'] = fastGrid;

// Controllers sent during the parity notes, per patch name.
const MIDI = {};
const performance = voice([
  { id: 'osc', type: 'vco', params: { wave: 1 } },
  { id: 'filter', type: 'vcf', params: { cutoff: 300, resonance: 0.4 } },
  { id: 'vib', type: 'lfo', params: { rate: 6 } },
  { id: 'depth', type: 'ring', params: { level: 0.2 } },
  { id: 'sum', type: 'mix4', params: { a: 1, b: 1, c: 0.5, d: 0.3 } },
  { id: 'amp', type: 'vca' },
], [
  { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
  { from: 'vib', port: 'out', to: 'depth', input: 'a' },
  { from: 'note', port: 'mod', to: 'depth', input: 'b' },
  { from: 'depth', port: 'out', to: 'osc', input: 'fm' },
  { from: 'osc', port: 'out', to: 'filter', input: 'audio' },
  { from: 'note', port: 'pressure', to: 'sum', input: 'a' },
  { from: 'note', port: 'cc', to: 'sum', input: 'b' },
  { from: 'note', port: 'bend', to: 'sum', input: 'c' },
  { from: 'note', port: 'velocity', to: 'sum', input: 'd' },
  { from: 'sum', port: 'out', to: 'filter', input: 'cutoff' },
  { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
  { from: 'note', port: 'gate', to: 'amp', input: 'gain' },
  { from: 'amp', port: 'out', to: 'out', input: 'audio' },
]);
performance.nodes[0].params = { bendRange: 7, cc: 2 };
const PERFORMANCE = 'performance controllers: bend range, mod wheel, pressure and a chosen CC';
PATCHES[PERFORMANCE] = performance;
MIDI[PERFORMANCE] = [
  { at: 1000, data: [0xb0, 1, 100] },   // mod wheel
  { at: 2000, data: [0xe0, 0, 96] },    // bend up
  { at: 2500, data: [0xb0, 2, 90] },    // breath, read by the cc output
  { at: 3500, data: [0xd0, 70, 0] },    // channel pressure
  { at: 6500, data: [0xa0, 79, 127] },  // poly pressure on the third note only
  { at: 8000, data: [0xb0, 7, 20] },    // volume: stored, not patched
  { at: 12000, data: [0xb0, 121, 0] },  // reset all controllers
];

// Host transport changes during the parity notes, per patch name.
const TRANSPORT = {};
const HOST_CLOCKS = 'host-synced Clock and Gated Clock follow tempo, position and stop';
PATCHES[HOST_CLOCKS] = voice([
  { id: 'clock', type: 'clock', params: { pulses: 4, duty: 0.3, sync: 1 } },
  { id: 'seq', type: 'sequencer', params: { length: 3, step1: 0, step2: 7, step3: 12 } },
  { id: 'held', type: 'gatedClock', params: { pulses: 2, bpm: 300, sync: 1 } },
  { id: 'osc', type: 'vco', params: { wave: 1 } },
  { id: 'sum', type: 'mix', params: { a: 1, b: 0.3 } },
  { id: 'trigger', type: 'mix4', params: { a: 1, b: 1, c: 0.5, d: 0.2 } },
  { id: 'amp', type: 'vca' },
], [
  { from: 'clock', port: 'gate', to: 'seq', input: 'clock' },
  { from: 'clock', port: 'reset', to: 'seq', input: 'reset' },
  { from: 'note', port: 'pitch', to: 'sum', input: 'a' },
  { from: 'seq', port: 'cv', to: 'sum', input: 'b' },
  { from: 'sum', port: 'out', to: 'osc', input: 'pitch' },
  { from: 'seq', port: 'gate', to: 'trigger', input: 'a' },
  { from: 'held', port: 'gate', to: 'trigger', input: 'b' },
  { from: 'clock', port: 'phase', to: 'trigger', input: 'c' },
  { from: 'held', port: 'phase', to: 'trigger', input: 'd' },
  { from: 'osc', port: 'out', to: 'amp', input: 'audio' },
  { from: 'trigger', port: 'out', to: 'amp', input: 'gain' },
  { from: 'amp', port: 'out', to: 'out', input: 'audio' },
]);
TRANSPORT[HOST_CLOCKS] = [
  { at: 0, bpm: 150, playing: true, beat: 3.25 },
  { at: 5000, bpm: 150, playing: true, beat: 3.25 + 5000 * 150 / 60 / rate },
  { at: 9000, bpm: 97, playing: true, beat: 12.5 },  // a jump, as when the play cursor moves
  { at: 15000, bpm: 97, playing: false, beat: 0 },
  { at: 19000, bpm: 180, playing: true, beat: 0 },
];

test('the parity patches use every module type', () => {
  const used = new Set(Object.values(PATCHES).flatMap(p => p.nodes.map(n => n.type)));
  assert.deepEqual([...Object.keys(MODULAR_TYPES)].filter(t => !used.has(t) && t !== 'delay' && t !== 'cv' && t !== 'macro'), []);
});

for (const [name, patch] of Object.entries(PATCHES)) {
  test(`Web and native engines render the same audio: ${name}`, { skip: !existsSync(tool) && 'modular_render unavailable' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'amisynth-parity-'));
    try {
      const midi = MIDI[name] ?? [];
      const transport = TRANSPORT[name] ?? [];
      const web = renderWeb(patch, false, midi, transport), native = renderNative(patch, dir, false, midi, [], transport);
      assert.equal(native.length, web.length);
      let worst = 0, at = 0, energy = 0;
      for (let i = 0; i < web.length; i++) {
        const diff = Math.abs(web[i] - native[i]);
        if (diff > worst) { worst = diff; at = i; }
        energy += web[i] * web[i];
      }
      assert.ok(energy > 1e-3, `${name} is silent`);
      assert.ok(worst < 1e-4, `${name} differs by ${worst} at sample ${at}`);
      const stereo = patch.cables.some(cable => cable.input === 'right' &&
        patch.nodes.some(node => node.id === cable.to && node.type === 'output'));
      if (stereo) {
        const webRight = renderWeb(patch, true, midi, transport), nativeRight = renderNative(patch, dir, true, midi, [], transport);
        assert.ok(webRight.some((value, i) => Math.abs(value - web[i]) > 0.01));
        assert.ok(webRight.every((value, i) => Math.abs(value - nativeRight[i]) < 1e-4));
      } else {
        assert.deepEqual(renderWeb(patch, true, midi, transport), web);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('CLAP note expressions reach the native MIDI / Note outputs', { skip: !existsSync(tool) && 'modular_render unavailable' }, () => {
  const probe = (port, scale, expressions) => {
    const patch = {
      nodes: [
        { id: 'note', type: 'midi', params: { cc: 74 } },
        { id: 'scale', type: 'cv', params: { scale } },
        { id: 'out', type: 'output', params: { level: 1 } },
      ],
      cables: [
        { from: 'note', port, to: 'scale', input: 'in' },
        { from: 'scale', port: 'out', to: 'out', input: 'audio' },
      ],
    };
    const dir = mkdtempSync(join(tmpdir(), 'amisynth-expression-'));
    try { return Array.from(renderNative(patch, dir, false, [], expressions), x => Math.atanh(x) / scale); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  };
  // Expression IDs from clap/events.h: tuning 2, brightness 5, pressure 6. Only key 48 sounds at sample 200.
  const tuning = probe('pitch', 0.001, [{ at: 200, id: 2, key: 48, value: 1.5 }]);
  assert.ok(Math.abs(tuning[199] - 48) < 1e-3 && Math.abs(tuning[200] - 49.5) < 1e-3);
  const pressure = probe('pressure', 0.1, [{ at: 200, id: 6, key: 48, value: 0.5 }]);
  assert.ok(Math.abs(pressure[199]) < 1e-6 && Math.abs(pressure[200] - 0.5) < 1e-4);
  const brightness = probe('cc', 0.1, [{ at: 200, id: 5, key: 48, value: 0.25 }, { at: 300, id: 5, key: 55, value: 1 }]);
  assert.ok(Math.abs(brightness[199]) < 1e-6 && Math.abs(brightness[300] - 0.25) < 1e-4);
});
