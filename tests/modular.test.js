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
  assert.throws(() => compileModularPatch({ ...p, cables: [...p.cables, { from: 'amp', port: 'out', to: 'filter', input: 'audio' }] }));
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
