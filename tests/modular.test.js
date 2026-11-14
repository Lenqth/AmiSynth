import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULAR_TYPES, compileModularPatch, searchModularTypes, defaultModularPatch, modular_init, modular_meter_enable, modular_meter_snapshot, modular_midi, modular_render, modular_set_patch, safeModularPatch } from '../src/dsp/modular.js';
import { renderPattern } from '../src/lib/render.js';

test('modular default patch compiles and respects its dependency order', () => {
  const g = compileModularPatch(defaultModularPatch());
  const pos = new Map(g.order.map((index, order) => [g.nodes[index].id, order]));
  for (const c of g.patch.cables) assert.ok(pos.get(c.from) < pos.get(c.to));
});

test('modular rejects cycles, duplicate input links, invalid ports, and malformed patches', () => {
  const p = defaultModularPatch();
  assert.throws(() => compileModularPatch({ ...p, cables: [...p.cables, { from: 'amp', port: 'out', to: 'osc', input: 'fm' }] }));
  assert.throws(() => compileModularPatch({ ...p, cables: [...p.cables, { from: 'osc', port: 'out', to: 'amp', input: 'audio' }] }));
  assert.throws(() => compileModularPatch({ ...p, cables: [...p.cables, { from: 'note', port: 'bad', to: 'osc', input: 'fm' }] }));
  assert.deepEqual(safeModularPatch({ nodes: [], cables: [] }), defaultModularPatch());
});

test('modular clamps bad parameters and accepts variable module count', () => {
  const p = defaultModularPatch();
  p.nodes.push({ id: 'lfo', type: 'lfo', params: { rate: 1000, depth: Number.NaN } });
  const g = compileModularPatch(p);
  assert.equal(g.nodes.length, 7);
  assert.equal(g.nodes[6].params.rate, MODULAR_TYPES.lfo.params.rate.max);
  assert.equal(g.nodes[6].params.depth, MODULAR_TYPES.lfo.params.depth.default);
});

test('modular renders finite audio and releases its voice', () => {
  const s = {};
  modular_init(s, 48000);
  modular_midi(s, 0x90, 69, 100);
  let peak = 0;
  for (let i = 0; i < 4800; i++) {
    modular_render(s);
    assert.ok(Number.isFinite(s.out_l));
    peak = Math.max(peak, Math.abs(s.out_l));
  }
  assert.ok(peak > 0.0001);
  modular_midi(s, 0x80, 69, 0);
  for (let i = 0; i < 48000; i++) modular_render(s);
  assert.ok(s.voices.every(v => !v.active));
});

test('modular graph replacement is atomic at the API boundary', () => {
  const s = {};
  modular_init(s, 44100);
  const old = s.graph;
  assert.throws(() => modular_set_patch(s, { nodes: [], cables: [] }));
  assert.equal(s.graph, old);
});

test('explicit feedback delay reads the previous sample and bounds the loop', () => {
  const patch = {
    nodes: [
      { id: 'constant', type: 'cv', params: { offset: 1 } }, { id: 'delay', type: 'delay' },
      { id: 'sum', type: 'mix', params: { a: 1, b: 0.5 } }, { id: 'out', type: 'output', params: { level: 1 } },
    ],
    cables: [
      { from: 'constant', port: 'out', to: 'sum', input: 'a' },
      { from: 'delay', port: 'out', to: 'sum', input: 'b' },
      { from: 'sum', port: 'out', to: 'delay', input: 'in' },
      { from: 'sum', port: 'out', to: 'out', input: 'audio' },
    ],
  };
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, patch);
  modular_midi(s, 0x90, 60, 100);
  for (const expected of [1, 1.5, 1.75, 1.875]) {
    modular_render(s);
    assert.equal(s.out_l, Math.tanh(expected));
  }
  patch.nodes[2].params.b = 2;
  modular_set_patch(s, patch);
  for (let i = 0; i < 100; i++) modular_render(s);
  assert.equal(s.voices[0].stages[1].memory, 4);
});

test('channel note-off and sustain keep other notes and later retriggers held', () => {
  const s = {};
  modular_init(s, 48000);
  modular_midi(s, 0x92, 69, 100);
  modular_midi(s, 0x93, 69, 100);
  modular_midi(s, 0x92, 69, 100);
  modular_midi(s, 0xb2, 64, 127);
  modular_midi(s, 0x82, 69, 0);
  assert.deepEqual(s.voices.slice(0, 3).map(v => [v.keyDown, v.held]), [[false, true], [true, true], [true, true]]);
  modular_midi(s, 0xb2, 64, 0);
  assert.deepEqual(s.voices.slice(0, 3).map(v => v.held), [false, true, true]);
});

test('silent or externally gated envelopes cannot keep a released voice allocated forever', () => {
  const patch = defaultModularPatch();
  patch.nodes.push({ id: 'high', type: 'cv', params: { offset: 1 } });
  patch.cables[1] = { from: 'high', port: 'out', to: 'env', input: 'gate' };
  const s = {};
  modular_init(s, 1000);
  modular_set_patch(s, patch);
  modular_midi(s, 0x90, 60, 100);
  for (let i = 0; i < 20; i++) modular_render(s);
  modular_midi(s, 0x80, 60, 0);
  for (let i = 0; i < 10005; i++) modular_render(s);
  assert.equal(s.out_l, 0);
  assert.ok(s.voices.every(v => !v.active));
});

test('knob and macro changes keep active voices and update the output', () => {
  const s = {};
  modular_init(s, 48000);
  const patch = defaultModularPatch();
  patch.nodes.push({ id: 'macro', type: 'macro', params: {} });
  patch.cables.push({ from: 'macro', port: 'out', to: 'filter', input: 'cutoff' });
  modular_set_patch(s, patch);
  modular_midi(s, 0x90, 69, 100);
  for (let i = 0; i < 480; i++) modular_render(s);
  const voice = s.voices[0];
  patch.macros = [0.75];
  modular_set_patch(s, patch);
  assert.equal(s.voices[0], voice);
  assert.equal(voice.held, true);
  modular_render(s);
  assert.equal(voice.signals[6].out, 0.75);
});

test('extreme CV cascades stay finite, including when the result is muted', () => {
  const nodes = [{ id: 'cv', type: 'cv', params: { offset: 8 } }];
  const cables = [];
  for (let i = 1; i <= 15; i++) {
    const from = nodes.at(-1).id, to = 'amp' + i;
    nodes.push({ id: to, type: 'vca', params: { level: 2 } });
    cables.push({ from, port: 'out', to, input: 'audio' }, { from, port: 'out', to, input: 'gain' });
  }
  nodes.push({ id: 'out', type: 'output', params: { level: 0 } });
  cables.push({ from: 'amp15', port: 'out', to: 'out', input: 'audio' });
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, { nodes, cables });
  modular_midi(s, 0x90, 60, 100);
  modular_render(s);
  assert.equal(s.out_l, 0);
  assert.ok(s.voices[0].signals.every(sig => Number.isFinite(sig.out)));
});

test('offline Modular export retains a ten-second envelope release', () => {
  const modularPatch = defaultModularPatch();
  modularPatch.nodes.find(n => n.type === 'adsr').params.release = 10;
  const { left } = renderPattern({
    pattern: { bpm: 240, melodic: 'modular', notes: [{ note: 69, vel: 100, start: 63, len: 1 }], drums: [] },
    params: {}, modularPatch, sampleRate: 8000,
  });
  assert.ok(left.length > 13.5 * 8000);
  assert.ok(left.slice(11 * 8000, 11.1 * 8000).some(x => Math.abs(x) > 0.001));
});

test('parameter CV replaces the saved knob value while connected and restores it when unplugged', () => {
  const patch = {
    nodes: [
      { id: 'audio', type: 'cv', params: { offset: 1 } },
      { id: 'macro', type: 'macro' },
      { id: 'out', type: 'output', params: { level: 0.2 } },
    ],
    cables: [
      { from: 'audio', port: 'out', to: 'out', input: 'audio' },
      { from: 'macro', port: 'out', to: 'out', input: 'param:level' },
    ],
    macros: [0.7],
  };
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, patch);
  assert.equal(s.graph.patch.nodes[2].params.level, 0.2);
  modular_midi(s, 0x90, 69, 100);
  modular_render(s);
  assert.equal(s.out_l, Math.tanh(0.7));
  assert.throws(() => compileModularPatch({ ...patch, cables: [{ ...patch.cables[1], input: 'param:unknown' }] }));
  modular_set_patch(s, { ...patch, cables: [patch.cables[0]] });
  modular_midi(s, 0x90, 69, 100);
  modular_render(s);
  assert.equal(s.out_l, Math.tanh(0.2));
});

test('cable activity distinguishes changing signals from a constant gate', () => {
  const s = {};
  modular_init(s, 48000);
  modular_meter_enable(s, true);
  modular_midi(s, 0x90, 69, 100);
  for (let i = 0; i < 2048; i++) modular_render(s);
  const moving = modular_meter_snapshot(s);
  assert.ok(moving.includes('osc/out'));
  assert.ok(!moving.includes('note/gate'));
  modular_meter_enable(s, false);
  assert.equal(s.meter, null);
});

const stringPatch = (extra = {}) => ({
  nodes: [
    { id: 'note', type: 'midi' },
    { id: 'string', type: 'string', params: { decay: 3, release: 0.1, ...extra } },
    { id: 'out', type: 'output' },
  ],
  cables: [
    { from: 'note', port: 'pitch', to: 'string', input: 'pitch' },
    { from: 'note', port: 'gate', to: 'string', input: 'gate' },
    { from: 'string', port: 'out', to: 'out', input: 'audio' },
  ],
});

test('a plucked string sounds at the played pitch, rings while held and stops after its release', () => {
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, stringPatch());
  modular_midi(s, 0x90, 57, 100); // A3, 220 Hz
  const out = new Float64Array(9600);
  for (let i = 0; i < out.length; i++) { modular_render(s); out[i] = s.out_l; }
  // The strongest autocorrelation lag after the first period is one period of 220 Hz.
  const tail = out.subarray(4800);
  let best = 0, period = 0;
  for (let lag = 100; lag < 400; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < tail.length; i++) sum += tail[i] * tail[i + lag];
    if (sum > best) { best = sum; period = lag; }
  }
  assert.ok(Math.abs(48000 / period - 220) < 2, `pitch ${48000 / period} Hz`);
  assert.ok(s.voices.some(v => v.active));
  modular_midi(s, 0x80, 57, 0);
  for (let i = 0; i < 48000; i++) modular_render(s);
  assert.ok(s.voices.every(v => !v.active), 'released string kept its voice');
});

test('a struck modal resonator rings on after note-off and then frees its voice', () => {
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, {
    nodes: [{ id: 'note', type: 'midi' }, { id: 'bar', type: 'modal', params: { decay: 1, release: 0.5 } }, { id: 'out', type: 'output' }],
    cables: [
      { from: 'note', port: 'pitch', to: 'bar', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'bar', input: 'gate' },
      { from: 'bar', port: 'out', to: 'out', input: 'audio' },
    ],
  });
  modular_midi(s, 0x90, 72, 100);
  for (let i = 0; i < 480; i++) modular_render(s);
  modular_midi(s, 0x80, 72, 0);
  let after = 0;
  for (let i = 0; i < 2400; i++) { modular_render(s); after = Math.max(after, Math.abs(s.out_l)); }
  assert.ok(after > 0.001, 'the bar was cut off at note-off');
  for (let i = 0; i < 96000; i++) modular_render(s);
  assert.ok(s.voices.every(v => !v.active));
});

test('strings and comb filters share four delay lines per voice', () => {
  const patch = { nodes: [{ id: 'out', type: 'output' }], cables: [] };
  for (let i = 0; i < 4; i++) patch.nodes.push({ id: 'line' + i, type: i % 2 ? 'comb' : 'string' });
  assert.equal(compileModularPatch(patch).lineCount, 4);
  patch.nodes.push({ id: 'line4', type: 'comb' });
  assert.throws(() => compileModularPatch(patch), /at most 4/);
});

test('patches saved before filter modes keep a lowpass without key tracking', () => {
  const g = compileModularPatch(defaultModularPatch());
  assert.deepEqual(g.patch.nodes.find(n => n.type === 'vcf').params, { cutoff: 2400, resonance: 0.15, mode: 0, keytrack: 0 });
});

test('module search matches names, categories and keywords', () => {
  assert.equal(searchModularTypes('pluck')[0].type, 'string');
  assert.equal(searchModularTypes('portamento')[0].type, 'slew');
  assert.deepEqual(searchModularTypes('ring mod').map(r => r.type), ['ring']);
  assert.equal(searchModularTypes('').length, Object.keys(MODULAR_TYPES).length);
  assert.deepEqual(searchModularTypes('zzz'), []);
});
