import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULAR_TYPES, compileModularPatch, defaultModularPatch, modular_init, modular_midi, modular_render, modular_set_patch, safeModularPatch } from '../src/dsp/modular.js';

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
