// Run with node scripts/modular-preset-audit.js. Report render measurements and compile blockers.
import { SYNTH_PRESETS } from '../src/presets/synth.js';
import { PHYS_PRESETS } from '../src/presets/phys.js';
import { DRUM_PRESETS } from '../src/presets/drums.js';
import { modularFromSynth } from '../src/presets/modular.js';
import { SYNTH_PARAMS, PHYS_PARAMS, DRUM_PARAMS, defaultValues } from '../src/dsp/params.js';
import { synth_init, synth_update, synth_note_on, synth_note_off, synth_render } from '../src/dsp/synth.js';
import { phys_init, phys_update, phys_note_on, phys_note_off, phys_render } from '../src/dsp/phys.js';
import { drums_init, drums_update, drums_note_on, drums_render } from '../src/dsp/drums.js';
import {
  MODULAR_PRESETS, compileModularPatch, modular_init, modular_set_patch, modular_midi, modular_render,
} from '../src/dsp/modular.js';

const rate = 48000, on = 0.55, duration = 0.9;
const engines = {
  Synth: { presets: SYNTH_PRESETS, defs: SYNTH_PARAMS, init: synth_init, update: synth_update,
    noteOn: synth_note_on, noteOff: synth_note_off, render: synth_render },
  Physical: { presets: PHYS_PRESETS, defs: PHYS_PARAMS, init: phys_init, update: phys_update,
    noteOn: phys_note_on, noteOff: phys_note_off, render: phys_render },
  Drums: { presets: DRUM_PRESETS, defs: DRUM_PARAMS, init: drums_init, update: drums_update,
    noteOn: drums_note_on, render: drums_render },
};

function original(engine, name, note) {
  const preset = engine.presets.find(item => item.name === name);
  const state = {};
  engine.init(state, rate);
  engine.update(state, { ...defaultValues(engine.defs), ...preset.params });
  engine.noteOn(state, note, 110);
  return measure(state, engine.render, () => engine.noteOff?.(state, note));
}

function modular(name, note) {
  const state = {};
  modular_init(state, rate);
  let patch = MODULAR_PRESETS.find(preset => preset.name === name).patch();
  // Isolate the corresponding kick instead of comparing a whole beat to one drum hit.
  if (name === '808-ish Groove') patch = {
    nodes: [patch.nodes.find(node => node.id === 'kick'), { id: 'out', type: 'output', params: { level: 1 } }],
    cables: [{ from: 'kick', port: 'out', to: 'out', input: 'audio' }],
  };
  modular_set_patch(state, patch);
  modular_midi(state, 0x90, note, 110);
  return measure(state, modular_render, () => modular_midi(state, 0x80, note, 0));
}

function measure(state, render, release) {
  const squares = [0, 0, 0], counts = [0, 0, 0];
  let peak = 0;
  for (let i = 0; i < duration * rate; i++) {
    if (i === Math.round(on * rate)) release();
    render(state);
    const power = (state.out_l ** 2 + state.out_r ** 2) * 0.5;
    if (!Number.isFinite(power)) throw new Error('Non-finite sample');
    peak = Math.max(peak, Math.abs(state.out_l), Math.abs(state.out_r));
    const segment = i < 0.12 * rate ? 0 : i < on * rate ? 1 : 2;
    squares[segment] += power;
    counts[segment]++;
  }
  const db = power => power > 0 ? Math.round(10 * Math.log10(power) * 10) / 10 : null;
  return { peak: db(peak ** 2), attack: db(squares[0] / counts[0]),
    held: db(squares[1] / counts[1]), tail: db(squares[2] / counts[2]) };
}

const accepted = [], rejected = {};
for (const preset of SYNTH_PRESETS) {
  try {
    compileModularPatch(modularFromSynth(preset.params));
    accepted.push(preset.name);
  } catch (e) {
    (rejected[e.message] ??= []).push(preset.name);
  }
}
const examples = [
  ['Synth', 'Vowel Choir Pad', 'Vowel Choir Pad', 60],
  ['Synth', 'Harmonic Scan Pluck', 'Harmonic Scan Pluck', 60],
  ['Physical', 'Wine Glass', 'Wine Glass (Modular)', 60],
  ['Physical', 'Kalimba', 'Kalimba (Modular)', 60],
  ['Drums', '808-ish', '808-ish Groove', 36],
].map(([instrument, source, patch, note]) => ({
  instrument, source, patch, note, original: original(engines[instrument], source, note), modular: modular(patch, note),
}));
console.log(JSON.stringify({
  conditions: '48 kHz, velocity 110, note off at 0.55 s, 0.9 s render. dBFS, null means silent. Levels do not establish timbre equivalence.',
  synth: { total: SYNTH_PRESETS.length, accepted, firstBlocker: rejected },
  physical: { total: PHYS_PRESETS.length, compared: ['Wine Glass', 'Kalimba'] },
  drums: { total: DRUM_PRESETS.length, compared: ['808-ish kick'] },
  examples,
}, null, 2));
