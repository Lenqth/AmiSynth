import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODULAR_PRESETS, MODULAR_TYPES, compileModularPatch, searchModularTypes, defaultModularPatch, modular_init, modular_meter_enable, modular_meter_snapshot, modular_midi, modularPresetIndex, modular_render, modular_set_patch, safeModularPatch } from '../src/dsp/modular.js';
import { renderPattern } from '../src/lib/render.js';

test('modular default patch compiles and respects its dependency order', () => {
  const g = compileModularPatch(defaultModularPatch());
  const pos = new Map(g.order.map((index, order) => [g.nodes[index].id, order]));
  for (const c of g.patch.cables) assert.ok(pos.get(c.from) < pos.get(c.to));
});

test('an autonomous rack clocks steps and rounds MIDI pitch without note input', () => {
  const s = {};
  modular_init(s, 1000);
  modular_set_patch(s, {
    nodes: [
      { id: 'clock', type: 'clock', params: { bpm: 300, pulses: 2 } },
      { id: 'seq', type: 'sequencer', params: { length: 2, step1: 60, step2: 61 } },
      { id: 'scale', type: 'quantizer', params: { scale: 2 } },
      { id: 'out', type: 'output' },
    ],
    cables: [
      { from: 'clock', port: 'gate', to: 'seq', input: 'clock' },
      { from: 'seq', port: 'cv', to: 'scale', input: 'pitch' },
      { from: 'scale', port: 'out', to: 'out', input: 'audio' },
    ],
  });
  const observed = [];
  for (let i = 0; i < 240; i++) {
    modular_render(s);
    if ([20, 70, 120, 220].includes(i)) {
      const [, sequence, scale] = s.voices[0].signals;
      observed.push([sequence.cv, sequence.gate, scale.out]);
    }
  }
  assert.deepEqual(observed, [[60, 1, 60], [60, 0, 60], [61, 1, 60], [60, 1, 60]]);
});

test('a custom resonance table sets the audible frequency and survives patch serialization', () => {
  const modalTable = [{ ratio: 2.5, gain: 0.8, decay: 0.75 }];
  const patch = {
    nodes: [
      { id: 'modal', type: 'modal', modalTable },
      { id: 'out', type: 'output' },
    ],
    cables: [{ from: 'modal', port: 'out', to: 'out', input: 'audio' }],
  };
  const saved = JSON.parse(JSON.stringify(compileModularPatch(patch).patch));
  assert.deepEqual(saved.nodes[0].modalTable, modalTable);
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, saved);
  modular_midi(s, 0x90, 69, 100);
  const samples = Array.from({ length: 4800 }, () => { modular_render(s); return s.out_l; });
  function amplitude(hz) {
    let real = 0, imaginary = 0;
    for (const [i, sample] of samples.entries()) {
      const angle = 2 * Math.PI * hz * i / 48000;
      real += sample * Math.cos(angle);
      imaginary += sample * Math.sin(angle);
    }
    return Math.hypot(real, imaginary);
  }
  assert.ok(amplitude(1100) > 10 * amplitude(440));
  assert.throws(() => compileModularPatch({
    ...patch, nodes: [{ ...patch.nodes[0], modalTable: [{ ratio: 0, gain: 0.8, decay: 1 }] }, patch.nodes[1]],
  }), /Frequency ratio/);
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
  const signals = Object.fromEntries(modular_meter_snapshot(s).map(signal => [signal.key, signal]));
  assert.ok(signals['osc/out'].span > 0.5);
  assert.ok(signals['osc/out'].rate > 100);
  assert.equal(signals['note/gate'].span, 0);
  assert.equal(signals['note/gate'].level, 1);
  assert.equal(signals['note/gate'].rate, 0);
  modular_midi(s, 0x80, 69, 0);
  for (let i = 0; i < 48000 * 4; i++) modular_render(s);
  modular_meter_snapshot(s);
  for (let i = 0; i < 2048; i++) modular_render(s);
  assert.equal(modular_meter_snapshot(s).find(signal => signal.key === 'osc/out').level, 0);
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

test('bowed strings, plucked strings and comb filters share four delay lines per voice', () => {
  const patch = { nodes: [{ id: 'out', type: 'output' }], cables: [] };
  for (let i = 0; i < 4; i++) patch.nodes.push({ id: 'line' + i, type: i % 2 ? 'comb' : 'string' });
  assert.equal(compileModularPatch(patch).lineCount, 4);
  patch.nodes.push({ id: 'line4', type: 'comb' });
  assert.throws(() => compileModularPatch(patch), /at most 4/);
  patch.nodes.splice(1, 2, { id: 'bow', type: 'bowed' });
  assert.throws(() => compileModularPatch(patch), /at most 4/);
  patch.nodes.pop();
  assert.equal(compileModularPatch(patch).lineCount, 4);
});

test('patches saved before filter modes keep a 12 dB lowpass without key tracking or drive', () => {
  const g = compileModularPatch(defaultModularPatch());
  assert.deepEqual(g.patch.nodes.find(n => n.type === 'vcf').params, { cutoff: 2400, resonance: 0.15, mode: 0, keytrack: 0, slope: 0, drive: 0 });
});

test('module search matches names, categories and keywords', () => {
  assert.equal(searchModularTypes('pluck')[0].type, 'string');
  assert.equal(searchModularTypes('portamento')[0].type, 'slew');
  assert.deepEqual(searchModularTypes('ring mod').map(r => r.type), ['ring']);
  assert.equal(searchModularTypes('').length, Object.keys(MODULAR_TYPES).length);
  assert.deepEqual(searchModularTypes('zzz'), []);
});

test('mono and legato voices use last-note priority, return to held keys and glide', () => {
  const run = (voices, glide = 0) => {
    const patch = defaultModularPatch();
    patch.nodes[0].params = { voices, glide };
    const s = {};
    modular_init(s, 48000);
    modular_set_patch(s, patch);
    return s;
  };
  const pitch = s => s.voices[0].signals[0].pitch;
  const env = s => s.voices[0].stages[2].env;

  const mono = run(1);
  modular_midi(mono, 0x90, 60, 100);
  for (let i = 0; i < 4800; i++) modular_render(mono);
  modular_midi(mono, 0x90, 64, 100);
  modular_render(mono);
  assert.equal(mono.voices.filter(v => v.active).length, 1);
  assert.equal(pitch(mono), 64);
  assert.ok(env(mono) < 0.01, 'Mono retriggers the envelope');
  modular_midi(mono, 0x80, 64, 0);
  modular_render(mono);
  assert.equal(pitch(mono), 60, 'releasing the newest key returns to the held one');
  assert.ok(mono.voices[0].held);

  const legato = run(2);
  modular_midi(legato, 0x90, 60, 100);
  for (let i = 0; i < 4800; i++) modular_render(legato);
  const before = env(legato);
  modular_midi(legato, 0x90, 67, 100);
  modular_render(legato);
  assert.equal(pitch(legato), 67);
  assert.ok(Math.abs(env(legato) - before) < 0.01, 'Legato keeps the envelope running');

  const glide = run(1, 0.1);
  modular_midi(glide, 0x90, 60, 100);
  modular_render(glide);
  modular_midi(glide, 0x90, 72, 100);
  modular_render(glide);
  assert.ok(pitch(glide) < 61, 'the new note starts from the old pitch');
  for (let i = 0; i < 4800; i++) modular_render(glide);
  assert.ok(pitch(glide) > 71 && pitch(glide) < 72, 'about 95% of the way after the glide time');
  for (let i = 0; i < 19200; i++) modular_render(glide);
  assert.equal(pitch(glide), 72);
});

test('voice mode and glide are patch settings that take no cable', () => {
  const patch = defaultModularPatch();
  patch.nodes.push({ id: 'lfo', type: 'lfo' });
  patch.cables.push({ from: 'lfo', port: 'out', to: 'note', input: 'param:glide' });
  assert.throws(() => compileModularPatch(patch), /Invalid or duplicate cable/);
});

test('Synth presets convert to Modular patches that fit the rack, or name what Modular cannot play', async () => {
  const { modularFromSynth, MODULAR_SYNTH_PORTS } = await import('../src/presets/modular.js');
  const { SYNTH_PRESETS } = await import('../src/presets/synth.js');
  assert.ok(MODULAR_SYNTH_PORTS.length >= 30);
  for (const preset of SYNTH_PRESETS) {
    let patch;
    try { patch = modularFromSynth(preset.params); } catch (e) {
      assert.match(e.message, /^Modular cannot play|no sound source/, preset.name);
      continue;
    }
    assert.ok(compileModularPatch(patch).nodes.length <= 32, preset.name);
  }
  assert.throws(() => modularFromSynth({ fx_delay_on: 1 }), /fx_delay_on/);
});

test('the factory preset match survives layout changes and returns when a sound edit is undone', () => {
  const index = MODULAR_PRESETS.findIndex(preset => preset.name === 'Feedback Bass');
  const patch = compileModularPatch(MODULAR_PRESETS[index].patch()).patch;
  const saved = JSON.parse(JSON.stringify(patch));
  saved.nodes[0].position = { x: 300, y: 400 };
  const selection = () => modularPresetIndex(compileModularPatch(saved).patch);
  assert.equal(selection(), index);
  saved.macros[0] = 0.42;
  assert.equal(selection(), -1);
  saved.macros[0] = patch.macros[0];
  assert.equal(selection(), index);
  saved.cables.pop();
  assert.equal(selection(), -1);
});

test('a pulse wave has no DC offset at any width', () => {
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, {
    nodes: [{ id: 'note', type: 'midi' }, { id: 'osc', type: 'vco', params: { wave: 2, pw: 0.125, level: 0.2 } }, { id: 'out', type: 'output', params: { level: 1 } }],
    cables: [{ from: 'note', port: 'pitch', to: 'osc', input: 'pitch' }, { from: 'osc', port: 'out', to: 'out', input: 'audio' }],
  });
  modular_midi(s, 0x90, 69, 100);
  let sum = 0;
  for (let i = 0; i < 48000; i++) { modular_render(s); sum += s.out_l; }
  assert.ok(Math.abs(sum / 48000) < 0.002);
});

test('the Reed Pipe sustains the played pitch and finishes its release', () => {
  const patch = MODULAR_PRESETS.find(preset => preset.name === 'Velvet Reed').patch();
  const s = {};
  modular_init(s, 48000);
  modular_set_patch(s, patch);
  modular_midi(s, 0x90, 57, 100);
  let previous = 0, crossings = 0, peak = 0;
  for (let i = 0; i < 24000; i++) {
    modular_render(s);
    if (i >= 12000) {
      if (previous < 0 && s.out_l >= 0) crossings++;
      peak = Math.max(peak, Math.abs(s.out_l));
    }
    previous = s.out_l;
  }
  assert.ok(peak > 0.1);
  assert.ok(Math.abs(crossings * 4 - 220) <= 4);
  modular_midi(s, 0x80, 57, 0);
  for (let i = 0; i < 48000; i++) modular_render(s);
  assert.ok(s.voices.every(voice => !voice.active));
});

test('a Drum Voice rings after its trigger falls and a choke input cuts its tail', () => {
  const patch = {
    nodes: [
      { id: 'midi', type: 'midi' }, { id: 'choke', type: 'macro' },
      { id: 'hat', type: 'drumVoice', params: { sound: 4 } }, { id: 'out', type: 'output' },
    ],
    cables: [
      { from: 'midi', port: 'gate', to: 'hat', input: 'trigger' },
      { from: 'choke', port: 'out', to: 'hat', input: 'choke' },
      { from: 'hat', port: 'out', to: 'out', input: 'audio' },
    ],
  };
  function tailEnergy(choked) {
    const s = {};
    modular_init(s, 48000);
    modular_set_patch(s, patch);
    modular_midi(s, 0x90, 69, 127);
    let energy = 0;
    for (let i = 0; i < 6000; i++) {
      if (i === 240) modular_midi(s, 0x80, 69, 0);
      if (i === 2400 && choked) modular_set_patch(s, { ...patch, macros: [1] });
      modular_render(s);
      if (i >= 4800) energy += s.out_l ** 2;
    }
    return energy;
  }
  const open = tailEnergy(false);
  assert.ok(open > 0.01);
  assert.ok(tailEnergy(true) < open / 100);
});
