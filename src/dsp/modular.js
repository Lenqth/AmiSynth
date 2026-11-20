// AmiSynth Modular: a small, independent, serializable graph DSP (no Web Audio dependencies).
// All cables carry a per-voice, audio-rate scalar. A Unit Delay breaks a feedback loop.
// The native CLAP engine (clap/src/modular_dsp.h) mirrors every module; keep the two in step.
import { MATERIALS } from './phys.js';
import { HAT_RATIOS } from './drums.js';
import { MODULAR_SYNTH_PORTS } from '../presets/modular.js';

// Native storage limits per module (checked by scripts/gen-modular-clap.js).
export const MODULAR_MAX_INPUTS = 4;
export const MODULAR_MAX_PARAMS = 10;
export const MODULAR_MAX_OUTPUTS = 4;
export const BEAT_GRID_LANES = ['a', 'b', 'c', 'd'];
export const BEAT_GRID_MAX_STEPS = 32;
// Strings and comb filters share a fixed, preallocated delay-line pool per voice.
export const MODULAR_LINES = 4;
export const MODULAR_LINE_SAMPLES = 4096;
export const MODULAR_MODES = 8;
export const MODULAR_MATERIALS = MATERIALS;
export const MODULAR_MODAL_FIELDS = {
  ratio: { label: 'Frequency ratio', min: 0.125, max: 128 },
  gain: { label: 'Gain', min: 0, max: 1 },
  decay: { label: 'Decay multiplier', min: 0.1, max: 4 },
};

export function modularMaterialTable(index) {
  const material = MATERIALS[index];
  return material.ratios.map((ratio, i) => ({ ratio, gain: material.gains[i], decay: 1 }));
}

function normalizeModalTable(table) {
  if (!Array.isArray(table) || table.length < 1 || table.length > MODULAR_MODES)
    throw new Error(`A resonance table needs 1–${MODULAR_MODES} modes`);
  return Array.from(table, (row, i) => {
    const values = {};
    for (const [key, { label, min, max }] of Object.entries(MODULAR_MODAL_FIELDS)) {
      const value = row?.[key];
      if (!Number.isFinite(value) || value < min || value > max)
        throw new Error(`Mode ${i + 1}: ${label} must be between ${min} and ${max}`);
      values[key] = value;
    }
    return values;
  });
}

export const MODULAR_CATEGORIES = ['Sources', 'Physical', 'Drums', 'Filters & Effects', 'Modulation', 'Utilities', 'Input & Output'];
export const MODULAR_DRUM_PITCH = [52, 180, 1100, 205.3, 205.3, 105];
export const MODULAR_DRUM_DECAY = [1, 0.8, 0.85, 0.2, 1.8, 0.9];

export const MODULAR_TYPES = Object.freeze({
  // The first MIDI / Note module's knobs set how notes reach voices. They are patch settings,
  // not per-voice signals, so they take no cable ("fixed").
  midi: { label: 'MIDI / Note', category: 'Input & Output', keywords: 'keyboard pitch gate velocity trigger mono legato glide portamento',
    inputs: [], outputs: ['pitch', 'gate', 'velocity'], params: {
      voices: { min: 0, max: 2, default: 0, step: 1, choices: ['Poly', 'Mono', 'Legato'], fixed: true },
      glide: { min: 0, max: 2, default: 0, step: 0.001, fixed: true },
      glideMode: { min: 0, max: 1, default: 0, step: 1, choices: ['Always', 'Legato only'], fixed: true },
    } },
  vco: { label: 'VCO', category: 'Sources', keywords: 'oscillator saw square pulse sine triangle tone sync fm pm',
    // The sync output is 1 for the sample where the cycle restarts; patch it into another VCO's sync.
    inputs: ['pitch', 'fm', 'sync', 'pm'], outputs: ['out', 'sync'], params: {
      wave: { min: 0, max: 3, default: 1, step: 1, choices: ['Sine', 'Saw', 'Square', 'Triangle'] },
      octave: { min: -3, max: 3, default: 0, step: 1 },
      detune: { min: -1200, max: 1200, default: 0, step: 1 },
      level: { min: 0, max: 1, default: 0.4, step: 0.01 },
      pw: { min: 0.02, max: 0.98, default: 0.5, step: 0.01 },
      // Where each note's cycle starts; spread copies so they do not start in step.
      phase: { min: 0, max: 1, default: 0, step: 0.01 },
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
  bowed: { label: 'Bowed String', category: 'Physical', keywords: 'bow violin cello friction waveguide bowed string',
    inputs: ['pitch', 'gate', 'bow'], outputs: ['out'], params: {
      speed: { min: 0, max: 1, default: 0.42, step: 0.01 },
      pressure: { min: 0.5, max: 8, default: 3, step: 0.01 },
      position: { min: 0.08, max: 0.42, default: 0.14, step: 0.001 },
      damping: { min: 0, max: 0.9, default: 0.27, step: 0.01 },
      level: { min: 0, max: 1, default: 0.65, step: 0.01 },
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
      // Exponential: decay and release fall to -60 dB in their time, like the Synth instrument.
      curve: { min: 0, max: 1, default: 0, step: 1, choices: ['Linear', 'Exponential'] },
    } },
  sh: { label: 'Sample & Hold', category: 'Modulation', keywords: 'random stepped s&h clock',
    inputs: ['in', 'trigger'], outputs: ['out'], params: {
      rate: { min: 0.01, max: 50, default: 8, step: 0.01 },
    } },
  functionGen: { label: 'Function Generator', category: 'Modulation', keywords: 'attack decay envelope ad loop ramp trigger cycle',
    inputs: ['trigger', 'run'], outputs: ['out', 'eoc'], params: {
      rise: { min: 0.001, max: 5, default: 0.01, step: 0.001 },
      fall: { min: 0.001, max: 5, default: 0.25, step: 0.001 },
      curve: { min: -1, max: 1, default: 0, step: 0.01 },
      loop: { min: 0, max: 1, default: 0, step: 1, choices: ['One shot', 'Loop'] },
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
      from: { min: -24000, max: 24000, default: 0, step: 0.01 },
      to: { min: -24000, max: 24000, default: 1, step: 0.01 },
      curve: { min: -1, max: 1, default: 0, step: 0.01 },
    } },
  clock: { label: 'Clock', category: 'Modulation', keywords: 'tempo bpm pulse time sequencer',
    inputs: [], outputs: ['gate', 'phase'], params: {
      bpm: { min: 20, max: 300, default: 120, step: 0.1, fixed: true },
      pulses: { min: 1, max: 16, default: 4, step: 1, fixed: true },
      duty: { min: 0.01, max: 0.99, default: 0.5, step: 0.01, fixed: true },
    } },
  divider: { label: 'Clock Divider', category: 'Modulation', keywords: 'clock pulse divide rhythm',
    inputs: ['clock', 'reset'], outputs: ['gate'], params: {
      division: { min: 1, max: 32, default: 2, step: 1 },
    } },
  gatedClock: { label: 'Gated Clock', category: 'Modulation', keywords: 'tempo bpm pulse time rhythm held gate sequencer',
    inputs: ['run'], outputs: ['gate', 'phase', 'reset'], params: {
      bpm: { min: 20, max: 300, default: 120, step: 0.1 },
      pulses: { min: 1, max: 16, default: 2, step: 1 },
      duty: { min: 0.01, max: 0.99, default: 0.5, step: 0.01 },
    } },
  beatGrid: { label: 'Beat Grid', category: 'Modulation', keywords: 'step trigger pattern rhythm drum clock router matrix',
    inputs: ['clock', 'reset'], outputs: BEAT_GRID_LANES, params: {
      length: { min: 1, max: BEAT_GRID_MAX_STEPS, default: 8, step: 1, fixed: true },
    } },
  sequencer: { label: 'Step Sequencer', category: 'Modulation', keywords: 'step sequence pattern pitch gate cv probability',
    inputs: ['clock', 'reset'], outputs: ['cv', 'gate'], params: {
      length: { min: 1, max: 8, default: 8, step: 1 },
      probability: { min: 0, max: 1, default: 1, step: 0.01 },
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [
        'step' + (i + 1), { min: -24, max: 127, default: 0, step: 0.01 },
      ])),
    } },
  quantizer: { label: 'Pitch Quantizer', category: 'Utilities', keywords: 'scale tuning pitch chromatic major minor pentatonic',
    inputs: ['pitch'], outputs: ['out'], params: {
      root: { min: 0, max: 11, default: 0, step: 1,
        choices: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] },
      scale: { min: 0, max: 4, default: 0, step: 1,
        choices: ['Chromatic', 'Major', 'Natural minor', 'Major pentatonic', 'Minor pentatonic'] },
    } },
  drumVoice: { label: 'Drum Voice', category: 'Drums', keywords: 'percussion kick snare clap hihat hi-hat closed open tom choke',
    inputs: ['trigger', 'velocity', 'choke'], outputs: ['out'], params: {
      sound: { min: 0, max: 5, default: 0, step: 1, choices: ['Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Tom'] },
      tune: { min: -24, max: 24, default: 0, step: 0.1 },
      decay: { min: 0.025, max: 2.5, default: 0.25, step: 0.001 },
      tone: { min: 0, max: 1, default: 0.5, step: 0.01 },
      level: { min: 0, max: 1, default: 0.65, step: 0.01 },
    } },
  vcf: { label: 'VCF', category: 'Filters & Effects', keywords: 'filter lowpass highpass bandpass notch cutoff resonance keytrack',
    inputs: ['audio', 'cutoff', 'pitch'], outputs: ['out'], params: {
      cutoff: { min: 20, max: 18000, default: 2400, step: 1 },
      resonance: { min: 0, max: 0.95, default: 0.15, step: 0.01 },
      mode: { min: 0, max: 3, default: 0, step: 1, choices: ['Lowpass', 'Highpass', 'Bandpass', 'Notch'] },
      keytrack: { min: 0, max: 1, default: 0, step: 0.01 },
      slope: { min: 0, max: 1, default: 0, step: 1, choices: ['12 dB', '24 dB'] },
      drive: { min: 0, max: 1, default: 0, step: 0.01 },
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
  wavefolder: { label: 'Wavefolder / Shaper', category: 'Filters & Effects', keywords: 'wavefold distortion saturation harmonics',
    inputs: ['in'], outputs: ['out'], params: {
      drive: { min: 0, max: 16, default: 4, step: 0.01 },
      bias: { min: -1, max: 1, default: 0, step: 0.01 },
      mix: { min: 0, max: 1, default: 1, step: 0.01 },
      shape: { min: 0, max: 1, default: 0, step: 1, choices: ['Fold', 'Soft clip'] },
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
  mix4: { label: 'Mixer (4)', category: 'Utilities', keywords: 'sum add combine four',
    inputs: ['a', 'b', 'c', 'd'], outputs: ['out'], params: {
      a: { min: 0, max: 2, default: 0.5, step: 0.01 },
      b: { min: 0, max: 2, default: 0.5, step: 0.01 },
      c: { min: 0, max: 2, default: 0.5, step: 0.01 },
      d: { min: 0, max: 2, default: 0.5, step: 0.01 },
    } },
  cv: { label: 'CV Scale / Offset', category: 'Utilities', keywords: 'attenuator offset scale bias',
    inputs: ['in'], outputs: ['out'], params: {
      scale: { min: -8, max: 8, default: 1, step: 0.01 },
      offset: { min: -8, max: 8, default: 0, step: 0.01 },
    } },
  delay: { label: 'Unit Delay', category: 'Utilities', keywords: 'feedback one sample z-1',
    inputs: ['in'], outputs: ['out'], params: {} },
  pan: { label: 'Pan / Spread', category: 'Utilities', keywords: 'stereo balance panner voice spread',
    inputs: ['in'], outputs: ['left', 'right'], params: {
      pan: { min: -1, max: 1, default: 0, step: 0.01 },
      spread: { min: 0, max: 1, default: 0, step: 0.01 },
    } },
  output: { label: 'Audio output', category: 'Input & Output', keywords: 'out speaker master',
    inputs: ['audio', 'right'], outputs: [], params: {
      level: { min: 0, max: 1, default: 0.8, step: 0.01 },
    } },
});

const LINE_TYPES = new Set(['string', 'comb']);
// Modules that ring on after their gate falls; a released voice lives until they are quiet.
const RINGING_TYPES = new Set(['adsr', 'functionGen', 'string', 'modal', 'bowed']);
const QUANTIZER_SCALES = [0xfff, 0xab5, 0x5ad, 0x295, 0x4a9];

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
  { name: 'Falling Glass', patch: () => ({
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'osc', type: 'vco', params: { wave: 0, level: 0.68 }, position: { x: 296, y: 22 } },
      { id: 'shape', type: 'functionGen', params: { rise: 0.003, fall: 0.33, curve: 0.35 }, position: { x: 296, y: 442 } },
      { id: 'sweep', type: 'cv', params: { scale: 0.18 }, position: { x: 570, y: 442 } },
      { id: 'amp', type: 'vca', position: { x: 570, y: 22 } },
      { id: 'out', type: 'output', position: { x: 844, y: 22 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'shape', input: 'trigger' },
      { from: 'shape', port: 'out', to: 'sweep', input: 'in' },
      { from: 'sweep', port: 'out', to: 'osc', input: 'fm' },
      { from: 'shape', port: 'out', to: 'amp', input: 'gain' },
      { from: 'osc', port: 'out', to: 'amp', input: 'audio' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  }) },
  { name: 'Vibrato Lead', patch() {
    const patch = defaultModularPatch();
    patch.nodes.push({ id: 'vibrato', type: 'lfo', params: { rate: 5.2, depth: 0.035 } });
    patch.cables.push({ from: 'vibrato', port: 'out', to: 'osc', input: 'fm' });
    return patch;
  } },
  { name: 'Folded Reed', patch: () => ({
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'osc', type: 'vco', params: { wave: 0, level: 0.7 }, position: { x: 296, y: 22 } },
      { id: 'fold', type: 'wavefolder', params: { bias: 0.12, mix: 0.82 }, position: { x: 570, y: 22 } },
      { id: 'filter', type: 'vcf', params: { cutoff: 3500, resonance: 0.19, keytrack: 0.4 }, position: { x: 844, y: 22 } },
      { id: 'amp', type: 'vca', params: { level: 0.58 }, position: { x: 1118, y: 22 } },
      { id: 'out', type: 'output', position: { x: 1392, y: 22 } },
      { id: 'env', type: 'adsr', params: { attack: 0.025, decay: 0.21, sustain: 0.36, release: 0.18, curve: 1 }, position: { x: 296, y: 442 } },
      { id: 'drive', type: 'cv', params: { scale: 6.5, offset: 1.25 }, position: { x: 570, y: 442 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'pitch', to: 'filter', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'env', port: 'out', to: 'drive', input: 'in' },
      { from: 'drive', port: 'out', to: 'fold', input: 'param:drive' },
      { from: 'osc', port: 'out', to: 'fold', input: 'in' },
      { from: 'fold', port: 'out', to: 'filter', input: 'audio' },
      { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  }) },
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
  { name: 'Stereo Drift', patch: () => ({
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'osc', type: 'vco', params: { wave: 3, level: 0.52 }, position: { x: 296, y: 22 } },
      { id: 'amp', type: 'vca', position: { x: 570, y: 22 } },
      { id: 'pan', type: 'pan', params: { spread: 0.42 }, position: { x: 844, y: 22 } },
      { id: 'out', type: 'output', position: { x: 1118, y: 22 } },
      { id: 'env', type: 'adsr', params: { attack: 0.065, decay: 0.32, sustain: 0.68, release: 0.48 }, position: { x: 570, y: 442 } },
      { id: 'drift', type: 'lfo', params: { rate: 0.43, depth: 0.55 }, position: { x: 844, y: 442 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'osc', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'pan', input: 'in' },
      { from: 'drift', port: 'out', to: 'pan', input: 'param:pan' },
      { from: 'pan', port: 'left', to: 'out', input: 'audio' },
      { from: 'pan', port: 'right', to: 'out', input: 'right' },
    ],
  }) },
  { name: 'Bow Grain', patch: bowGrain },
  { name: 'Low Bow Cello', patch() {
    const patch = bowGrain({ speed: 0.38, pressure: 3.5, position: 0.2, damping: 0.39 },
      { cutoff: 1750, resonance: 0.35 });
    patch.nodes[0].params = { voices: 2, glide: 0.065, glideMode: 1 };
    patch.nodes.push({ id: 'octave', type: 'cv', params: { offset: -12 }, position: { x: 22, y: 442 } });
    patch.cables[0] = { from: 'octave', port: 'out', to: 'bow', input: 'pitch' };
    patch.cables.push({ from: 'note', port: 'pitch', to: 'octave', input: 'in' });
    return patch;
  } },
  { name: 'Shivering Bow', patch() {
    const patch = bowGrain({ speed: 0.33, position: 0.12, damping: 0.2 },
      { cutoff: 4400, resonance: 0.32 });
    patch.nodes.push(
      { id: 'shake', type: 'lfo', params: { rate: 5.7 }, position: { x: 22, y: 442 } },
      { id: 'pressure', type: 'cv', params: { scale: 0.48, offset: 3.2 }, position: { x: 296, y: 442 } },
    );
    patch.cables.push(
      { from: 'shake', port: 'out', to: 'pressure', input: 'in' },
      { from: 'pressure', port: 'out', to: 'bow', input: 'param:pressure' },
    );
    return patch;
  } },
  ...physicalPresets(),
  { name: 'Twin Glass', patch: () => ({
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'glass', type: 'modal', position: { x: 296, y: 22 },
        params: { decay: 2.9, release: 1.1, brightness: 0.78, level: 0.32 },
        modalTable: [
          { ratio: 1, gain: 0.75, decay: 1.1 },
          { ratio: 1.009, gain: 0.66, decay: 1 },
          { ratio: 2.31, gain: 0.42, decay: 0.85 },
          { ratio: 4.18, gain: 0.27, decay: 0.58 },
          { ratio: 6.57, gain: 0.13, decay: 0.44 },
        ] },
      { id: 'out', type: 'output', position: { x: 570, y: 22 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'glass', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'glass', input: 'gate' },
      { from: 'glass', port: 'out', to: 'out', input: 'audio' },
    ],
  }) },
  { name: 'Macro Morph', patch: () => ({
    macros: [0.28],
    macroNames: ['Tone'],
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'osc', type: 'vco', params: { wave: 1, level: 0.37 }, position: { x: 296, y: 22 } },
      { id: 'filter', type: 'vcf', params: { slope: 1, keytrack: 0.35 }, position: { x: 570, y: 22 } },
      { id: 'amp', type: 'vca', position: { x: 844, y: 22 } },
      { id: 'out', type: 'output', position: { x: 1118, y: 22 } },
      { id: 'env', type: 'adsr', params: { attack: 0.02, decay: 0.24, sustain: 0.68, release: 0.27 }, position: { x: 570, y: 442 } },
      { id: 'cutoff', type: 'macro', params: { index: 1, from: 380, to: 6400, curve: 0.45 }, position: { x: 22, y: 442 } },
      { id: 'resonance', type: 'macro', params: { index: 1, from: 0.53, to: 0.12, curve: -0.35 }, position: { x: 296, y: 442 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'pitch', to: 'filter', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'osc', port: 'out', to: 'filter', input: 'audio' },
      { from: 'cutoff', port: 'out', to: 'filter', input: 'param:cutoff' },
      { from: 'resonance', port: 'out', to: 'filter', input: 'param:resonance' },
      { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  }) },
  { name: 'Clockwork Plucks', patch: () => ({
    nodes: [
      { id: 'note', type: 'midi', params: { voices: 2 }, position: { x: 22, y: 22 } },
      { id: 'beat', type: 'gatedClock', params: { bpm: 112, pulses: 4, duty: 0.6 }, position: { x: 296, y: 22 } },
      { id: 'divide', type: 'divider', params: { division: 2 }, position: { x: 570, y: 22 } },
      { id: 'seq', type: 'sequencer',
        params: { step1: 48, step2: 55, step3: 61.7, step4: 63,
          step5: 60, step6: 58, step7: 55, step8: 51, probability: 0.9 },
        position: { x: 844, y: 22 } },
      { id: 'scale', type: 'quantizer', params: { scale: 2 }, position: { x: 1118, y: 22 } },
      { id: 'string', type: 'string', params: { decay: 0.4, release: 0.22 }, position: { x: 1392, y: 22 } },
      { id: 'out', type: 'output', position: { x: 1666, y: 22 } },
    ],
    cables: [
      { from: 'beat', port: 'gate', to: 'divide', input: 'clock' },
      { from: 'beat', port: 'reset', to: 'divide', input: 'reset' },
      { from: 'beat', port: 'reset', to: 'seq', input: 'reset' },
      { from: 'divide', port: 'gate', to: 'seq', input: 'clock' },
      { from: 'seq', port: 'cv', to: 'scale', input: 'pitch' },
      { from: 'scale', port: 'out', to: 'string', input: 'pitch' },
      { from: 'seq', port: 'gate', to: 'string', input: 'gate' },
      { from: 'string', port: 'out', to: 'out', input: 'audio' },
    ],
  }) },
  { name: 'Patch Beat', patch: () => drumPattern(114, [
    { id: 'kick', params: { sound: 0, level: 0.75 }, steps: [1, 0, 0, 1, 1, 0, 0, 0] },
    { id: 'snare', params: { sound: 1, level: 0.67 }, steps: [0, 0, 1, 0, 0, 0, 1, 0] },
    { id: 'hat', params: { sound: 3, level: 0.38 }, steps: [0.65, 0.35, 0.5, 0.3, 0.65, 0.35, 0.5, 0.5] },
  ]) },
  { name: 'Choked Hats', patch: () => drumPattern(126, [
    { id: 'closed', params: { sound: 3, level: 0.5 }, steps: [0.8, 0, 0.65, 0, 0.8, 0, 0.65, 0] },
    { id: 'open', params: { sound: 4, decay: 0.55, level: 0.62 }, chokedBy: 'closed',
      steps: [0, 0.8, 0, 0.6, 0, 0.8, 0, 0.67] },
    { id: 'kick', params: { sound: 0, level: 0.62 }, steps: [1, 0, 0, 0, 0.85, 0, 0, 0] },
  ]) },
  { name: 'Clap and Toms', patch: () => drumPattern(106, [
    { id: 'low', params: { sound: 5, tune: -7, level: 0.72 }, steps: [1, 0, 0, 0.55, 0.85, 0, 0, 0] },
    { id: 'clap', params: { sound: 2, level: 0.78 }, steps: [0, 0, 0.9, 0, 0, 0, 1, 0] },
    { id: 'high', params: { sound: 5, tune: 7, decay: 0.19, level: 0.6 }, steps: [0, 0.58, 0, 0, 0, 0.62, 0, 0.85] },
  ]) },
  { name: 'Four Lane Beat', patch: fourLaneBeat },
  ...MODULAR_SYNTH_PORTS,
];

function bowGrain(bow = {}, body = { cutoff: 3200, resonance: 0.23 }) {
  return {
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'bow', type: 'bowed', params: bow, position: { x: 296, y: 22 } },
      { id: 'body', type: 'vcf', params: body, position: { x: 570, y: 22 } },
      { id: 'out', type: 'output', position: { x: 844, y: 22 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'bow', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'bow', input: 'gate' },
      { from: 'note', port: 'velocity', to: 'bow', input: 'bow' },
      { from: 'bow', port: 'out', to: 'body', input: 'audio' },
      { from: 'body', port: 'out', to: 'out', input: 'audio' },
    ],
  };
}

// Patches for the physical modules. The Synth ports follow (src/presets/modular.js).
function physicalPresets() {
  // nodes: { id: [type, params] }; cables: 'from.port > to.input'
  const make = (nodes, ...cables) => ({
    nodes: [{ id: 'note', type: 'midi' }, { id: 'out', type: 'output' },
      ...Object.entries(nodes).map(([id, [type, params = {}]]) => ({ id, type, params }))],
    cables: cables.map(text => {
      const [[from, port], [to, input]] = text.split('>').map(end => end.trim().split('.'));
      return { from, port, to, input };
    }),
  });
  return [
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

function fourLaneBeat() {
  const nodes = [
    { id: 'note', type: 'midi', params: { voices: 2 }, position: { x: 22, y: 22 } },
    { id: 'clock', type: 'gatedClock', params: { bpm: 118 }, position: { x: 296, y: 22 } },
    { id: 'grid', type: 'beatGrid', grid: [5, 8, 6, 1, 5, 8, 6, 4], position: { x: 570, y: 22 } },
    { id: 'mix', type: 'mix4', params: { a: 0.8, b: 0.7, c: 0.5, d: 0.5 }, position: { x: 1118, y: 22 } },
    { id: 'out', type: 'output', position: { x: 1392, y: 22 } },
  ];
  const cables = [
    { from: 'clock', port: 'gate', to: 'grid', input: 'clock' },
    { from: 'clock', port: 'reset', to: 'grid', input: 'reset' },
    { from: 'grid', port: 'c', to: 'open', input: 'choke' },
    { from: 'mix', port: 'out', to: 'out', input: 'audio' },
  ];
  const voices = [['kick', 0, 0.75], ['snare', 1, 0.65], ['closed', 3, 0.47], ['open', 4, 0.5]];
  for (const [row, [id, sound, level]] of voices.entries()) {
    const lane = BEAT_GRID_LANES[row];
    nodes.push({ id, type: 'drumVoice', params: { sound, level }, position: { x: 844, y: 22 + 360 * row } });
    cables.push(
      { from: 'grid', port: lane, to: id, input: 'trigger' },
      { from: id, port: 'out', to: 'mix', input: lane },
    );
  }
  return { nodes, cables };
}

function drumPattern(bpm, patterns) {
  const nodes = [
    { id: 'note', type: 'midi', params: { voices: 2 }, position: { x: 22, y: 22 } },
    { id: 'beat', type: 'gatedClock', params: { bpm }, position: { x: 296, y: 22 } },
  ];
  const cables = [];
  for (const [row, { id, params, steps, chokedBy }] of patterns.entries()) {
    const y = 22 + row * 454;
    nodes.push(
      { id: id + '_steps', type: 'sequencer', position: { x: 570, y },
        params: { length: steps.length, ...Object.fromEntries(steps.map((value, i) => ['step' + (i + 1), value])) } },
      { id: id + '_trigger', type: 'ring', position: { x: 844, y } },
      { id, type: 'drumVoice', params, position: { x: 1118, y } },
    );
    cables.push(
      { from: 'beat', port: 'gate', to: id + '_steps', input: 'clock' },
      { from: 'beat', port: 'reset', to: id + '_steps', input: 'reset' },
      { from: id + '_steps', port: 'cv', to: id + '_trigger', input: 'a' },
      { from: id + '_steps', port: 'gate', to: id + '_trigger', input: 'b' },
      { from: id + '_trigger', port: 'out', to: id, input: 'trigger' },
      { from: id + '_steps', port: 'cv', to: id, input: 'velocity' },
      { from: id, port: 'out', to: 'mix', input: 'abcd'[row] },
    );
    if (chokedBy) cables.push({ from: chokedBy + '_trigger', port: 'out', to: id, input: 'choke' });
  }
  nodes.push(
    { id: 'mix', type: 'mix4', params: { a: 0.78, b: 0.66, c: 0.5 }, position: { x: 1392, y: 22 } },
    { id: 'out', type: 'output', position: { x: 1666, y: 22 } },
  );
  cables.push({ from: 'mix', port: 'out', to: 'out', input: 'audio' });
  return { nodes, cables };
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
    const modalTable = n.type === 'modal' && n.modalTable !== undefined ? normalizeModalTable(n.modalTable) : undefined;
    const grid = n.type === 'beatGrid' ? Array.from({ length: BEAT_GRID_MAX_STEPS }, (_, i) => {
      const value = Array.isArray(n.grid) ? n.grid[i] : n.params?.['step' + (i + 1)];
      return Number.isFinite(value) ? Math.round(clamp(value, 0, (1 << BEAT_GRID_LANES.length) - 1)) : 0;
    }) : undefined;
    return { id: n.id, type: n.type, params, modalTable, grid, links: {}, paramLinks: {} };
  });
  if (!nodes.some((n) => n.type === 'output')) throw new Error('An audio output is required');
  let lineCount = 0;
  for (const n of nodes) {
    const lines = n.type === 'bowed' ? 2 : Number(LINE_TYPES.has(n.type));
    n.line = lines ? lineCount : -1;
    lineCount += lines;
  }
  if (lineCount > MODULAR_LINES) throw new Error(`Use at most ${MODULAR_LINES} delay lines; each Bowed String uses two`);
  const adjacency = nodes.map(() => []);
  const degree = nodes.map(() => 0);
  for (const cable of raw.cables) {
    const src = ids.get(cable?.from);
    const dst = ids.get(cable?.to);
    if (src === undefined || dst === undefined) throw new Error('Invalid cable endpoint');
    const dest = MODULAR_TYPES[nodes[dst].type];
    const parameter = typeof cable.input === 'string' && cable.input.startsWith('param:') &&
      Object.hasOwn(dest.params, cable.input.slice(6)) && !dest.params[cable.input.slice(6)].fixed;
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
  const envelopes = [...audible].filter(i => RINGING_TYPES.has(nodes[i].type) || nodes[i].type === 'drumVoice');
  const macros = Array.from({ length: MODULAR_MACROS }, (_, i) =>
    Number.isFinite(raw.macros?.[i]) ? clamp(raw.macros[i], 0, 1) : 0);
  const macroNames = Array.from({ length: MODULAR_MACROS }, (_, i) => {
    const name = Array.isArray(raw.macroNames) ? raw.macroNames[i] : '';
    return typeof name === 'string' ? [...name].slice(0, 24).join('') : '';
  });
  const midi = nodes.find(n => n.type === 'midi');
  const clocks = order.filter(i => nodes[i].type === 'clock');
  const mono = { mode: midi?.params.voices ?? 0, glide: midi?.params.glide ?? 0, legatoOnly: midi?.params.glideMode ?? 0 };
  return {
    nodes, order, delays, outputs, envelopes, lineCount, mono, clocks, autonomous: clocks.length > 0 && !midi,
    meterSources: [...new Map(raw.cables.map(c => {
      const key = c.from + '/' + c.port;
      return [key, { key, index: ids.get(c.from), port: c.port }];
    })).values()],
    patch: { version: 1, macros, macroNames, nodes: nodes.map(({ id, type, params, modalTable, grid }, i) => {
      const position = raw.nodes[i].position;
      const saved = { id, type, params, ...(modalTable ? { modalTable } : {}), ...(grid ? { grid } : {}) };
      return Number.isFinite(position?.x) && Number.isFinite(position?.y)
        ? { ...saved, position: {
          x: Math.round(clamp(position.x, 0, MODULAR_POSITION_MAX)),
          y: Math.round(clamp(position.y, 0, MODULAR_POSITION_MAX)),
        } }
        : saved;
    }),
      cables: raw.cables.map(({ from, port, to, input }) => ({ from, port, to, input })) },
  };
}

export function safeModularPatch(raw) {
  try { return compileModularPatch(raw).patch; }
  catch { return defaultModularPatch(); }
}

function modularPresetSignature(patch) {
  // Layout changes should not mark a factory sound as edited.
  const nodes = patch.nodes.map(({ position, ...node }) => node);
  return JSON.stringify({ ...patch, nodes });
}

let factoryPresetIndices;
/** Match an already normalized patch to the factory list, or return -1 for Custom. */
export function modularPresetIndex(patch) {
  factoryPresetIndices ??= new Map(MODULAR_PRESETS.map((preset, index) => [
    modularPresetSignature(compileModularPatch(preset.patch()).patch), index,
  ]));
  return factoryPresetIndices.get(modularPresetSignature(patch)) ?? -1;
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
// The Synth instrument's soft clipper (tanh-like, exactly +/-1 beyond |x| >= 3).
function softClip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}
const blep = (t, dt) => {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
};
function newStage() {
  return { phase: 0, env: 0, mode: 0, release: 0, ic1: 0, ic2: 0, ic3: 0, ic4: 0, memory: 0, lastGate: false,
    rng: 1, p0: 0, p1: 0, p2: 0, value: 0, ready: false, write: 0, prev: 0, amp: 0,
    y1: new Float64Array(MODULAR_MODES), y2: new Float64Array(MODULAR_MODES),
    a1: new Float64Array(MODULAR_MODES), a2: new Float64Array(MODULAR_MODES), b: new Float64Array(MODULAR_MODES),
    key: new Float64Array(6).fill(NaN) };
}
// Same seed and generator as the native engine, so noise is identical in both.
function resetStage(st, age, index) {
  st.phase = st.env = st.mode = st.release = st.ic1 = st.ic2 = st.ic3 = st.ic4 = st.memory = 0;
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
function newVoice(nodeCount, slot) {
  return { active: false, keyDown: false, held: false, channel: 0, note: -1, velocity: 0,
    age: 0, tail: 0, glide: 0, slot,
    stages: Array.from({ length: nodeCount }, newStage),
    signals: Array.from({ length: nodeCount }, () => ({})),
    lines: Array.from({ length: MODULAR_LINES }, () => new Float32Array(MODULAR_LINE_SAMPLES)) };
}

export function modular_init(s, sampleRate) {
  s.sampleRate = sampleRate;
  s.bend = new Float64Array(16);
  s.sustain = new Uint8Array(16);
  s.tick = 0;
  s.stack = []; // Held keys in Mono and Legato, most recent last.
  s.lastKey = -1;
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
      old.nodes.every((n, i) => JSON.stringify(n.modalTable) === JSON.stringify(graph.nodes[i].modalTable)) &&
      old.nodes.every((n, i) => n.id === graph.nodes[i].id && n.type === graph.nodes[i].type) &&
      old.patch.cables.every((c, i) => Object.keys(c).every(k => c[k] === graph.patch.cables[i][k]))) return;
  s.voices = Array.from({ length: MAX_VOICES }, (_, slot) => newVoice(graph.nodes.length, slot));
  s.clockPhases = new Float64Array(graph.nodes.length);
}

export function modular_all_notes_off(s) {
  s.sustain.fill(0);
  for (const v of s.voices) v.active = false;
}

export function modular_midi(s, status, d1, d2) {
  if (s.graph.autonomous) return;
  const op = status & 0xf0, channel = status & 0x0f;
  if (op === 0xe0) { s.bend[channel] = (((d2 << 7) | d1) - 8192) / 4096; return; }
  if (op === 0xb0) {
    if (d1 === 64) s.sustain[channel] = d2 >= 64;
    for (const v of s.voices) {
      if (v.channel !== channel) continue;
      if (d1 === 120) v.active = false;
      if (d1 === 123) { v.keyDown = false; s.stack = s.stack.filter(h => h.channel !== channel); }
      if ((d1 === 64 || d1 === 123) && !v.keyDown && !s.sustain[channel]) v.held = false;
    }
    return;
  }
  if (!Number.isInteger(d1) || d1 < 0 || d1 > 127) return;
  if (s.graph.mono.mode && (op === 0x80 || op === 0x90)) {
    if (op === 0x90 && d2) { if (Number.isFinite(d2) && d2 <= 127) monoNoteOn(s, channel, d1, d2 / 127); }
    else monoNoteOff(s, channel, d1);
    return;
  }
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
  startVoice(s, v, channel, d1, d2 / 127);
}

function startVoice(s, v, channel, key, velocity) {
  const age = ++s.tick;
  for (let i = 0; i < v.stages.length; i++) {
    resetStage(v.stages[i], age, i);
    const sig = v.signals[i];
    sig.out = sig.pitch = sig.gate = sig.velocity = sig.sync = 0;
  }
  for (let i = 0; i < s.graph.lineCount; i++) v.lines[i].fill(0);
  v.active = v.held = v.keyDown = true;
  v.channel = channel; v.note = key; v.velocity = velocity; v.age = age; v.tail = 0; v.glide = 0;
}

// Mono and Legato play voice 0 with last-note priority, as the Synth instrument does.
function monoPlay(s, channel, key, velocity, retrigger, overlap) {
  const v = s.voices[0], { glide, legatoOnly } = s.graph.mono;
  let offset = 0;
  if (glide > 0 && (overlap || !legatoOnly))
    offset = v.active ? v.note + v.glide - key : s.lastKey >= 0 ? s.lastKey - key : 0;
  s.lastKey = key;
  if (retrigger || !v.active) startVoice(s, v, channel, key, velocity);
  else { v.channel = channel; v.note = key; v.held = v.keyDown = true; v.tail = 0; }
  v.glide = clamp(offset, -96, 96);
}

function monoNoteOn(s, channel, key, velocity) {
  s.stack = s.stack.filter(h => h.channel !== channel || h.key !== key);
  if (s.stack.length >= 16) s.stack.shift();
  s.stack.push({ channel, key, velocity });
  const v = s.voices[0];
  const overlap = v.active && v.keyDown;
  monoPlay(s, channel, key, velocity, !(s.graph.mono.mode === 2 && overlap), overlap);
}

function monoNoteOff(s, channel, key) {
  s.stack = s.stack.filter(h => h.channel !== channel || h.key !== key);
  const v = s.voices[0];
  if (!v.active || !v.keyDown || v.note !== key || v.channel !== channel) return;
  const back = s.stack.at(-1);
  if (back) monoPlay(s, back.channel, back.key, back.velocity, s.graph.mono.mode !== 2, true);
  else { v.keyDown = false; v.held = !!s.sustain[channel]; }
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
  const count = s.graph.meterSources.length;
  s.meter = enabled ? {
    remaining: 1,
    interval: 15,
    elapsed: 0,
    low: new Float64Array(count).fill(Infinity),
    high: new Float64Array(count).fill(-Infinity),
    last: new Float64Array(count),
    direction: new Int8Array(count),
    turns: new Uint32Array(count),
  } : null;
  if (enabled) modular_scope_select(s, s.scopeKey);
}

export function modular_scope_select(s, key) {
  s.scopeKey = key;
  if (!s.meter) return;
  const [id, port] = typeof key === 'string' ? key.split('/') : [];
  const index = s.graph.nodes.findIndex(n => n.id === id && MODULAR_TYPES[n.type].outputs.includes(port));
  s.meter.scope = index < 0 ? null : { key, index, port, samples: new Float32Array(1024), write: 0, count: 0 };
}

function captureScope(scope, voice) {
  scope.samples[scope.write] = voice ? voice.signals[scope.index][scope.port] : 0;
  scope.write = (scope.write + 1) % scope.samples.length;
  scope.count = Math.min(scope.count + 1, scope.samples.length);
}

// One entry per cable source since the last snapshot: span is the peak-to-peak
// swing, level the largest magnitude and rate an estimate of how often it cycles (Hz).
export function modular_meter_snapshot(s) {
  const { low, high, turns } = s.meter;
  const seconds = s.meter.elapsed / s.sampleRate;
  const signals = s.graph.meterSources.map(({ key }, i) => high[i] < low[i] ? { key, span: 0, level: 0, rate: 0 } : {
    key,
    span: high[i] - low[i],
    level: Math.max(Math.abs(low[i]), Math.abs(high[i])),
    rate: seconds > 0 ? turns[i] / 2 / seconds : 0,
  });
  const scope = s.meter.scope;
  if (scope?.count) {
    const start = (scope.write - scope.count + scope.samples.length) % scope.samples.length;
    const waveform = Array.from({ length: scope.count }, (_, i) => scope.samples[(start + i) % scope.samples.length]);
    signals.push({ key: scope.key, waveform, seconds: (scope.count - 1) / s.sampleRate });
  }
  low.fill(Infinity);
  high.fill(-Infinity);
  turns.fill(0);
  s.meter.elapsed = 0;
  return signals;
}

function measureSignals(s, voice) {
  const { low, high, last, direction, turns } = s.meter;
  const sources = s.graph.meterSources;
  for (let i = 0; i < sources.length; i++) {
    const { index, port } = sources[i];
    const value = voice ? voice.signals[index][port] : 0;
    if (value < low[i]) low[i] = value;
    if (value > high[i]) high[i] = value;
    // Each change of direction is half a cycle.
    const step = value - last[i];
    if (Math.abs(step) > 1e-6) {
      const sign = step > 0 ? 1 : -1;
      if (direction[i] && sign !== direction[i]) turns[i]++;
      direction[i] = sign;
    }
    last[i] = value;
  }
}

function sampleDrum(s, v, n, st) {
  const trigger = read(v, n, 'trigger', Number(v.held)) > 0;
  const choke = read(v, n, 'choke') > 0;
  if (trigger && !st.lastGate && !choke) {
    st.write = parameter(v, n, 'sound');
    st.value = clamp(read(v, n, 'velocity', v.velocity), 0, 1);
    st.env = st.value > 0 ? 1 : 0;
    st.phase = st.p0 = st.prev = st.ic1 = 0;
    st.y1.fill(0);
  }
  st.lastGate = trigger;
  st.mode = st.env > 1e-4 ? 1 : 0;
  if (!st.mode) return 0;
  const sound = st.write, t = st.p0, sr = s.sampleRate;
  const tone = parameter(v, n, 'tone');
  const baseHz = MODULAR_DRUM_PITCH[sound] * Math.pow(2, parameter(v, n, 'tune') / 12);
  const noise = white(st);
  const corner = sound === 2 ? baseHz : 900 + 3200 * tone;
  st.prev += (noise - st.prev) * lag(1 / (TAU * corner), sr);
  st.ic1 += (st.prev - st.ic1) * lag(1 / (TAU * (sound === 2 ? baseHz * 0.48 : 420)), sr);
  const band = st.prev - st.ic1;
  let sample;
  if (sound === 3 || sound === 4) {
    let metal = 0;
    for (let i = 0; i < HAT_RATIOS.length; i++) {
      const phase = st.y1[i] + Math.min(0.45, baseHz * HAT_RATIOS[i] / sr);
      st.y1[i] = phase - Math.floor(phase);
      metal += st.y1[i] < 0.5 ? 1 : -1;
    }
    sample = 0.55 * (noise - st.prev) + (0.12 + 0.38 * tone) * metal / HAT_RATIOS.length;
  } else if (sound === 2) {
    const burstAge = t < 0.024 ? t % 0.012 : t - 0.024;
    sample = band * (0.38 + Math.exp(-burstAge / 0.0025) * (1.2 + tone));
  } else {
    const bend = sound === 0 ? 2.6 : sound === 5 ? 0.58 : 0.16;
    const hz = baseHz * (1 + bend * Math.exp(-t / (sound === 0 ? 0.014 : 0.021)));
    const phase = st.phase + Math.min(0.45, hz / sr);
    st.phase = phase - Math.floor(phase);
    const sine = Math.sin(TAU * st.phase);
    if (sound === 1) {
      const secondary = st.y1[0] + Math.min(0.45, hz * 1.46 / sr);
      st.y1[0] = secondary - Math.floor(secondary);
      const body = (0.72 * sine + 0.28 * Math.sin(TAU * st.y1[0])) * Math.exp(-t / 0.05);
      sample = body * (0.68 - 0.35 * tone) + band * (0.68 + 0.55 * tone);
    } else {
      const click = (noise - st.prev) * tone * Math.exp(-t / 0.0035);
      sample = sound === 0 ? Math.tanh(1.9 * sine + 0.5 * click) : 0.9 * sine + 0.38 * click;
    }
  }
  const out = sample * st.env * st.value * parameter(v, n, 'level');
  const t60 = choke ? 0.018 : parameter(v, n, 'decay') * MODULAR_DRUM_DECAY[sound];
  st.env *= Math.exp(-LN1000 / (sr * t60));
  st.p0 += 1 / sr;
  return out;
}

function sampleNode(s, v, i) {
  const n = s.graph.nodes[i], st = v.stages[i], sig = v.signals[i];
  switch (n.type) {
    case 'midi':
      sig.pitch = v.note + v.glide + s.bend[v.channel]; sig.gate = v.held ? 1 : 0; sig.velocity = v.velocity;
      break;
    case 'clock':
      sig.phase = s.clockPhases[i];
      sig.gate = Number(sig.phase < n.params.duty);
      break;
    case 'gatedClock': {
      const run = read(v, n, 'run', Number(v.keyDown)) > 0;
      sig.gate = Number(run && st.phase < parameter(v, n, 'duty'));
      sig.phase = run ? st.phase : 0;
      sig.reset = Number(!run);
      const phase = st.phase + parameter(v, n, 'bpm') * parameter(v, n, 'pulses') / (60 * s.sampleRate);
      st.phase = run ? phase - Math.floor(phase) : 0;
      break;
    }
    case 'beatGrid': {
      const high = read(v, n, 'clock') > 0;
      const reset = read(v, n, 'reset') > 0;
      const length = parameter(v, n, 'length');
      if (reset) {
        st.mode = st.write = 0;
      } else if (high && !st.ready) {
        st.write = st.mode ? (st.write + 1) % length : 0;
        st.mode = 1;
      }
      st.ready = high;
      const step = Math.min(st.write, length - 1);
      const lanes = high && st.mode ? n.grid[step] : 0;
      for (let lane = 0; lane < BEAT_GRID_LANES.length; lane++)
        sig[BEAT_GRID_LANES[lane]] = (lanes >> lane) & 1;
      break;
    }
    case 'divider':
    case 'sequencer': {
      const high = read(v, n, 'clock') > 0;
      const sequence = n.type === 'sequencer';
      const length = parameter(v, n, sequence ? 'length' : 'division');
      if (read(v, n, 'reset') > 0) {
        st.mode = st.write = st.value = 0;
      } else if (high && !st.ready) {
        st.write = st.mode ? (st.write + 1) % length : 0;
        st.mode = 1;
        st.value = sequence ? Number((white(st) + 1) * 0.5 < parameter(v, n, 'probability')) : Number(st.write === 0);
      }
      st.ready = high;
      sig.gate = high ? st.value : 0;
      if (sequence) {
        const step = Math.min(st.write, length - 1);
        sig.cv = parameter(v, n, 'step' + (step + 1));
      }
      break;
    }
    case 'quantizer': {
      const pitch = clamp(read(v, n, 'pitch', 60), 0, 127);
      const root = parameter(v, n, 'root');
      const mask = QUANTIZER_SCALES[parameter(v, n, 'scale')];
      let lower = Math.floor(pitch), upper = Math.ceil(pitch);
      while (lower >= 0 && !(mask & (1 << ((lower + 12 - root) % 12)))) lower--;
      while (upper <= 127 && !(mask & (1 << ((upper + 12 - root) % 12)))) upper++;
      sig.out = upper > 127 || (lower >= 0 && pitch - lower <= upper - pitch) ? lower : upper;
      break;
    }
    case 'vco': {
      const waveType = parameter(v, n, 'wave');
      const note = read(v, n, 'pitch', 69) + 12 * parameter(v, n, 'octave') + parameter(v, n, 'detune') / 100 + read(v, n, 'fm') * 12;
      const frequency = clamp(440 * Math.pow(2, (note - 69) / 12), 0.01, s.sampleRate * 0.45);
      const dt = frequency / s.sampleRate;
      if (!st.ready) { st.phase = parameter(v, n, 'phase') % 1; st.ready = true; }
      if (n.links.sync) {
        // Hard sync: restart the cycle where the sync input rises through zero.
        const sync = read(v, n, 'sync');
        if (sync > 0 && st.value <= 0) st.phase = 0;
        st.value = sync;
      }
      let phase = st.phase;
      if (n.links.pm) {
        // Phase modulation in radians, the Synth instrument's FM.
        phase += read(v, n, 'pm') / TAU;
        phase -= Math.floor(phase);
      }
      let wave;
      if (waveType === 0) wave = Math.sin(TAU * phase);
      else if (waveType === 1) wave = 2 * phase - 1 - blep(phase, dt);
      else if (waveType === 2) {
        const width = parameter(v, n, 'pw');
        // Without its DC offset, so pulse-width modulation does not thump (as in the Synth instrument).
        wave = (phase < width ? 1 : -1) + blep(phase, dt) - blep((phase + 1 - width) % 1, dt) - (2 * width - 1);
      } else wave = 2 / Math.PI * Math.asin(Math.sin(TAU * phase));
      sig.out = wave * parameter(v, n, 'level');
      const next = st.phase + dt;
      sig.sync = next >= 1 ? 1 : 0;
      st.phase = next % 1;
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
        if (parameter(v, n, 'curve')) {
          st.env = sustain + Math.exp(-LN1000 / (parameter(v, n, 'decay') * s.sampleRate)) * (st.env - sustain);
        } else {
          st.env -= (1 - sustain) / Math.max(1, parameter(v, n, 'decay') * s.sampleRate);
          if (st.env <= sustain) { st.env = sustain; st.mode = 3; }
        }
      } else if (st.mode === 3) st.env = sustain;
      else if (st.mode === 4) {
        if (parameter(v, n, 'curve')) {
          st.env *= Math.exp(-LN1000 / (parameter(v, n, 'release') * s.sampleRate));
          if (st.env < 0.00001) { st.env = 0; st.mode = 0; }
        } else {
          st.env -= st.release / Math.max(1, parameter(v, n, 'release') * s.sampleRate);
          if (st.env <= 0) { st.env = 0; st.mode = 0; }
        }
      }
      sig.out = st.env;
      break;
    }
    case 'vcf': {
      const track = parameter(v, n, 'keytrack') * (read(v, n, 'pitch', 60) - 60) / 12;
      const cutoff = clamp(parameter(v, n, 'cutoff') * Math.pow(2, read(v, n, 'cutoff') * 2 + track), 20, s.sampleRate * 0.45);
      const g = Math.tan(Math.PI * cutoff / s.sampleRate);
      const k = 2 - 1.95 * parameter(v, n, 'resonance');
      const mode = parameter(v, n, 'mode');
      const drive = parameter(v, n, 'drive');
      let input = read(v, n, 'audio');
      if (drive > 0) input = softClip(input * (1 + 8 * drive)) / (1 + 1.5 * drive);
      if (parameter(v, n, 'slope')) {
        // 24 dB: a Butterworth stage before the resonant one, as in the Synth instrument.
        const hp = (input - (g + 1.414) * st.ic3 - st.ic4) / (1 + g * (g + 1.414));
        const bp = g * hp + st.ic3;
        const lp = g * bp + st.ic4;
        st.ic3 = 2 * bp - st.ic3; st.ic4 = 2 * lp - st.ic4;
        input = mode === 0 ? lp : mode === 1 ? hp : mode === 2 ? bp : lp + hp;
      }
      const a1 = 1 / (1 + g * (g + k));
      const hp = (input - (g + k) * st.ic1 - st.ic2) * a1;
      const bp = g * hp + st.ic1;
      const lp = g * bp + st.ic2;
      st.ic1 = 2 * bp - st.ic1; st.ic2 = 2 * lp - st.ic2;
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
    case 'functionGen': {
      const trigger = read(v, n, 'trigger', Number(v.held)) > 0;
      const loop = parameter(v, n, 'loop') && read(v, n, 'run', Number(v.held)) > 0;
      if ((trigger && !st.ready) || (loop && st.mode === 0)) {
        st.mode = 1;
        st.phase = 0;
      }
      st.ready = trigger;
      sig.eoc = 0;
      if (st.mode === 1) {
        st.phase = Math.min(1, st.phase + 1 / (s.sampleRate * parameter(v, n, 'rise')));
        if (st.phase === 1) st.mode = 2;
      } else if (st.mode === 2) {
        st.phase = Math.max(0, st.phase - 1 / (s.sampleRate * parameter(v, n, 'fall')));
        if (st.phase === 0) {
          st.mode = 0;
          sig.eoc = 1;
        }
      }
      sig.out = Math.pow(st.phase, Math.pow(4, parameter(v, n, 'curve')));
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
    case 'drumVoice': sig.out = sampleDrum(s, v, n, st); break;
    case 'ring': sig.out = read(v, n, 'a') * read(v, n, 'b', 1) * parameter(v, n, 'level'); break;
    case 'wavefolder': {
      const input = read(v, n, 'in');
      const x = input * parameter(v, n, 'drive') + parameter(v, n, 'bias');
      const period = x + 1 - 4 * Math.floor((x + 1) / 4);
      const wet = parameter(v, n, 'shape') ? Math.tanh(x) : 1 - Math.abs(period - 2);
      sig.out = input + (wet - input) * parameter(v, n, 'mix');
      break;
    }
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
    case 'bowed': {
      const gate = read(v, n, 'gate', Number(v.held)) >= 0.5;
      const target = gate ? parameter(v, n, 'speed') * clamp(read(v, n, 'bow', 1), 0, 1) : 0;
      st.env += (target - st.env) * (1 - Math.exp(-1 / (s.sampleRate * (gate ? 0.015 : 0.008))));
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12),
        s.sampleRate / (2 * (MODULAR_LINE_SAMPLES - 2)), s.sampleRate * 0.2);
      const halfPeriod = 0.5 * s.sampleRate / hz;
      const position = parameter(v, n, 'position'), damping = parameter(v, n, 'damping');
      const bridge = v.lines[n.line], nut = v.lines[n.line + 1];
      const bridgeOut = lineRead(bridge, st.write, Math.max(1, halfPeriod * position));
      const nutOut = lineRead(nut, st.write, Math.max(1, halfPeriod * (1 - position)));
      st.prev += (bridgeOut - st.prev) * (1 - damping);
      const reflectedBridge = -0.95 * st.prev, reflectedNut = -0.995 * nutOut;
      const relative = st.env - reflectedBridge - reflectedNut;
      const friction = st.env > 1e-5 ? Math.min(1, Math.pow(0.75 + Math.abs(relative * parameter(v, n, 'pressure')), -4)) : 0;
      const bow = relative * friction;
      bridge[st.write] = clamp(reflectedNut + bow, -4, 4);
      nut[st.write] = clamp(reflectedBridge + bow, -4, 4);
      st.write = (st.write + 1) & MASK;
      st.amp = Math.max(Math.abs(bridgeOut), st.amp * 0.9995);
      st.lastGate = gate;
      st.mode = st.env > 1e-5 || st.amp > 1e-4 ? 1 : 0;
      sig.out = bridgeOut * parameter(v, n, 'level');
      break;
    }
    case 'modal': {
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const strike = gate && !st.lastGate ? 1 : 0;
      st.lastGate = gate;
      const material = n.modalTable ? -1 : parameter(v, n, 'material');
      const decay = parameter(v, n, 'decay');
      const t60 = gate ? decay : Math.min(decay, parameter(v, n, 'release'));
      const brightness = parameter(v, n, 'brightness');
      const hz = 440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12);
      const key = st.key;
      if (key[0] !== hz || key[1] !== material || key[2] !== t60 || key[3] !== brightness) {
        key[0] = hz; key[1] = material; key[2] = t60; key[3] = brightness;
        const mat = MATERIALS[material];
        for (let k = 0; k < MODULAR_MODES; k++) {
          const mode = n.modalTable?.[k];
          const ratio = mode?.ratio ?? mat?.ratios[k] ?? 0;
          const f = hz * ratio;
          if (!(f > 0 && f < s.sampleRate * 0.45)) { st.a1[k] = st.a2[k] = st.b[k] = 0; continue; }
          // Darker settings damp the upper modes faster, as in the Physical instrument.
          const t = t60 * (mode?.decay ?? 1) / Math.max(0.25, 1 + (1 - brightness) * 4 * (ratio - 1));
          const r = Math.exp(-LN1000 / (t * s.sampleRate));
          const w = TAU * f / s.sampleRate;
          st.a1[k] = 2 * r * Math.cos(w); st.a2[k] = r * r; st.b[k] = (mode?.gain ?? mat.gains[k]) * Math.sin(w);
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
    case 'mix4':
      sig.out = read(v, n, 'a') * parameter(v, n, 'a') + read(v, n, 'b') * parameter(v, n, 'b') +
        read(v, n, 'c') * parameter(v, n, 'c') + read(v, n, 'd') * parameter(v, n, 'd');
      break;
    case 'cv': sig.out = read(v, n, 'in') * parameter(v, n, 'scale') + parameter(v, n, 'offset'); break;
    case 'macro': {
      const value = s.graph.patch.macros[parameter(v, n, 'index') - 1];
      const from = parameter(v, n, 'from'), to = parameter(v, n, 'to');
      sig.out = from + (to - from) * Math.pow(value, Math.pow(4, parameter(v, n, 'curve')));
      break;
    }
    case 'delay': sig.out = st.memory; break;
    case 'pan': {
      const spread = s.graph.mono.mode ? 0 : (v.slot % 2 ? 1 : -1) * (1 - Math.floor(v.slot / 2) / 4);
      const pan = clamp(parameter(v, n, 'pan') + spread * parameter(v, n, 'spread'), -1, 1);
      const input = read(v, n, 'in');
      sig.left = clamp(input * Math.sqrt((1 - pan) * 0.5), -1e6, 1e6);
      sig.right = clamp(input * Math.sqrt((1 + pan) * 0.5), -1e6, 1e6);
      break;
    }
    case 'output': {
      const left = read(v, n, 'audio'), level = parameter(v, n, 'level');
      sig.out = left * level;
      sig.right = clamp(read(v, n, 'right', left) * level, -1e6, 1e6);
      break;
    }
  }
  // Bound every intermediate so a cascade of multipliers cannot overflow.
  sig.out = clamp(sig.out, -1e6, 1e6);
}
export function modular_render(s) {
  let out = 0, right = 0;
  const { nodes, order, delays, outputs, envelopes, mono, clocks, autonomous } = s.graph;
  if (autonomous && !s.voices[0].active) startVoice(s, s.voices[0], 0, 60, 1);
  // Glide decays like the Synth instrument: about 95% of the way after the glide time.
  const glideCoef = mono.glide > 0 ? Math.exp(-1 / (mono.glide / 3 * s.sampleRate)) : 0;
  let meterVoice;
  for (const v of s.voices) {
    if (!v.active) continue;
    meterVoice ??= v;
    for (const i of order) sampleNode(s, v, i);
    for (const i of delays) v.stages[i].memory = clamp(read(v, nodes[i], 'in'), -4, 4);
    if (v.glide !== 0) {
      v.glide *= glideCoef;
      if (Math.abs(v.glide) < 0.0012) v.glide = 0;
    }
    let sample = 0, sampleRight = 0;
    for (const i of outputs) {
      sample += v.signals[i].out;
      sampleRight += v.signals[i].right;
    }
    if (!v.held) {
      v.tail++;
      const fade = Math.max(1, Math.round(RELEASE_FADE * s.sampleRate));
      if (envelopes.length === 0 || v.tail > MAX_RELEASE * s.sampleRate) {
        const elapsed = envelopes.length ? v.tail - MAX_RELEASE * s.sampleRate : v.tail;
        const gain = clamp(1 - elapsed / fade, 0, 1);
        sample *= gain;
        sampleRight *= gain;
        if (elapsed >= fade) v.active = false;
      } else if (envelopes.every(i => v.stages[i].mode === 0 && !v.stages[i].lastGate)) {
        v.active = false;
      }
    }
    out += sample;
    right += sampleRight;
  }
  for (const i of clocks) {
    const { bpm, pulses } = nodes[i].params;
    const phase = s.clockPhases[i] + bpm * pulses / (60 * s.sampleRate);
    s.clockPhases[i] = phase - Math.floor(phase);
  }
  if (s.meter && (s.meter.elapsed++, --s.meter.remaining === 0)) {
    measureSignals(s, meterVoice);
    // Vary the stride to avoid measuring the same phase of a periodic signal.
    s.meter.remaining = s.meter.interval;
    s.meter.interval = s.meter.interval === 17 ? 15 : s.meter.interval + 1;
  }
  if (s.meter?.scope) captureScope(s.meter.scope, meterVoice);
  s.out_l = Math.tanh(out);
  s.out_r = Math.tanh(right);
}
