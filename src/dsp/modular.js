// AmiSynth Modular: a small, independent, serializable graph DSP (no Web Audio dependencies).
// All cables carry a per-voice, audio-rate scalar. A Unit Delay breaks a feedback loop.
// The native CLAP engine (clap/src/modular_dsp.h) mirrors every module; keep the two in step.
import { MATERIALS } from './phys.js';

// Native storage limits per module (checked by scripts/gen-modular-clap.js).
export const MODULAR_MAX_INPUTS = 4;
export const MODULAR_MAX_PARAMS = 6;
export const MODULAR_MAX_OUTPUTS = 3;
// Strings and comb filters share a fixed, preallocated delay-line pool per voice.
export const MODULAR_LINES = 4;
export const MODULAR_LINE_SAMPLES = 4096;
export const MODULAR_MODES = 8;
export const MODULAR_MATERIALS = MATERIALS;

export const MODULAR_CATEGORIES = ['Sources', 'Physical', 'Filters & Effects', 'Modulation', 'Utilities', 'Input & Output'];

export const MODULAR_TYPES = Object.freeze({
  midi: { label: 'MIDI / Note', category: 'Input & Output', keywords: 'keyboard pitch gate velocity trigger',
    inputs: [], outputs: ['pitch', 'gate', 'velocity'], params: {} },
  vco: { label: 'VCO', category: 'Sources', keywords: 'oscillator saw square sine triangle tone',
    inputs: ['pitch', 'fm'], outputs: ['out'], params: {
      wave: { min: 0, max: 3, default: 1, step: 1, choices: ['Sine', 'Saw', 'Square', 'Triangle'] },
      octave: { min: -3, max: 3, default: 0, step: 1 },
      detune: { min: -1200, max: 1200, default: 0, step: 1 },
      level: { min: 0, max: 1, default: 0.4, step: 0.01 },
    } },
  noise: { label: 'Noise', category: 'Sources', keywords: 'white pink random hiss breath',
    inputs: [], outputs: ['out'], params: {
      color: { min: 0, max: 1, default: 0, step: 1, choices: ['White', 'Pink'] },
      level: { min: 0, max: 1, default: 0.5, step: 0.01 },
    } },
  string: { label: 'Pluck String', category: 'Physical', keywords: 'karplus strong guitar harp pluck physical model delay',
    inputs: ['pitch', 'gate', 'excite'], outputs: ['out'], params: {
      decay: { min: 0.05, max: 10, default: 1.5, step: 0.01 },
      release: { min: 0.01, max: 10, default: 0.3, step: 0.01 },
      brightness: { min: 0, max: 1, default: 0.6, step: 0.01 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  modal: { label: 'Modal Resonator', category: 'Physical', keywords: 'bell marimba glass gong mallet physical model resonance',
    inputs: ['in', 'pitch', 'gate'], outputs: ['out'], params: {
      material: { min: 0, max: MATERIALS.length - 1, default: 0, step: 1, choices: MATERIALS.map(m => m.name) },
      decay: { min: 0.05, max: 10, default: 1.2, step: 0.01 },
      release: { min: 0.01, max: 10, default: 0.4, step: 0.01 },
      brightness: { min: 0, max: 1, default: 0.5, step: 0.01 },
      level: { min: 0, max: 1, default: 0.5, step: 0.01 },
    } },
  lfo: { label: 'LFO', category: 'Modulation', keywords: 'low frequency oscillator vibrato tremolo wobble',
    inputs: [], outputs: ['out'], params: {
      rate: { min: 0.01, max: 30, default: 2, step: 0.01 },
      depth: { min: 0, max: 1, default: 1, step: 0.01 },
      wave: { min: 0, max: 1, default: 0, step: 1, choices: ['Sine', 'Triangle'] },
    } },
  adsr: { label: 'ADSR', category: 'Modulation', keywords: 'envelope attack decay sustain release eg',
    inputs: ['gate'], outputs: ['out'], params: {
      attack: { min: 0.001, max: 5, default: 0.01, step: 0.001 },
      decay: { min: 0.001, max: 5, default: 0.18, step: 0.001 },
      sustain: { min: 0, max: 1, default: 0.65, step: 0.01 },
      release: { min: 0.001, max: 10, default: 0.3, step: 0.001 },
    } },
  sh: { label: 'Sample & Hold', category: 'Modulation', keywords: 'random stepped s&h clock',
    inputs: ['in', 'trigger'], outputs: ['out'], params: {
      rate: { min: 0.01, max: 50, default: 8, step: 0.01 },
    } },
  slew: { label: 'Slew / Glide', category: 'Modulation', keywords: 'portamento lag smooth glide',
    inputs: ['in'], outputs: ['out'], params: {
      rise: { min: 0, max: 5, default: 0.05, step: 0.001 },
      fall: { min: 0, max: 5, default: 0.05, step: 0.001 },
    } },
  follower: { label: 'Envelope Follower', category: 'Modulation', keywords: 'amplitude detector level tracking',
    inputs: ['in'], outputs: ['out'], params: {
      attack: { min: 0.001, max: 1, default: 0.005, step: 0.001 },
      release: { min: 0.001, max: 5, default: 0.15, step: 0.001 },
      gain: { min: 0, max: 8, default: 1, step: 0.01 },
    } },
  macro: { label: 'Macro CV', category: 'Modulation', keywords: 'automation daw knob',
    inputs: [], outputs: ['out'], params: {
      index: { min: 1, max: 8, default: 1, step: 1 },
    } },
  vcf: { label: 'VCF', category: 'Filters & Effects', keywords: 'filter lowpass highpass bandpass notch cutoff resonance keytrack',
    inputs: ['audio', 'cutoff', 'pitch'], outputs: ['out'], params: {
      cutoff: { min: 20, max: 18000, default: 2400, step: 1 },
      resonance: { min: 0, max: 0.95, default: 0.15, step: 0.01 },
      mode: { min: 0, max: 3, default: 0, step: 1, choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'] },
      keytrack: { min: 0, max: 1, default: 0, step: 0.01 },
    } },
  comb: { label: 'Comb / Delay Line', category: 'Filters & Effects', keywords: 'delay echo flanger chorus resonator feedback',
    inputs: ['in'], outputs: ['out'], params: {
      time: { min: 0.05, max: 40, default: 5, step: 0.01 },
      feedback: { min: -0.98, max: 0.98, default: 0.6, step: 0.01 },
      damping: { min: 0, max: 1, default: 0.2, step: 0.01 },
      mix: { min: 0, max: 1, default: 0.5, step: 0.01 },
    } },
  ring: { label: 'Multiply / Ring', category: 'Filters & Effects', keywords: 'ring modulator multiplier am product',
    inputs: ['a', 'b'], outputs: ['out'], params: {
      level: { min: 0, max: 2, default: 1, step: 0.01 },
    } },
  vca: { label: 'VCA', category: 'Utilities', keywords: 'amplifier gain volume',
    inputs: ['audio', 'gain'], outputs: ['out'], params: {
      level: { min: 0, max: 2, default: 1, step: 0.01 },
    } },
  mix: { label: 'Mixer (2)', category: 'Utilities', keywords: 'sum add combine',
    inputs: ['a', 'b'], outputs: ['out'], params: {
      a: { min: 0, max: 2, default: 0.5, step: 0.01 },
      b: { min: 0, max: 2, default: 0.5, step: 0.01 },
    } },
  cv: { label: 'CV Scale / Offset', category: 'Utilities', keywords: 'attenuator offset scale bias',
    inputs: ['in'], outputs: ['out'], params: {
      scale: { min: -8, max: 8, default: 1, step: 0.01 },
      offset: { min: -8, max: 8, default: 0, step: 0.01 },
    } },
  delay: { label: 'Unit Delay', category: 'Utilities', keywords: 'feedback one sample z-1',
    inputs: ['in'], outputs: ['out'], params: {} },
  output: { label: 'Audio output', category: 'Input & Output', keywords: 'out speaker master',
    inputs: ['audio'], outputs: [], params: {
      level: { min: 0, max: 1, default: 0.8, step: 0.01 },
    } },
});

const LINE_TYPES = new Set(['string', 'comb']);
// Modules that ring on after their gate falls; a released voice lives until they are quiet.
const RINGING_TYPES = new Set(['adsr', 'string', 'modal']);

const searchWords = text => text.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);

/**
 * Modules matching a search, best first. Every query word must start a word of the module's
 * name, category or keywords, so "ring" finds the ring modulator but not "string".
 */
export function searchModularTypes(query) {
  const words = searchWords(query);
  return Object.entries(MODULAR_TYPES)
    .map(([type, def]) => {
      const label = searchWords(def.label);
      const text = [type, ...label, ...searchWords(def.category), ...searchWords(def.keywords)];
      if (!words.every(w => text.some(t => t.startsWith(w)))) return null;
      const named = words.length > 0 && words.every(w => label.some(t => t.startsWith(w)));
      return { type, def, score: named ? 0 : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score ||
      MODULAR_CATEGORIES.indexOf(a.def.category) - MODULAR_CATEGORIES.indexOf(b.def.category));
}

// A separate port name preserves the legacy VCF cutoff modulation input.
export const modularParamInput = key => 'param:' + key;

export function defaultModularPatch() {
  return {
    nodes: [
      { id: 'note', type: 'midi', params: {} },
      { id: 'osc', type: 'vco', params: {} },
      { id: 'env', type: 'adsr', params: {} },
      { id: 'filter', type: 'vcf', params: {} },
      { id: 'amp', type: 'vca', params: {} },
      { id: 'out', type: 'output', params: {} },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'osc', port: 'out', to: 'filter', input: 'audio' },
      { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  };
}

export const MODULAR_MACROS = 8;
export const MODULAR_PATCH_BYTES = 64 * 1024;
export const MODULAR_POSITION_MAX = 8192;
const MAX_RELEASE = 10;
const RELEASE_FADE = 0.005;
export const MODULAR_MAX_TAIL = MAX_RELEASE + RELEASE_FADE;

export const MODULAR_PRESETS = [
  { name: 'Subtractive', patch: defaultModularPatch },
  { name: 'Vibrato Lead', patch() {
    const patch = defaultModularPatch();
    patch.nodes.push({ id: 'vibrato', type: 'lfo', params: { rate: 5.2, depth: 0.035 } });
    patch.cables.push({ from: 'vibrato', port: 'out', to: 'osc', input: 'fm' });
    return patch;
  } },
  { name: 'Feedback Bass', patch() {
    const patch = defaultModularPatch();
    patch.nodes.push(
      { id: 'sum', type: 'mix', params: { a: 1, b: 0.45 } },
      { id: 'memory', type: 'delay', params: {} },
      { id: 'brightness', type: 'macro', params: { index: 1 } },
    );
    patch.nodes.find(n => n.id === 'filter').params.cutoff = 360;
    patch.cables = patch.cables.filter(c => c.to !== 'filter');
    patch.cables.push(
      { from: 'osc', port: 'out', to: 'sum', input: 'a' },
      { from: 'memory', port: 'out', to: 'sum', input: 'b' },
      { from: 'sum', port: 'out', to: 'filter', input: 'audio' },
      { from: 'filter', port: 'out', to: 'memory', input: 'in' },
      { from: 'brightness', port: 'out', to: 'filter', input: 'cutoff' },
    );
    return patch;
  } },
  ...portedPresets(),
];

// Factory patches ported from Synth presets of the same name, plus a few for the physical
// modules. Modular has no pulse width, hard sync, unison or mono glide, so those are
// approximated: a second VCF stage makes a 24 dB filter, detuned VCOs stand in for unison and
// a VCO an octave down for the sub oscillator. The VCF cutoff input adds two octaves per unit,
// so a CV Scale of N/2 gives N octaves of filter envelope.
function portedPresets() {
  // nodes: { id: [type, params] }; cables: 'from.port > to.input'
  const make = (nodes, ...cables) => ({
    nodes: [{ id: 'note', type: 'midi' }, { id: 'out', type: 'output' },
      ...Object.entries(nodes).map(([id, [type, params = {}]]) => ({ id, type, params }))],
    cables: cables.map(text => {
      const [[from, port], [to, input]] = text.split('>').map(end => end.trim().split('.'));
      return { from, port, to, input };
    }),
  });
  const env = (attack, decay, sustain, release) => ['adsr', { attack, decay, sustain, release }];
  const saw = 1, square = 2, sine = 0, triangle = 3;
  return [
    { name: 'Acid Bass', patch: () => make({
      osc: ['vco', { wave: saw, octave: -1, level: 0.5 }],
      filter: ['vcf', { cutoff: 260, resonance: 0.82, keytrack: 0.3 }],
      slope: ['vcf', { cutoff: 260, keytrack: 0.3 }],
      fenv: env(0.001, 0.18, 0, 0.04), depth: ['cv', { scale: 2.1 }],
      env: env(0.001, 0.3, 0.8, 0.04), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > filter.pitch', 'note.pitch > slope.pitch',
    'osc.out > filter.audio', 'filter.out > slope.audio', 'slope.out > amp.audio',
    'note.gate > fenv.gate', 'fenv.out > depth.in', 'depth.out > filter.cutoff', 'depth.out > slope.cutoff',
    'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Sub Bass', patch: () => make({
      osc: ['vco', { wave: triangle, level: 0.6 }], sub: ['vco', { wave: square, octave: -1, level: 0.3 }],
      sum: ['mix', { a: 1, b: 1 }], filter: ['vcf', { cutoff: 600, resonance: 0 }],
      env: env(0.002, 0.18, 1, 0.08), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > sub.pitch', 'osc.out > sum.a', 'sub.out > sum.b',
    'sum.out > filter.audio', 'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain',
    'amp.out > out.audio') },
    { name: 'Pluck', patch: () => make({
      osc: ['vco', { wave: saw, level: 0.45 }], osc2: ['vco', { wave: square, level: 0.25 }],
      sum: ['mix', { a: 1, b: 1 }], filter: ['vcf', { cutoff: 400, resonance: 0.25 }],
      fenv: env(0.001, 0.22, 0, 0.2), depth: ['cv', { scale: 2.25 }],
      env: env(0.001, 0.45, 0, 0.2), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > osc2.pitch', 'osc.out > sum.a', 'osc2.out > sum.b',
    'sum.out > filter.audio', 'filter.out > amp.audio', 'note.gate > fenv.gate', 'fenv.out > depth.in',
    'depth.out > filter.cutoff', 'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'FM Bell', patch: () => make({
      carrier: ['vco', { wave: sine, level: 0.8 }],
      modulator: ['vco', { wave: sine, octave: 1, detune: 969, level: 1 }],
      index: env(0.001, 1.6, 0, 1), depth: ['vca', { level: 0.7 }],
      env: env(0.001, 2.5, 0, 1.5), amp: ['vca'],
    }, 'note.pitch > carrier.pitch', 'note.pitch > modulator.pitch', 'modulator.out > depth.audio',
    'note.gate > index.gate', 'index.out > depth.gain', 'depth.out > carrier.fm', 'carrier.out > amp.audio',
    'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Chiptune Square', patch: () => make({
      osc: ['vco', { wave: square, level: 0.45 }], env: env(0.001, 0.1, 1, 0.015), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'osc.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain',
    'amp.out > out.audio') },
    { name: 'Warm Pad', patch: () => make({
      osc: ['vco', { wave: triangle, level: 0.5 }], osc2: ['vco', { wave: saw, detune: 12, level: 0.2 }],
      osc3: ['vco', { wave: saw, detune: -18, level: 0.2 }],
      sum: ['mix', { a: 1, b: 1 }], sum2: ['mix', { a: 1, b: 1 }],
      filter: ['vcf', { cutoff: 700, resonance: 0.2 }],
      fenv: env(1.5, 3, 0.5, 2), drift: ['lfo', { rate: 0.3, depth: 0.15 }], mod: ['mix', { a: 1, b: 1 }],
      env: env(0.9, 0.5, 1, 2), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > osc2.pitch', 'note.pitch > osc3.pitch',
    'osc.out > sum.a', 'osc2.out > sum.b', 'sum.out > sum2.a', 'osc3.out > sum2.b', 'sum2.out > filter.audio',
    'note.gate > fenv.gate', 'fenv.out > mod.a', 'drift.out > mod.b', 'mod.out > filter.cutoff',
    'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Wobble Bass', patch: () => make({
      osc: ['vco', { wave: saw, level: 0.4 }], osc2: ['vco', { wave: saw, detune: 12, level: 0.25 }],
      sub: ['vco', { wave: square, octave: -1, level: 0.2 }],
      sum: ['mix', { a: 1, b: 1 }], sum2: ['mix', { a: 1, b: 1 }],
      filter: ['vcf', { cutoff: 260, resonance: 0.6 }],
      wobble: ['lfo', { rate: 3, wave: 1 }], depth: ['cv', { scale: 1.3, offset: 1.3 }],
      env: env(0.002, 0.2, 1, 0.06), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > osc2.pitch', 'note.pitch > sub.pitch',
    'osc.out > sum.a', 'osc2.out > sum.b', 'sum.out > sum2.a', 'sub.out > sum2.b', 'sum2.out > filter.audio',
    'wobble.out > depth.in', 'depth.out > filter.cutoff', 'filter.out > amp.audio',
    'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Noise Sweep FX', patch: () => make({
      noise: ['noise', { color: 0, level: 0.9 }], filter: ['vcf', { cutoff: 300, resonance: 0.55, mode: 2 }],
      fenv: env(3, 0.5, 1, 1.5), depth: ['cv', { scale: 2.5 }],
      env: env(0.8, 0.5, 1, 1.5), amp: ['vca'],
    }, 'noise.out > filter.audio', 'note.gate > fenv.gate', 'fenv.out > depth.in', 'depth.out > filter.cutoff',
    'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Sample & Hold Blips', patch: () => make({
      osc: ['vco', { wave: square, level: 0.3 }], filter: ['vcf', { cutoff: 1200, resonance: 0.7 }],
      random: ['sh', { rate: 8 }], depth: ['cv', { scale: 1.1 }],
      env: env(0.005, 0.2, 1, 0.3), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'osc.out > filter.audio', 'random.out > depth.in', 'depth.out > filter.cutoff',
    'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Reese Bass', patch: () => make({
      osc: ['vco', { wave: saw, detune: 11, level: 0.35 }], osc2: ['vco', { wave: saw, detune: -18, level: 0.35 }],
      sub: ['vco', { wave: sine, octave: -1, level: 0.25 }],
      sum: ['mix', { a: 1, b: 1 }], sum2: ['mix', { a: 1, b: 1 }],
      filter: ['vcf', { cutoff: 650, resonance: 0.18 }], drift: ['lfo', { rate: 0.18, depth: 0.175 }],
      env: env(0.008, 0.2, 1, 0.1), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > osc2.pitch', 'note.pitch > sub.pitch',
    'osc.out > sum.a', 'osc2.out > sum.b', 'sum.out > sum2.a', 'sub.out > sum2.b', 'sum2.out > filter.audio',
    'drift.out > filter.cutoff', 'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain',
    'amp.out > out.audio') },
    { name: 'Brass', patch: () => make({
      osc: ['vco', { wave: saw, level: 0.35 }], osc2: ['vco', { wave: saw, detune: 6, level: 0.3 }],
      sum: ['mix', { a: 1, b: 1 }], filter: ['vcf', { cutoff: 700, resonance: 0.12 }],
      fenv: env(0.06, 0.5, 0.55, 0.18), depth: ['cv', { scale: 1.3 }],
      env: env(0.025, 0.3, 0.9, 0.18), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > osc2.pitch', 'osc.out > sum.a', 'osc2.out > sum.b',
    'sum.out > filter.audio', 'note.gate > fenv.gate', 'fenv.out > depth.in', 'depth.out > filter.cutoff',
    'filter.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain', 'amp.out > out.audio') },
    { name: 'Soft Sine Lead', patch: () => make({
      osc: ['vco', { wave: sine, level: 0.6 }], octave: ['vco', { wave: sine, octave: 1, level: 0.07 }],
      vibrato: ['lfo', { rate: 5.5, depth: 0.025 }], sum: ['mix', { a: 1, b: 1 }],
      env: env(0.015, 0.2, 1, 0.22), amp: ['vca'],
    }, 'note.pitch > osc.pitch', 'note.pitch > octave.pitch', 'vibrato.out > osc.fm', 'vibrato.out > octave.fm',
    'osc.out > sum.a', 'octave.out > sum.b', 'sum.out > amp.audio', 'note.gate > env.gate', 'env.out > amp.gain',
    'amp.out > out.audio') },
    { name: 'Plucked String', patch: () => make({
      string: ['string', { decay: 3, release: 0.25, brightness: 0.65, level: 0.7 }],
      body: ['vcf', { cutoff: 5000, resonance: 0.1 }],
    }, 'note.pitch > string.pitch', 'note.gate > string.gate', 'string.out > body.audio', 'body.out > out.audio') },
    { name: 'Marimba', patch: () => make({
      bar: ['modal', { material: 0, decay: 0.9, release: 0.6, brightness: 0.35, level: 0.7 }],
    }, 'note.pitch > bar.pitch', 'note.gate > bar.gate', 'bar.out > out.audio') },
    { name: 'Church Bell', patch: () => make({
      bell: ['modal', { material: 4, decay: 6, release: 4, brightness: 0.7, level: 0.45 }],
    }, 'note.pitch > bell.pitch', 'note.gate > bell.gate', 'bell.out > out.audio') },
  ];
}

/** Validate and normalize a portable patch before publishing it to the DSP. */
export function compileModularPatch(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.cables) ||
      raw.nodes.length < 1 || raw.nodes.length > 32 || raw.cables.length > 128)
    throw new Error('Invalid modular patch size');
  if (raw.version !== undefined && raw.version !== 1) throw new Error('Unsupported modular patch version');
  const ids = new Map();
  const nodes = raw.nodes.map((n, i) => {
    if (!n || typeof n.id !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(n.id) ||
        ids.has(n.id) || !Object.hasOwn(MODULAR_TYPES, n.type))
      throw new Error('Invalid or duplicate module');
    ids.set(n.id, i);
    const spec = MODULAR_TYPES[n.type];
    const params = {};
    for (const [key, def] of Object.entries(spec.params)) {
      const rawValue = n.params?.[key];
      params[key] = typeof rawValue === 'number' && Number.isFinite(rawValue)
        ? Math.max(def.min, Math.min(def.max, rawValue)) : def.default;
      if (def.step >= 1) params[key] = Math.round(params[key]);
    }
    return { id: n.id, type: n.type, params, links: {}, paramLinks: {} };
  });
  if (!nodes.some((n) => n.type === 'output')) throw new Error('An audio output is required');
  let lineCount = 0;
  for (const n of nodes) n.line = LINE_TYPES.has(n.type) ? lineCount++ : -1;
  if (lineCount > MODULAR_LINES) throw new Error(`Use at most ${MODULAR_LINES} strings or comb filters`);
  const adjacency = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  for (const cable of raw.cables) {
    const src = ids.get(cable?.from);
    const dst = ids.get(cable?.to);
    if (src === undefined || dst === undefined) throw new Error('Invalid cable endpoint');
    const dest = MODULAR_TYPES[nodes[dst].type];
    const parameter = typeof cable.input === 'string' && cable.input.startsWith('param:') &&
      Object.hasOwn(dest.params, cable.input.slice(6));
    if (!MODULAR_TYPES[nodes[src].type].outputs.includes(cable.port) ||
        (!dest.inputs.includes(cable.input) && !parameter) ||
        nodes[dst].links[cable.input]) throw new Error('Invalid or duplicate cable');
    const link = { index: src, port: cable.port };
    nodes[dst].links[cable.input] = link;
    if (parameter) nodes[dst].paramLinks[cable.input.slice(6)] = link;
    // Delay writes happen after all current-sample readers, including self-feedback.
    if (nodes[dst].type !== 'delay') {
      adjacency[src].push(dst);
      degree[dst]++;
    }
  }
  const queue = [];
  for (let i = 0; i < nodes.length; i++) if (degree[i] === 0) queue.push(i);
  const order = [];
  for (let pos = 0; pos < queue.length; pos++) {
    const i = queue[pos];
    order.push(i);
    for (const j of adjacency[i]) if (--degree[j] === 0) queue.push(j);
  }
  if (order.length !== nodes.length) throw new Error('Add a Unit Delay to each feedback loop');
  const delays = order.filter(i => nodes[i].type === 'delay');
  const outputs = order.filter(i => nodes[i].type === 'output');
  const audible = new Set(outputs);
  for (const i of audible) for (const link of Object.values(nodes[i].links)) audible.add(link.index);
  const envelopes = [...audible].filter(i => RINGING_TYPES.has(nodes[i].type));
  const macros = Array.from({ length: MODULAR_MACROS }, (_, i) =>
    Number.isFinite(raw.macros?.[i]) ? clamp(raw.macros[i], 0, 1) : 0);
  return {
    nodes, order, delays, outputs, envelopes, lineCount,
    meterSources: [...new Map(raw.cables.map(c => {
      const key = c.from + '/' + c.port;
      return [key, { key, index: ids.get(c.from), port: c.port }];
    })).values()],
    patch: { version: 1, macros, nodes: nodes.map(({ id, type, params }, i) => {
      const position = raw.nodes[i].position;
      return Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { id, type, params, position: {
          x: Math.round(clamp(position.x, 0, MODULAR_POSITION_MAX)),
          y: Math.round(clamp(position.y, 0, MODULAR_POSITION_MAX)),
        } }
        : { id, type, params };
    }),
      cables: raw.cables.map(({ from, port, to, input }) => ({ from, port, to, input })) },
  };
}

export function safeModularPatch(raw) {
  try { return compileModularPatch(raw).patch; }
  catch { return defaultModularPatch(); }
}

const MAX_VOICES = 8;
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const LN1000 = 6.907755278982137; // a T60 decay falls by a factor of 1000
const MASK = MODULAR_LINE_SAMPLES - 1;
// One-pole smoothing step for a time constant in seconds; zero follows instantly.
const lag = (time, rate) => time <= 0 ? 1 : 1 - Math.exp(-1 / (time * rate));
function lineRead(line, write, delay) {
  const pos = write - delay;
  const i = Math.floor(pos), frac = pos - i;
  return line[i & MASK] * (1 - frac) + line[(i + 1) & MASK] * frac;
}
const blep = (t, dt) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
function newStage() {
  return { phase: 0, env: 0, mode: 0, release: 0, ic1: 0, ic2: 0, memory: 0, lastGate: false,
    rng: 1, p0: 0, p1: 0, p2: 0, value: 0, ready: false, write: 0, prev: 0, amp: 0,
    y1: new Float64Array(MODULAR_MODES), y2: new Float64Array(MODULAR_MODES),
    a1: new Float64Array(MODULAR_MODES), a2: new Float64Array(MODULAR_MODES), b: new Float64Array(MODULAR_MODES),
    key: new Float64Array(6).fill(NaN) };
}
// Same seed and generator as the native engine, so noise is identical in both.
function resetStage(st, age, index) {
  st.phase = st.env = st.mode = st.release = st.ic1 = st.ic2 = st.memory = 0;
  st.p0 = st.p1 = st.p2 = st.value = st.write = st.prev = st.amp = 0;
  st.lastGate = st.ready = false;
  st.rng = (Math.imul(age, 0x9e3779b1) + Math.imul(index + 1, 0x85ebca77)) >>> 0 || 1;
  st.y1.fill(0); st.y2.fill(0); st.key.fill(NaN);
}
function white(st) {
  let x = st.rng;
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5; x >>>= 0;
  st.rng = x;
  return x / 4294967296 * 2 - 1;
}
function newVoice(nodeCount) {
  return { active: false, keyDown: false, held: false, channel: 0, note: -1, velocity: 0,
    age: 0, tail: 0,
    stages: Array.from({ length: nodeCount }, newStage),
    signals: Array.from({ length: nodeCount }, () => ({})),
    lines: Array.from({ length: MODULAR_LINES }, () => new Float32Array(MODULAR_LINE_SAMPLES)) };
}

export function modular_init(s, sampleRate) {
  s.sampleRate = sampleRate;
  s.bend = new Float64Array(16);
  s.sustain = new Uint8Array(16);
  s.tick = 0;
  s.out_l = 0; s.out_r = 0;
  modular_set_patch(s, defaultModularPatch());
}

export function modular_set_patch(s, patch) {
  const graph = compileModularPatch(patch);
  const old = s.graph;
  s.graph = graph;
  if (s.meter) modular_meter_enable(s, true);
  if (old && old.nodes.length === graph.nodes.length &&
      old.patch.cables.length === graph.patch.cables.length &&
      old.nodes.every((n, i) => n.id === graph.nodes[i].id && n.type === graph.nodes[i].type) &&
      old.patch.cables.every((c, i) => Object.keys(c).every(k => c[k] === graph.patch.cables[i][k]))) return;
  s.voices = Array.from({ length: MAX_VOICES }, () => newVoice(graph.nodes.length));
}

export function modular_all_notes_off(s) {
  s.sustain.fill(0);
  for (const v of s.voices) v.active = false;
}

export function modular_midi(s, status, d1, d2) {
  const op = status & 0xf0, channel = status & 0x0f;
  if (op === 0xe0) { s.bend[channel] = (((d2 << 7) | d1) - 8192) / 4096; return; }
  if (op === 0xb0) {
    if (d1 === 64) s.sustain[channel] = d2 >= 64;
    for (const v of s.voices) {
      if (v.channel !== channel) continue;
      if (d1 === 120) v.active = false;
      if (d1 === 123) v.keyDown = false;
      if ((d1 === 64 || d1 === 123) && !v.keyDown && !s.sustain[channel]) v.held = false;
    }
    return;
  }
  if (!Number.isInteger(d1) || d1 < 0 || d1 > 127) return;
  if (op === 0x80 || (op === 0x90 && !d2)) {
    let oldest;
    for (const v of s.voices) {
      if (v.active && v.keyDown && v.channel === channel && v.note === d1 && (!oldest || v.age < oldest.age)) oldest = v;
    }
    if (oldest) { oldest.keyDown = false; oldest.held = !!s.sustain[channel]; }
    return;
  }
  if (op !== 0x90 || !Number.isFinite(d2) || d2 < 1 || d2 > 127) return;
  let v = s.voices.find(voice => !voice.active);
  if (!v) v = s.voices.reduce((a, b) => a.held === b.held ? (a.age < b.age ? a : b) : a.held ? b : a);
  const age = ++s.tick;
  for (let i = 0; i < v.stages.length; i++) {
    resetStage(v.stages[i], age, i);
    const sig = v.signals[i];
    sig.out = sig.pitch = sig.gate = sig.velocity = 0;
  }
  for (let i = 0; i < s.graph.lineCount; i++) v.lines[i].fill(0);
  v.active = v.held = v.keyDown = true;
  v.channel = channel; v.note = d1; v.velocity = d2 / 127; v.age = age; v.tail = 0;
}

function read(v, node, key, fallback = 0) {
  const link = node.links[key];
  return link ? v.signals[link.index][link.port] : fallback;
}
function parameter(v, node, key) {
  const link = node.paramLinks[key];
  const normal = node.params[key];
  if (!link) return normal;
  const def = MODULAR_TYPES[node.type].params[key];
  const value = clamp(v.signals[link.index][link.port], def.min, def.max);
  return def.step >= 1 ? Math.round(value) : value;
}

export function modular_meter_enable(s, enabled) {
  s.meter = enabled ? {
    remaining: 1,
    interval: 15,
    low: new Float64Array(s.graph.meterSources.length).fill(Infinity),
    high: new Float64Array(s.graph.meterSources.length).fill(-Infinity),
  } : null;
}

export function modular_meter_snapshot(s) {
  const { low, high } = s.meter;
  const moving = s.graph.meterSources.filter((_, i) => high[i] - low[i] > 1e-4).map(source => source.key);
  low.fill(Infinity);
  high.fill(-Infinity);
  return moving;
}

function measureSignals(s, voice) {
  const { low, high } = s.meter;
  const sources = s.graph.meterSources;
  for (let i = 0; i < sources.length; i++) {
    const { index, port } = sources[i];
    const value = voice ? voice.signals[index][port] : 0;
    if (value < low[i]) low[i] = value;
    if (value > high[i]) high[i] = value;
  }
}

function sampleNode(s, v, i) {
  const n = s.graph.nodes[i], st = v.stages[i], sig = v.signals[i];
  switch (n.type) {
    case 'midi':
      sig.pitch = v.note + s.bend[v.channel]; sig.gate = v.held ? 1 : 0; sig.velocity = v.velocity;
      break;
    case 'vco': {
      const waveType = parameter(v, n, 'wave');
      const note = read(v, n, 'pitch', 69) + 12 * parameter(v, n, 'octave') + parameter(v, n, 'detune') / 100 + read(v, n, 'fm') * 12;
      const frequency = clamp(440 * Math.pow(2, (note - 69) / 12), 0.01, s.sampleRate * 0.45);
      const dt = frequency / s.sampleRate, phase = st.phase;
      let wave;
      if (waveType === 0) wave = Math.sin(TAU * phase);
      else if (waveType === 1) wave = 2 * phase - 1 - blep(phase, dt);
      else if (waveType === 2) {
        wave = phase < 0.5 ? 1 : -1;
        wave += blep(phase, dt) - blep((phase + 0.5) % 1, dt);
      } else wave = 2 / Math.PI * Math.asin(Math.sin(TAU * phase));
      sig.out = wave * parameter(v, n, 'level');
      st.phase = (phase + dt) % 1;
      break;
    }
    case 'lfo': {
      const phase = st.phase;
      sig.out = (parameter(v, n, 'wave') ? 1 - 4 * Math.abs(phase - 0.5) : Math.sin(TAU * phase)) * parameter(v, n, 'depth');
      st.phase = (phase + parameter(v, n, 'rate') / s.sampleRate) % 1;
      break;
    }
    case 'adsr': {
      const sustain = parameter(v, n, 'sustain');
      const gate = read(v, n, 'gate') >= 0.5;
      if (gate && !st.lastGate) st.mode = 1;
      if (!gate && st.lastGate) { st.mode = 4; st.release = st.env; }
      st.lastGate = gate;
      if (st.mode === 1) {
        st.env += 1 / Math.max(1, parameter(v, n, 'attack') * s.sampleRate);
        if (st.env >= 1) { st.env = 1; st.mode = 2; }
      } else if (st.mode === 2) {
        st.env -= (1 - sustain) / Math.max(1, parameter(v, n, 'decay') * s.sampleRate);
        if (st.env <= sustain) { st.env = sustain; st.mode = 3; }
      } else if (st.mode === 3) st.env = sustain;
      else if (st.mode === 4) {
        st.env -= st.release / Math.max(1, parameter(v, n, 'release') * s.sampleRate);
        if (st.env <= 0) { st.env = 0; st.mode = 0; }
      }
      sig.out = st.env;
      break;
    }
    case 'vcf': {
      const track = parameter(v, n, 'keytrack') * (read(v, n, 'pitch', 60) - 60) / 12;
      const cutoff = clamp(parameter(v, n, 'cutoff') * Math.pow(2, read(v, n, 'cutoff') * 2 + track), 20, s.sampleRate * 0.45);
      const g = Math.tan(Math.PI * cutoff / s.sampleRate);
      const k = 2 - 1.95 * parameter(v, n, 'resonance');
      const a1 = 1 / (1 + g * (g + k));
      const input = read(v, n, 'audio');
      const hp = (input - (g + k) * st.ic1 - st.ic2) * a1;
      const bp = g * hp + st.ic1;
      const lp = g * bp + st.ic2;
      st.ic1 = 2 * bp - st.ic1; st.ic2 = 2 * lp - st.ic2;
      const mode = parameter(v, n, 'mode');
      const out = mode === 0 ? lp : mode === 1 ? hp : mode === 2 ? bp : lp + hp;
      sig.out = Number.isFinite(out) ? clamp(out, -16, 16) : 0;
      break;
    }
    case 'noise': {
      const w = white(st);
      if (parameter(v, n, 'color')) {
        // Paul Kellet's economy pink filter.
        st.p0 = 0.99765 * st.p0 + w * 0.0990460;
        st.p1 = 0.96300 * st.p1 + w * 0.2965164;
        st.p2 = 0.57000 * st.p2 + w * 1.0526913;
        sig.out = (st.p0 + st.p1 + st.p2 + w * 0.1848) * 0.25 * parameter(v, n, 'level');
      } else sig.out = w * parameter(v, n, 'level');
      break;
    }
    case 'sh': {
      let fire = !st.ready;
      if (n.links.trigger) {
        const gate = read(v, n, 'trigger') >= 0.5;
        if (gate && !st.lastGate) fire = true;
        st.lastGate = gate;
      } else {
        st.phase += parameter(v, n, 'rate') / s.sampleRate;
        if (st.phase >= 1) { st.phase -= 1; fire = true; }
      }
      if (fire) st.value = n.links.in ? read(v, n, 'in') : white(st);
      st.ready = true;
      sig.out = st.value;
      break;
    }
    case 'slew': {
      const x = read(v, n, 'in');
      if (!st.ready) { st.value = x; st.ready = true; }
      else st.value += (x - st.value) * lag(parameter(v, n, x > st.value ? 'rise' : 'fall'), s.sampleRate);
      sig.out = st.value;
      break;
    }
    case 'follower': {
      const x = Math.abs(read(v, n, 'in'));
      st.value += (x - st.value) * lag(parameter(v, n, x > st.value ? 'attack' : 'release'), s.sampleRate);
      sig.out = st.value * parameter(v, n, 'gain');
      break;
    }
    case 'ring': sig.out = read(v, n, 'a') * read(v, n, 'b', 1) * parameter(v, n, 'level'); break;
    case 'comb': {
      const line = v.lines[n.line];
      const delay = clamp(parameter(v, n, 'time') * s.sampleRate / 1000, 1, MODULAR_LINE_SAMPLES - 2);
      const y = lineRead(line, st.write, delay);
      const damping = parameter(v, n, 'damping');
      st.prev = y * (1 - damping) + st.prev * damping;
      const x = read(v, n, 'in');
      line[st.write] = clamp(x + parameter(v, n, 'feedback') * st.prev, -4, 4);
      st.write = (st.write + 1) & MASK;
      const mix = parameter(v, n, 'mix');
      sig.out = x * (1 - mix) + y * mix;
      break;
    }
    case 'string': {
      const line = v.lines[n.line];
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const brightness = parameter(v, n, 'brightness');
      if (gate && !st.lastGate) {
        // Pluck: fill the loop with noise, low-passed more for a darker tone.
        const c = 0.1 + 0.9 * brightness;
        let f = 0;
        for (let k = 0; k < MODULAR_LINE_SAMPLES; k++) { f += c * (white(st) - f); line[k] = f; }
      }
      st.lastGate = gate;
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12),
        s.sampleRate / (MODULAR_LINE_SAMPLES - 4), s.sampleRate * 0.45);
      // The loop filter adds half a sample of delay.
      const y = lineRead(line, st.write, Math.max(1, s.sampleRate / hz - 0.5));
      const smooth = 0.5 * (1 - brightness);
      const filtered = (1 - smooth) * y + smooth * st.prev;
      st.prev = y;
      const decay = parameter(v, n, 'decay');
      const t60 = gate ? decay : Math.min(decay, parameter(v, n, 'release'));
      line[st.write] = clamp(filtered * Math.exp(-LN1000 / (t60 * hz)) + read(v, n, 'excite'), -4, 4);
      st.write = (st.write + 1) & MASK;
      st.amp = Math.max(Math.abs(y), st.amp * 0.9995);
      st.mode = st.amp > 1e-4 ? 1 : 0;
      sig.out = y * parameter(v, n, 'level');
      break;
    }
    case 'modal': {
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const strike = gate && !st.lastGate ? 1 : 0;
      st.lastGate = gate;
      const material = parameter(v, n, 'material'), decay = parameter(v, n, 'decay');
      const t60 = gate ? decay : Math.min(decay, parameter(v, n, 'release'));
      const brightness = parameter(v, n, 'brightness');
      const hz = 440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12);
      const key = st.key;
      if (key[0] !== hz || key[1] !== material || key[2] !== t60 || key[3] !== brightness) {
        key[0] = hz; key[1] = material; key[2] = t60; key[3] = brightness;
        const mat = MATERIALS[material];
        for (let k = 0; k < MODULAR_MODES; k++) {
          const ratio = mat.ratios[k], f = hz * ratio;
          if (!(f > 0 && f < s.sampleRate * 0.45)) { st.a1[k] = st.a2[k] = st.b[k] = 0; continue; }
          // Darker settings damp the upper modes faster, as in the Physical instrument.
          const t = t60 / Math.max(0.25, 1 + (1 - brightness) * 4 * (ratio - 1));
          const r = Math.exp(-LN1000 / (t * s.sampleRate));
          const w = TAU * f / s.sampleRate;
          st.a1[k] = 2 * r * Math.cos(w); st.a2[k] = r * r; st.b[k] = mat.gains[k] * Math.sin(w);
        }
      }
      const x = read(v, n, 'in') + strike;
      let sum = 0;
      for (let k = 0; k < MODULAR_MODES; k++) {
        const y = st.b[k] * x + st.a1[k] * st.y1[k] - st.a2[k] * st.y2[k];
        st.y2[k] = st.y1[k]; st.y1[k] = y; sum += y;
      }
      st.amp = Math.max(Math.abs(sum), st.amp * 0.9995);
      st.mode = st.amp > 1e-4 ? 1 : 0;
      sig.out = clamp(sum * parameter(v, n, 'level'), -16, 16);
      break;
    }
    case 'vca': sig.out = read(v, n, 'audio') * read(v, n, 'gain', 1) * parameter(v, n, 'level'); break;
    case 'mix': sig.out = read(v, n, 'a') * parameter(v, n, 'a') + read(v, n, 'b') * parameter(v, n, 'b'); break;
    case 'cv': sig.out = read(v, n, 'in') * parameter(v, n, 'scale') + parameter(v, n, 'offset'); break;
    case 'macro': sig.out = s.graph.patch.macros[parameter(v, n, 'index') - 1]; break;
    case 'delay': sig.out = st.memory; break;
    case 'output': sig.out = read(v, n, 'audio') * parameter(v, n, 'level'); break;
  }
  // Bound every intermediate so a cascade of multipliers cannot overflow.
  sig.out = clamp(sig.out, -1e6, 1e6);
}
export function modular_render(s) {
  let out = 0;
  const { nodes, order, delays, outputs, envelopes } = s.graph;
  let meterVoice;
  for (const v of s.voices) {
    if (!v.active) continue;
    meterVoice ??= v;
    for (const i of order) sampleNode(s, v, i);
    for (const i of delays) v.stages[i].memory = clamp(read(v, nodes[i], 'in'), -4, 4);
    let sample = 0;
    for (const i of outputs) sample += v.signals[i].out;
    if (!v.held) {
      v.tail++;
      const fade = Math.max(1, Math.round(RELEASE_FADE * s.sampleRate));
      if (envelopes.length === 0 || v.tail > MAX_RELEASE * s.sampleRate) {
        const elapsed = envelopes.length ? v.tail - MAX_RELEASE * s.sampleRate : v.tail;
        sample *= clamp(1 - elapsed / fade, 0, 1);
        if (elapsed >= fade) v.active = false;
      } else if (envelopes.every(i => v.stages[i].mode === 0 && !v.stages[i].lastGate)) {
        v.active = false;
      }
    }
    out += sample;
  }
  if (s.meter && --s.meter.remaining === 0) {
    measureSignals(s, meterVoice);
    // Vary the stride to avoid measuring the same phase of a periodic signal.
    s.meter.remaining = s.meter.interval;
    s.meter.interval = s.meter.interval === 17 ? 15 : s.meter.interval + 1;
  }
  s.out_l = s.out_r = Math.tanh(out);
}
