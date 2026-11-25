// AmiSynth Modular: a small, independent, serializable graph DSP (no Web Audio dependencies).
// All cables carry a per-voice, audio-rate scalar. A Unit Delay breaks a feedback loop.
// The native CLAP engine (clap/src/modular_dsp.h) mirrors every module; keep the two in step.
import { BRASS_MIN_DRIVE, BRASS_MULTS, BRASS_NOTE0, BRASS_SHARP, MATERIALS } from './phys.js';
import { HAT_RATIOS } from './drums.js';
import { WT_BANK_NAMES, wt_build, wt_sample } from './wavetable.js';
import { MODULAR_PHYSICAL_PORTS, MODULAR_SYNTH_PORTS } from '../presets/modular.js';
import { DRUM_PRESETS } from '../presets/drums.js';
import { DRUM_PARAMS, defaultValues } from './params.js';

// Native storage limits per module (checked by scripts/gen-modular-clap.js).
export const MODULAR_MAX_INPUTS = 4;
export const MODULAR_MAX_PARAMS = 10;
export const MODULAR_MAX_OUTPUTS = 8;
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
export const MODULAR_DRUM_PITCH = [52, 180, 1100, 205.3, 205.3, 105, 840, 540, 5100, 160, 248];
export const MODULAR_DRUM_DECAY = [1, 0.8, 0.85, 0.2, 1.8, 0.9, 0.3, 1.05, 0.65, 5.3, 4.2];
const DRUM_SOUNDS = ['Kick', 'Snare', 'Clap', 'Closed Hat', 'Open Hat', 'Tom',
  'Rimshot', 'Cowbell', 'Shaker', 'Crash', 'Ride'];

export const MODULAR_TYPES = Object.freeze({
  // The first MIDI / Note module's knobs set how notes reach voices. They are patch settings,
  // not per-voice signals, so they take no cable ("fixed").
  // bend is -1..1 and also moves pitch by bendRange semitones; mod is CC1; pressure is the larger of
  // channel pressure and the note's own pressure; cc reads the controller numbered by the cc knob.
  midi: { label: 'MIDI / Note', category: 'Input & Output',
    keywords: 'keyboard pitch gate velocity trigger mono legato glide portamento bend mod wheel modulation cc controller aftertouch pressure mpe expression breath',
    inputs: [], outputs: ['pitch', 'gate', 'velocity', 'bend', 'mod', 'pressure', 'cc'], params: {
      voices: { min: 0, max: 2, default: 0, step: 1, choices: ['Poly', 'Mono', 'Legato'], fixed: true },
      glide: { min: 0, max: 2, default: 0, step: 0.001, fixed: true },
      glideMode: { min: 0, max: 1, default: 0, step: 1, choices: ['Always', 'Legato only'], fixed: true },
      bendRange: { min: 0, max: 48, default: 2, step: 1, fixed: true },
      cc: { min: 0, max: 127, default: 74, step: 1, fixed: true },
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
  wavetable: { label: 'Wavetable Oscillator', category: 'Sources', keywords: 'wavetable morph unison stereo oscillator fm pm sync',
    inputs: ['pitch', 'fm', 'pm', 'sync'], outputs: ['out', 'left', 'right', 'sync'], params: {
      bank: { min: 0, max: WT_BANK_NAMES.length - 1, default: 0, step: 1, choices: WT_BANK_NAMES, fixed: true },
      position: { min: 0, max: 1, default: 0.35, step: 0.001 },
      octave: { min: -3, max: 3, default: 0, step: 1 },
      level: { min: 0, max: 1, default: 0.48, step: 0.01 },
      voices: { min: 1, max: 7, default: 1, step: 1 },
      detune: { min: 0, max: 65, default: 18, step: 0.1 },
      spread: { min: 0, max: 1, default: 0.75, step: 0.01 },
      phase: { min: 0, max: 1, default: 0, step: 0.001 },
      tune: { min: -1200, max: 1200, default: 0, step: 1 },
    } },
  string: { label: 'Pluck String', category: 'Physical', keywords: 'karplus strong guitar harp pluck physical model delay',
    inputs: ['pitch', 'gate', 'excite'], outputs: ['out'], params: {
      decay: { min: 0.05, max: 10, default: 1.5, step: 0.01 },
      release: { min: 0.01, max: 10, default: 0.3, step: 0.01 },
      brightness: { min: 0, max: 1, default: 0.6, step: 0.01 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  physString: { label: 'Physical String', category: 'Physical',
    keywords: 'karplus strong guitar bass harp harpsichord koto pick damping hammer physical model',
    inputs: ['pitch', 'gate', 'velocity'], outputs: ['out'], params: {
      excitation: { min: 0, max: 1, default: 0, step: 1, choices: ['Pluck', 'Strike'] },
      decay: { min: 0.1, max: 20, default: 3, step: 0.01 },
      release: { min: 0.01, max: 10, default: 0.3, step: 0.01 },
      damping: { min: 0, max: 1, default: 0.35, step: 0.001 },
      pick: { min: 0.02, max: 0.5, default: 0.13, step: 0.001 },
      brightness: { min: 0, max: 1, default: 0.7, step: 0.001 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  physBowed: { label: 'Physical Bowed String', category: 'Physical',
    keywords: 'violin viola cello contrabass fiddle bow friction waveguide body physical model',
    inputs: ['pitch', 'bow'], outputs: ['out'], params: {
      speed: { min: 0, max: 1, default: 0.55, step: 0.001 },
      pressure: { min: 0, max: 1, default: 0.45, step: 0.001 },
      position: { min: 0.02, max: 0.5, default: 0.127, step: 0.001 },
      brightness: { min: 0, max: 1, default: 0.6, step: 0.001 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  physWind: { label: 'Physical Wind', category: 'Physical',
    keywords: 'clarinet flute saxophone oboe bassoon accordion harmonica reed jet breath bore physical model',
    inputs: ['pitch', 'breath'], outputs: ['out'], params: {
      type: { min: 0, max: 4, default: 0, step: 1, choices: ['Clarinet', 'Flute', 'Saxophone', 'Double Reed', 'Free Reed'] },
      pressure: { min: 0, max: 1, default: 0.6, step: 0.001 },
      noise: { min: 0, max: 1, default: 0.15, step: 0.001 },
      embouchure: { min: 0, max: 1, default: 0.5, step: 0.001 },
      musette: { min: 0, max: 50, default: 0, step: 0.1 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  physBrass: { label: 'Physical Brass', category: 'Physical',
    keywords: 'trumpet trombone tuba horn flugelhorn lip buzz bell bore physical model',
    inputs: ['pitch', 'breath', 'velocity'], outputs: ['out'], params: {
      pressure: { min: 0, max: 1, default: 0.6, step: 0.001 },
      lip: { min: 0, max: 1, default: 0.5, step: 0.001 },
      bell: { min: 0, max: 1, default: 0.5, step: 0.001 },
      attack: { min: 0.001, max: 2, default: 0.04, step: 0.001 },
      velocity: { min: 0, max: 1, default: 0.8, step: 0.001 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  physPiano: { label: 'Physical Piano', category: 'Physical',
    keywords: 'piano grand upright stiff string hammer felt unison inharmonic physical model',
    inputs: ['pitch', 'gate', 'velocity'], outputs: ['out'], params: {
      hardness: { min: 0, max: 1, default: 0.5, step: 0.001 },
      position: { min: 0.02, max: 0.5, default: 0.12, step: 0.001 },
      decay: { min: 0.2, max: 30, default: 8, step: 0.01 },
      release: { min: 0.01, max: 20, default: 0.4, step: 0.01 },
      damping: { min: 0, max: 1, default: 0.25, step: 0.001 },
      inharmonicity: { min: 0, max: 1, default: 0.35, step: 0.001 },
      detune: { min: 0, max: 10, default: 1.2, step: 0.01 },
      level: { min: 0, max: 1, default: 0.6, step: 0.01 },
    } },
  modal: { label: 'Modal Resonator', category: 'Physical', keywords: 'bell marimba glass gong mallet physical model resonance',
    inputs: ['in', 'pitch', 'gate', 'velocity'], outputs: ['out'], params: {
      material: { min: 0, max: MATERIALS.length - 1, default: 0, step: 1, choices: MATERIALS.map(m => m.name) },
      decay: { min: 0.05, max: 10, default: 1.2, step: 0.01 },
      release: { min: 0.01, max: 10, default: 0.4, step: 0.01 },
      brightness: { min: 0, max: 1, default: 0.5, step: 0.01 },
      level: { min: 0, max: 1, default: 0.5, step: 0.01 },
      hardness: { min: 0, max: 1, default: 1, step: 0.001 },
      strikePosition: { min: 0, max: 0.5, default: 0, step: 0.001 },
    } },
  bowed: { label: 'Bowed String', category: 'Physical', keywords: 'bow violin cello friction waveguide bowed string',
    inputs: ['pitch', 'gate', 'bow'], outputs: ['out'], params: {
      speed: { min: 0, max: 1, default: 0.42, step: 0.01 },
      pressure: { min: 0.5, max: 8, default: 3, step: 0.01 },
      position: { min: 0.08, max: 0.42, default: 0.14, step: 0.001 },
      damping: { min: 0, max: 0.9, default: 0.27, step: 0.01 },
      level: { min: 0, max: 1, default: 0.65, step: 0.01 },
    } },
  reedPipe: { label: 'Reed Pipe', category: 'Physical', keywords: 'winds clarinet reed breath bore waveguide',
    inputs: ['pitch', 'gate', 'breath'], outputs: ['out'], params: {
      pressure: { min: 0, max: 1, default: 0.56, step: 0.01 },
      embouchure: { min: 0, max: 1, default: 0.5, step: 0.01 },
      brightness: { min: 0, max: 1, default: 0.55, step: 0.01 },
      attack: { min: 0.005, max: 0.4, default: 0.045, step: 0.001 },
      noise: { min: 0, max: 1, default: 0.16, step: 0.01 },
      level: { min: 0, max: 1, default: 0.62, step: 0.01 },
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
  // Host sync follows the DAW's tempo and beat position: pulses land on the beat grid while the
  // transport plays, and the clock stops with reset held high while it is stopped.
  clock: { label: 'Clock', category: 'Modulation', keywords: 'tempo bpm pulse time sequencer host sync daw transport',
    inputs: [], outputs: ['gate', 'phase', 'reset'], params: {
      bpm: { min: 20, max: 300, default: 120, step: 0.1, fixed: true },
      pulses: { min: 1, max: 16, default: 4, step: 1, fixed: true },
      duty: { min: 0.01, max: 0.99, default: 0.5, step: 0.01, fixed: true },
      sync: { min: 0, max: 1, default: 0, step: 1, choices: ['Free', 'Host'], fixed: true },
    } },
  divider: { label: 'Clock Divider', category: 'Modulation', keywords: 'clock pulse divide rhythm',
    inputs: ['clock', 'reset'], outputs: ['gate'], params: {
      division: { min: 1, max: 32, default: 2, step: 1 },
    } },
  // Host sync takes the DAW's tempo in place of bpm; the clock still starts when a key goes down.
  gatedClock: { label: 'Gated Clock', category: 'Modulation', keywords: 'tempo bpm pulse time rhythm held gate sequencer host sync daw',
    inputs: ['run'], outputs: ['gate', 'phase', 'reset'], params: {
      bpm: { min: 20, max: 300, default: 120, step: 0.1 },
      pulses: { min: 1, max: 16, default: 2, step: 1 },
      duty: { min: 0.01, max: 0.99, default: 0.5, step: 0.01 },
      sync: { min: 0, max: 1, default: 0, step: 1, choices: ['Free', 'Host'], fixed: true },
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
  drumVoice: { label: 'Drum Voice', category: 'Drums', keywords: 'percussion kick snare clap hihat hi-hat closed open tom choke rimshot cowbell shaker crash ride cymbal',
    inputs: ['trigger', 'velocity', 'choke'], outputs: ['out'], params: {
      sound: { min: 0, max: DRUM_SOUNDS.length - 1, default: 0, step: 1, choices: DRUM_SOUNDS },
      tune: { min: -24, max: 24, default: 0, step: 0.1 },
      decay: { min: 0.025, max: 2.5, default: 0.25, step: 0.001 },
      tone: { min: 0, max: 1, default: 0.5, step: 0.01 },
      level: { min: 0, max: 1, default: 0.65, step: 0.01 },
      kickSweep: { min: -1, max: 6, default: -1, step: 0.01 },
      kickSweepTime: { min: 0.002, max: 0.3, default: 0.035, step: 0.001 },
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
  // Patch effects run once on the sum of all voices ("global"), after the voices. Their inputs
  // add up every voice's signal; their outputs can feed only other patch effects and FX output.
  echo: { label: 'Echo', category: 'Patch Effects', global: true, keywords: 'delay echo ping pong stereo tempo sync tape effect fx',
    inputs: ['left', 'right'], outputs: ['left', 'right'], params: {
      time: { min: 1, max: 2000, default: 375, step: 1, fixed: true },
      sync: { min: 0, max: 1, default: 0, step: 1, choices: ['Free', 'Host'], fixed: true },
      beats: { min: 0, max: 13, default: 3, step: 1, choices: ['1/16', '1/8', 'Dotted 1/8', '1/4', 'Dotted 1/4', '1/2', '1 bar',
        '1/32', '1/16 triplet', 'Dotted 1/16', '1/8 triplet', '1/4 triplet', '1/2 triplet', 'Dotted 1/2'], fixed: true },
      feedback: { min: 0, max: 0.95, default: 0.4, step: 0.01, fixed: true },
      damping: { min: 0, max: 1, default: 0.3, step: 0.01, fixed: true },
      pingPong: { min: 0, max: 1, default: 0, step: 1, choices: ['Off', 'On'], fixed: true },
      mix: { min: 0, max: 1, default: 0.3, step: 0.01, fixed: true },
    } },
  chorus: { label: 'Chorus', category: 'Patch Effects', global: true, keywords: 'chorus ensemble width stereo modulation effect fx',
    inputs: ['left', 'right'], outputs: ['left', 'right'], params: {
      rate: { min: 0.05, max: 5, default: 0.6, step: 0.01, fixed: true },
      depth: { min: 0, max: 10, default: 3, step: 0.01, fixed: true },
      delay: { min: 2, max: 30, default: 8, step: 0.1, fixed: true },
      spread: { min: 0, max: 1, default: 1, step: 0.01, fixed: true },
      mix: { min: 0, max: 1, default: 0.5, step: 0.01, fixed: true },
    } },
  reverb: { label: 'Reverb', category: 'Patch Effects', global: true, keywords: 'reverb room hall space ambience effect fx',
    inputs: ['left', 'right'], outputs: ['left', 'right'], params: {
      size: { min: 0, max: 1, default: 0.7, step: 0.01, fixed: true },
      damping: { min: 0, max: 1, default: 0.4, step: 0.01, fixed: true },
      width: { min: 0, max: 1, default: 1, step: 0.01, fixed: true },
      mix: { min: 0, max: 1, default: 0.3, step: 0.01, fixed: true },
    } },
  guitarAmp: { label: 'Guitar Amp', category: 'Patch Effects', global: true,
    keywords: 'amp amplifier overdrive distortion crunch cabinet guitar bass effect fx',
    inputs: ['left', 'right'], outputs: ['left', 'right'], params: {
      type: { min: 0, max: 3, default: 1, step: 1, choices: ['Clean', 'Crunch', 'Overdrive', 'Distortion'], fixed: true },
      gain: { min: 0, max: 1, default: 0.5, step: 0.001, fixed: true },
      tone: { min: 0, max: 1, default: 0.5, step: 0.001, fixed: true },
      level: { min: -24, max: 12, default: 0, step: 0.1, fixed: true },
    } },
  soundboard: { label: 'Soundboard', category: 'Patch Effects', global: true,
    keywords: 'piano soundboard body resonance bridge wood effect fx',
    inputs: ['left', 'right'], outputs: ['left', 'right'], params: {
      body: { min: 0, max: 1, default: 0.6, step: 0.001, fixed: true },
    } },
  fxOutput: { label: 'FX output', category: 'Input & Output', global: true, keywords: 'effects return bus master out',
    inputs: ['left', 'right'], outputs: [], params: {
      level: { min: 0, max: 2, default: 1, step: 0.01, fixed: true },
    } },
});

// Patch effects share preallocated buffers: one slot per Echo, Chorus or Reverb.
export const MODULAR_FX_SLOTS = 4;
// Each slot's state values (the Soundboard keeps 16 modes of 2 states and 6 coefficients).
export const MODULAR_FX_MEMORY = 128;
export const MODULAR_ECHO_SECONDS = 2;
// Later entries were appended so stored patches keep their note values.
export const MODULAR_ECHO_BEATS = [0.25, 0.5, 0.75, 1, 1.5, 2, 4, 0.125, 1 / 6, 0.375, 1 / 3, 2 / 3, 4 / 3, 3];
// Freeverb's comb and allpass lengths at 44.1 kHz; the right channel is 23 samples longer.
export const MODULAR_REVERB_COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
export const MODULAR_REVERB_ALLPASSES = [556, 441, 341, 225];
export const MODULAR_REVERB_SPREAD = 23;
// The Physical instrument's amps: pre high-pass Hz, drive at gain 0 and 1, bias, clipping
// stages, cabinet low-pass Hz at tone 0 and 1.
// The Physical instrument's wind constants: where the conical bores' reed sits in the loop,
// their output gains, the flute jet's delay ratio and gain, and the free reed's slot overlap.
export const MODULAR_WIND = { conePosition: [0, 0, 0.4, 0.35], coneGain: [0, 0, 0.7, 0.9], jetRatio: 1.03,
  jetGain: 1.6, overlap: 0.35, freeReedGain: 1.1 };
// The Physical instrument's brass constants: lip boost after the tongue release, its minimum
// length in periods, the tongue's seed wave, wave steepening and output gain.
export const MODULAR_BRASS = { boost: 6, boostPeriods: 10, seed: 0.15, steep: 1.5, gain: 2.5 };
// The Physical instrument's piano constants: dispersion all-passes per string, hammer
// integration sub-steps and the hammer pulse gain.
export const MODULAR_PIANO = { allpasses: 4, substeps: 4, gain: 63 };
export { BRASS_MIN_DRIVE, BRASS_MULTS, BRASS_NOTE0, BRASS_SHARP };
export const MODULAR_AMP_TYPES = [
  [60, 1, 4, 0, 1, 3000, 9000],
  [100, 3, 30, 0.15, 1, 2500, 7000],
  [200, 8, 100, 0.2, 1, 2200, 6000],
  [150, 30, 600, 0.1, 2, 1800, 5000],
];
const FX_TYPES = new Set(['echo', 'chorus', 'reverb', 'guitarAmp', 'soundboard']);

const LINE_TYPES = new Set(['string', 'physString', 'comb', 'reedPipe']);
// Modules that ring on after their gate falls; a released voice lives until they are quiet.
const RINGING_TYPES = new Set(['adsr', 'functionGen', 'string', 'physString', 'physBowed', 'physWind', 'physBrass', 'physPiano', 'modal', 'bowed', 'reedPipe']);
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

function wavetablePatch(osc, env, mod, amount, offset) {
  return {
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'osc', type: 'wavetable', params: osc, position: { x: 296, y: 22 } },
      { id: 'left', type: 'vca', position: { x: 570, y: 22 } },
      { id: 'right', type: 'vca', position: { x: 570, y: 442 } },
      { id: 'out', type: 'output', position: { x: 844, y: 22 } },
      { id: 'env', type: 'adsr', params: env, position: { x: 22, y: 442 } },
      { id: 'scan', type: 'cv', params: { scale: amount, offset }, position: { x: 296, y: 442 } },
      ...(mod ? [{ id: 'motion', type: 'lfo', params: mod, position: { x: 22, y: 862 } }] : []),
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: mod ? 'motion' : 'env', port: 'out', to: 'scan', input: 'in' },
      { from: 'scan', port: 'out', to: 'osc', input: 'param:position' },
      { from: 'osc', port: 'left', to: 'left', input: 'audio' },
      { from: 'osc', port: 'right', to: 'right', input: 'audio' },
      { from: 'env', port: 'out', to: 'left', input: 'gain' },
      { from: 'env', port: 'out', to: 'right', input: 'gain' },
      { from: 'left', port: 'out', to: 'out', input: 'audio' },
      { from: 'right', port: 'out', to: 'out', input: 'right' },
    ],
  };
}

export const MODULAR_MACROS = 8;
export const MODULAR_PATCH_BYTES = 64 * 1024;
export const MODULAR_POSITION_MAX = 8192;
export const MODULAR_RACK = { width: 224, column: 274, row: 420, pad: 22 };
const DEFAULT_RACK_SLOTS = { note: [0, 0], osc: [1, 0], filter: [2, 0], amp: [3, 0], out: [4, 0], env: [2, 1] };

export function modularRackPoint(node, index) {
  if (node.position) return node.position;
  const [column, row] = Object.hasOwn(DEFAULT_RACK_SLOTS, node.id)
    ? DEFAULT_RACK_SLOTS[node.id] : [index % 5, 1 + Math.floor(index / 5)];
  const rowOffset = node.id === 'env' ? modularCardHeight('vcf') + 18 : row * MODULAR_RACK.row;
  return { x: MODULAR_RACK.pad + column * MODULAR_RACK.column, y: MODULAR_RACK.pad + rowOffset };
}

function modularCardHeight(type) {
  const def = MODULAR_TYPES[type];
  const controls = type === 'beatGrid' ? 185 : 74 * Object.keys(def.params).length;
  return 110 + controls + 32 * Math.max(def.inputs.length, def.outputs.length) + (type === 'modal' ? 36 : 0);
}

/** Conservative space for the card header, knob rows, jack rows, and custom editors. */
export function modularCardBounds(node, position) {
  return { ...position, width: MODULAR_RACK.width, height: modularCardHeight(node.type) };
}

export function modularCardsOverlap(a, b, gap = 0) {
  return a.x < b.x + b.width + gap && b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;
}

function layoutFactoryPatch(patch) {
  const positions = patch.nodes.map(modularRackPoint);
  const order = patch.nodes.map((_, i) => i).sort((a, b) => positions[a].y - positions[b].y);
  const placed = [];
  for (const i of order) {
    const point = { ...positions[i] };
    const box = modularCardBounds(patch.nodes[i], point);
    let blockers;
    while ((blockers = placed.filter(other => modularCardsOverlap(box, other, 18))).length) {
      box.y = Math.max(...blockers.map(other => other.y + other.height + 18));
      if (box.y > MODULAR_POSITION_MAX) {
        box.x = Math.max(...placed.map(other => other.x)) + MODULAR_RACK.column;
        box.y = point.y;
      }
    }
    positions[i] = { x: box.x, y: box.y };
    placed.push(box);
  }
  return { ...patch, nodes: patch.nodes.map((node, i) => ({ ...node, position: positions[i] })) };
}
const MAX_RELEASE = 10;
const RELEASE_FADE = 0.005;
export const MODULAR_MAX_TAIL = MAX_RELEASE + RELEASE_FADE;

const FACTORY_PATCHES = [
  { name: 'Subtractive', patch: defaultModularPatch },
  { name: 'Vowel Halo', patch: () => wavetablePatch({ bank: 2, voices: 5, detune: 23, spread: 0.92 },
    { attack: 0.18, decay: 0.27, sustain: 0.72, release: 0.52 }, { rate: 0.72 }, 0.41, 0.52) },
  { name: 'Digital Pulse', patch: () => wavetablePatch({ bank: 4, voices: 3, detune: 11, spread: 0.61, octave: -1 },
    { attack: 0.004, decay: 0.2, sustain: 0.22, release: 0.13, curve: 1 }, null, 0.77, 0.09) },
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
  { name: 'Velvet Reed', patch: velvetReed },
  { name: 'Cowbell and Shaker', patch: () => percussionLayer('bell', { sound: 7, level: 0.7 },
    'shaker', { sound: 8, level: 0.48 }) },
  { name: 'Rim and Cymbal', patch: () => percussionLayer('rim', { sound: 6, level: 0.7 },
    'ride', { sound: 10, decay: 0.44, level: 0.62 }) },
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
  { name: '808-ish Groove', category: 'Rhythm', source: 'Drums', tags: '808 hip hop electronic',
    description: 'Kick, snare and hats modeled on the 808-ish kit',
    patch: drumPreset808 },
  { name: 'Expressive Lead', category: 'Lead', tags: 'mod wheel aftertouch pressure mpe cc74 brightness vibrato bend',
    description: 'Mod wheel adds vibrato; aftertouch and CC74 open the filter; bend spans a whole tone',
    patch: expressiveLead },
  { name: 'Echo Hall Pluck', category: 'Strings', tags: 'echo delay reverb hall ambient tempo sync ping pong',
    description: 'Plucked string through a host-synced dotted-eighth ping-pong echo and a hall reverb',
    patch: echoHallPluck },
  ...MODULAR_SYNTH_PORTS,
  ...MODULAR_PHYSICAL_PORTS,
];

const MANUAL_CATEGORIES = {
  Basic: ['Subtractive', 'Macro Morph'],
  Bass: ['Feedback Bass', 'Digital Pulse'],
  Lead: ['Vibrato Lead', 'Folded Reed'],
  Pad: ['Vowel Halo', 'Stereo Drift'],
  Strings: ['Bow Grain', 'Low Bow Cello', 'Shivering Bow', 'Plucked String'],
  Mallets: ['Marimba', 'Church Bell', 'Twin Glass', 'Falling Glass'],
  Winds: ['Velvet Reed'],
  Sequence: ['Clockwork Plucks'],
  Percussion: ['Cowbell and Shaker', 'Rim and Cymbal'],
  Rhythm: ['Patch Beat', 'Choked Hats', 'Clap and Toms', 'Four Lane Beat'],
};
const manualCategories = new Map(Object.entries(MANUAL_CATEGORIES).flatMap(([category, names]) =>
  names.map(name => [name, category])));
export const MODULAR_PRESETS = FACTORY_PATCHES.map(({ patch, ...metadata }) => ({
  ...metadata,
  category: metadata.category ?? manualCategories.get(metadata.name) ?? 'Other',
  patch: () => layoutFactoryPatch(patch()),
}));

export function searchModularPresets(query, category = '') {
  const words = searchWords(query);
  return MODULAR_PRESETS.flatMap((preset, index) => {
    if (category && preset.category !== category) return [];
    const text = searchWords([preset.name, preset.category, preset.source, preset.description, preset.tags].join(' '));
    return words.every(word => text.some(token => token.startsWith(word))) ? [{ preset, index }] : [];
  });
}

// The dry string goes straight out; the echo and reverb run once on all voices together.
function echoHallPluck() {
  return {
    nodes: [
      { id: 'note', type: 'midi', position: { x: 22, y: 22 } },
      { id: 'string', type: 'string', params: { decay: 2.4, release: 0.6, brightness: 0.62, level: 0.5 }, position: { x: 296, y: 22 } },
      { id: 'out', type: 'output', params: { level: 0.7 }, position: { x: 570, y: 22 } },
      { id: 'echo', type: 'echo', params: { sync: 1, beats: 2, feedback: 0.42, damping: 0.45, pingPong: 1, mix: 0.35 }, position: { x: 570, y: 200 } },
      { id: 'hall', type: 'reverb', params: { size: 0.82, damping: 0.45, width: 1, mix: 0.32 }, position: { x: 844, y: 200 } },
      { id: 'fx', type: 'fxOutput', params: { level: 0.8 }, position: { x: 1118, y: 200 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'string', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'string', input: 'gate' },
      { from: 'string', port: 'out', to: 'out', input: 'audio' },
      { from: 'string', port: 'out', to: 'echo', input: 'left' },
      { from: 'echo', port: 'left', to: 'hall', input: 'left' },
      { from: 'echo', port: 'right', to: 'hall', input: 'right' },
      { from: 'hall', port: 'left', to: 'fx', input: 'left' },
      { from: 'hall', port: 'right', to: 'fx', input: 'right' },
    ],
  };
}

// Plays as a plain saw lead until the controllers move, so it also works without them.
function expressiveLead() {
  return {
    nodes: [
      { id: 'note', type: 'midi', params: { bendRange: 2, cc: 74 }, position: { x: 22, y: 22 } },
      { id: 'vibrato', type: 'lfo', params: { rate: 5.6 }, position: { x: 22, y: 470 } },
      { id: 'depth', type: 'ring', params: { level: 0.035 }, position: { x: 296, y: 470 } },
      { id: 'osc', type: 'vco', params: { wave: 1, level: 0.5 }, position: { x: 296, y: 22 } },
      { id: 'bright', type: 'mix', params: { a: 1.6, b: 1.2 }, position: { x: 296, y: 290 } },
      { id: 'filter', type: 'vcf', params: { cutoff: 700, resonance: 0.32, keytrack: 0.5, slope: 1 }, position: { x: 570, y: 22 } },
      { id: 'env', type: 'adsr', params: { attack: 0.012, decay: 0.4, sustain: 0.8, release: 0.25, curve: 1 }, position: { x: 570, y: 330 } },
      { id: 'amp', type: 'vca', position: { x: 844, y: 22 } },
      { id: 'out', type: 'output', position: { x: 844, y: 200 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'osc', input: 'pitch' },
      { from: 'vibrato', port: 'out', to: 'depth', input: 'a' },
      { from: 'note', port: 'mod', to: 'depth', input: 'b' },
      { from: 'depth', port: 'out', to: 'osc', input: 'fm' },
      { from: 'note', port: 'pressure', to: 'bright', input: 'a' },
      { from: 'note', port: 'cc', to: 'bright', input: 'b' },
      { from: 'osc', port: 'out', to: 'filter', input: 'audio' },
      { from: 'bright', port: 'out', to: 'filter', input: 'cutoff' },
      { from: 'note', port: 'pitch', to: 'filter', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'env', input: 'gate' },
      { from: 'filter', port: 'out', to: 'amp', input: 'audio' },
      { from: 'env', port: 'out', to: 'amp', input: 'gain' },
      { from: 'amp', port: 'out', to: 'out', input: 'audio' },
    ],
  };
}

function velvetReed() {
  return {
    nodes: [
      { id: 'note', type: 'midi', params: { voices: 2 }, position: { x: 22, y: 22 } },
      { id: 'pressure', type: 'macro', params: { from: 0.42, to: 0.95 }, position: { x: 22, y: 442 } },
      { id: 'reed', type: 'reedPipe', params: { brightness: 0.43, attack: 0.034 }, position: { x: 296, y: 22 } },
      { id: 'out', type: 'output', position: { x: 570, y: 22 } },
    ],
    cables: [
      { from: 'note', port: 'pitch', to: 'reed', input: 'pitch' },
      { from: 'note', port: 'gate', to: 'reed', input: 'gate' },
      { from: 'pressure', port: 'out', to: 'reed', input: 'breath' },
      { from: 'reed', port: 'out', to: 'out', input: 'audio' },
    ],
    macros: [0.52], macroNames: ['Breath'],
  };
}

function percussionLayer(first, firstParams, second, secondParams) {
  const nodes = [{ id: 'note', type: 'midi', position: { x: 22, y: 22 } }];
  const cables = [];
  for (const [row, [id, params]] of [[first, firstParams], [second, secondParams]].entries()) {
    nodes.push({ id, type: 'drumVoice', params, position: { x: 296, y: 22 + row * 420 } });
    cables.push(
      { from: 'note', port: 'gate', to: id, input: 'trigger' },
      { from: 'note', port: 'velocity', to: id, input: 'velocity' },
      { from: id, port: 'out', to: 'mix', input: 'ab'[row] },
    );
  }
  nodes.push(
    { id: 'mix', type: 'mix', params: { a: 0.72, b: 0.66 }, position: { x: 570, y: 22 } },
    { id: 'out', type: 'output', position: { x: 844, y: 22 } },
  );
  cables.push({ from: 'mix', port: 'out', to: 'out', input: 'audio' });
  return { nodes, cables };
}

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

function drumPreset808() {
  const p = { ...defaultValues(DRUM_PARAMS), ...DRUM_PRESETS.find(preset => preset.name === '808-ish').params };
  const part = (key, sound) => ({
    sound, tune: 12 * Math.log2(p[key + '_pitch_hz'] / MODULAR_DRUM_PITCH[sound]),
    decay: p[key + '_decay_ms'] / 1000 / MODULAR_DRUM_DECAY[sound], tone: p[key + '_tone'],
    level: Math.min(1, 10 ** ((p[key + '_level_db'] + p.drum_master_volume_db) / 20)),
  });
  return drumPattern(108, [
    { id: 'kick', params: { ...part('kick', 0), kickSweep: p.kick_sweep_oct, kickSweepTime: p.kick_sweep_ms / 1000 },
      steps: [1, 0, 0, 0.82, 0.9, 0, 0, 0] },
    { id: 'snare', params: part('snare', 1), steps: [0, 0, 0.91, 0, 0, 0, 0.95, 0] },
    { id: 'hat', params: part('closed_hat', 3), steps: [0.65, 0.41, 0.54, 0.32, 0.7, 0.38, 0.58, 0.44] },
  ]);
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
  if (!nodes.some((n) => n.type === 'output' || n.type === 'fxOutput')) throw new Error('An audio output is required');
  const isGlobal = i => !!MODULAR_TYPES[nodes[i].type].global;
  if (nodes.filter(n => FX_TYPES.has(n.type)).length > MODULAR_FX_SLOTS)
    throw new Error(`Use at most ${MODULAR_FX_SLOTS} patch effects`);
  let lineCount = 0;
  for (const n of nodes) {
    const lines = n.type === 'physPiano' ? 3 : n.type === 'bowed' || n.type === 'physBowed' || n.type === 'physWind' || n.type === 'physBrass' ? 2 : Number(LINE_TYPES.has(n.type));
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
    if (isGlobal(src) && !isGlobal(dst)) throw new Error('Patch effects can feed only other patch effects and FX output');
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
  const globals = order.filter(isGlobal);
  const voiceOrder = order.filter(i => !isGlobal(i));
  const fxOutputs = globals.filter(i => nodes[i].type === 'fxOutput');
  let slot = 0;
  for (const i of globals) nodes[i].slot = FX_TYPES.has(nodes[i].type) ? slot++ : -1;
  // Voice signals that patch effects read; each is summed over the voices.
  const busLinks = globals.flatMap(g => Object.entries(nodes[g].links)
    .filter(([, link]) => !isGlobal(link.index)).map(([input, link]) => ({ g, input, index: link.index, port: link.port })));
  const audible = new Set([...outputs, ...fxOutputs]);
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
  const mono = { mode: midi?.params.voices ?? 0, glide: midi?.params.glide ?? 0, legatoOnly: midi?.params.glideMode ?? 0,
    bendRange: midi?.params.bendRange ?? 2 };
  return {
    nodes, order: voiceOrder, globals, busLinks, fxOutputs,
    delays, outputs, envelopes, lineCount, mono, clocks, autonomous: clocks.length > 0 && !midi,
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
    age: 0, tail: 0, glide: 0, slot, pressure: 0, tuning: 0, brightness: NaN, expression: NaN,
    stages: Array.from({ length: nodeCount }, newStage),
    signals: Array.from({ length: nodeCount }, () => ({})),
    lines: Array.from({ length: MODULAR_LINES }, () => new Float32Array(MODULAR_LINE_SAMPLES)) };
}

// Per-note values from polyphonic aftertouch or CLAP note expressions. NaN leaves the channel's CC.
function resetNoteExpressions(v) {
  v.pressure = 0; v.tuning = 0; v.brightness = NaN; v.expression = NaN;
  return v;
}
// MIDI's recommended controller defaults: volume 100, pan centred, expression full; others 0.
function resetControllers(s, channel) {
  s.bend[channel] = 0;
  s.pressure[channel] = 0;
  const cc = s.cc.subarray(channel * 128, channel * 128 + 128);
  cc.fill(0);
  cc[7] = 100 / 127; cc[10] = 64 / 127; cc[11] = 1;
}

export function modular_init(s, sampleRate) {
  s.sampleRate = sampleRate;
  s.bend = new Float64Array(16); // -1..1
  s.pressure = new Float64Array(16);
  s.cc = new Float64Array(16 * 128);
  for (let channel = 0; channel < 16; channel++) resetControllers(s, channel);
  s.sustain = new Uint8Array(16);
  s.tick = 0;
  s.host = { bpm: 120, playing: false, beat: 0 };
  s.stack = []; // Held keys in Mono and Legato, most recent last.
  s.lastKey = -1;
  s.out_l = 0; s.out_r = 0;
  s.fx = []; // Patch effect slots, allocated when a patch first uses them.
  modular_set_patch(s, defaultModularPatch());
}

export function modular_set_patch(s, patch) {
  const graph = compileModularPatch(patch);
  for (const node of graph.nodes) if (node.type === 'wavetable') wt_build(node.params.bank);
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
  s.gsig = graph.nodes.map(() => ({ left: 0, right: 0 }));
  s.bus = graph.nodes.map(() => ({ left: 0, right: 0 }));
  const slots = graph.nodes.filter(n => n.slot >= 0).length;
  while (s.fx.length < slots) s.fx.push({ buf: new Float32Array(fxSlotSize(s.sampleRate)), pos: new Int32Array(24), mem: new Float64Array(MODULAR_FX_MEMORY) });
  for (const fx of s.fx) { fx.buf.fill(0); fx.pos.fill(0); fx.mem.fill(0); }
}

// Echo needs the most: two channels of MODULAR_ECHO_SECONDS.
const echoLength = rate => Math.ceil(MODULAR_ECHO_SECONDS * rate) + 4;
const chorusLength = rate => Math.ceil(0.064 * rate) + 4;
const reverbLength = (rate, samples, channel) => Math.max(1, Math.round((samples + channel * MODULAR_REVERB_SPREAD) * rate / 44100));
function fxSlotSize(rate) { return 2 * echoLength(rate); }

// Linear interpolation in a circular section [start, start + length) of a slot buffer.
function fxRead(buf, start, length, write, delay) {
  const pos = write - delay, i = Math.floor(pos), frac = pos - i;
  const a = ((i % length) + length) % length, b = a + 1 === length ? 0 : a + 1;
  return buf[start + a] * (1 - frac) + buf[start + b] * frac;
}
const flush = x => Math.abs(x) < 1e-20 ? 0 : x;

function sampleEcho(s, fx, p, inL, inR, sig) {
  const L = echoLength(s.sampleRate), w = fx.pos[0];
  const target = clamp(p.sync ? MODULAR_ECHO_BEATS[p.beats] * 60 / s.host.bpm * s.sampleRate : p.time * 0.001 * s.sampleRate, 1, L - 2);
  if (!fx.pos[1]) { fx.mem[0] = target; fx.pos[1] = 1; }
  fx.mem[0] += (target - fx.mem[0]) * lag(0.05, s.sampleRate);
  const dl = fxRead(fx.buf, 0, L, w, fx.mem[0]), dr = fxRead(fx.buf, L, L, w, fx.mem[0]);
  fx.mem[1] = flush(fx.mem[1] + (dl - fx.mem[1]) * (1 - p.damping));
  fx.mem[2] = flush(fx.mem[2] + (dr - fx.mem[2]) * (1 - p.damping));
  const wl = p.pingPong ? (inL + inR) * 0.5 + p.feedback * fx.mem[2] : inL + p.feedback * fx.mem[1];
  const wr = p.pingPong ? p.feedback * fx.mem[1] : inR + p.feedback * fx.mem[2];
  fx.buf[w] = clamp(wl, -4, 4);
  fx.buf[L + w] = clamp(wr, -4, 4);
  fx.pos[0] = w + 1 === L ? 0 : w + 1;
  sig.left = inL * (1 - p.mix) + dl * p.mix;
  sig.right = inR * (1 - p.mix) + dr * p.mix;
}

function sampleChorus(s, fx, p, inL, inR, sig) {
  const L = chorusLength(s.sampleRate), w = fx.pos[0], ms = 0.001 * s.sampleRate;
  const phase = fx.mem[0];
  const dl = (p.delay + p.depth * 0.5 * (1 + Math.sin(TAU * phase))) * ms;
  const dr = (p.delay + p.depth * 0.5 * (1 + Math.sin(TAU * (phase + p.spread * 0.25)))) * ms;
  const wetL = fxRead(fx.buf, 0, L, w, dl), wetR = fxRead(fx.buf, L, L, w, dr);
  fx.buf[w] = clamp(inL, -4, 4);
  fx.buf[L + w] = clamp(inR, -4, 4);
  fx.pos[0] = w + 1 === L ? 0 : w + 1;
  const next = phase + p.rate / s.sampleRate;
  fx.mem[0] = next - Math.floor(next);
  sig.left = inL * (1 - p.mix) + wetL * p.mix;
  sig.right = inR * (1 - p.mix) + wetR * p.mix;
}

// Freeverb: eight damped combs in parallel, then four allpasses, per channel.
function sampleReverb(s, fx, p, inL, inR, sig) {
  const room = p.size * 0.28 + 0.7, damp = p.damping * 0.4, input = (inL + inR) * 0.015;
  const wet = [0, 0];
  let start = 0, k = 0;
  for (let channel = 0; channel < 2; channel++) {
    let sum = 0;
    for (let c = 0; c < MODULAR_REVERB_COMBS.length; c++, k++) {
      const length = reverbLength(s.sampleRate, MODULAR_REVERB_COMBS[c], channel), i = fx.pos[k];
      const y = fx.buf[start + i];
      fx.mem[k] = flush(y * (1 - damp) + fx.mem[k] * damp);
      fx.buf[start + i] = input + fx.mem[k] * room;
      fx.pos[k] = i + 1 === length ? 0 : i + 1;
      sum += y;
      start += length;
    }
    for (let a = 0; a < MODULAR_REVERB_ALLPASSES.length; a++, k++) {
      const length = reverbLength(s.sampleRate, MODULAR_REVERB_ALLPASSES[a], channel), i = fx.pos[k];
      const held = fx.buf[start + i];
      fx.buf[start + i] = sum + held * 0.5;
      sum = held - sum;
      fx.pos[k] = i + 1 === length ? 0 : i + 1;
      start += length;
    }
    wet[channel] = sum;
  }
  const wet1 = p.mix * (p.width / 2 + 0.5), wet2 = p.mix * ((1 - p.width) / 2);
  sig.left = wet[0] * wet1 + wet[1] * wet2 + inL * (1 - p.mix);
  sig.right = wet[1] * wet1 + wet[0] * wet2 + inR * (1 - p.mix);
}

function lowpassDelay(b, hz, rate) {
  const w = TAU * hz / rate;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}
// Recomputes a Physical Wind voice's loop for a new pitch or knob setting (Physical's voice_tune).
function tuneWind(st, kind, hz, embouchure, musette, rate) {
  const W = MODULAR_WIND, max = MODULAR_LINE_SAMPLES - 2, c = st.a1;
  c[3] = 1 / (2 * Math.sin(Math.PI * hz / rate)); // radiation: first difference, unity at the fundamental
  if (kind === 4) {
    c[0] = hz / rate;
    c[1] = Math.pow(2, musette / 1200);
  } else if (kind >= 2) {
    c[2] = Math.exp(-TAU * Math.max(kind === 2 ? 2500 : 3500, 6 * hz) / rate);
    const x = Math.log(hz * 48000 / (rate * 261.63)) / Math.LN2;
    const flat = kind === 2 ? clamp(2.5 + 4 * x, 2, 7) : clamp(1.5 + 3.5 * x, 1, 9);
    const total = clamp(rate / hz * Math.pow(2, -flat / 1200) - lowpassDelay(c[2], hz, rate), 4, 2 * max);
    c[1] = clamp(W.conePosition[kind] * total, 2, max);
    c[0] = clamp(total - c[1], 2, max);
  } else if (kind === 0) {
    c[2] = Math.exp(-TAU * Math.max(1500, 5 * hz) / rate);
    c[0] = clamp(0.5 * rate / hz - lowpassDelay(c[2], hz, rate), 2, max);
  } else {
    c[2] = 0.7 - 0.1 * 22050 / rate;
    const x = Math.log(hz * 48000 / (rate * 523.25)) / Math.LN2;
    const total = rate / hz * Math.pow(2, (10.7 * x + 3.1 * x * x) / 1200);
    c[0] = clamp(total - lowpassDelay(c[2], hz, rate), 2, max);
    c[1] = clamp(c[0] * W.jetRatio, 2, max);
    c[4] = 0.1 + 0.4 * embouchure;
    c[5] = clamp(1 + 0.5 * Math.log(hz * 48000 / (rate * 1046.5)) / Math.LN2, 1, 1.6);
  }
}
// A Physical Brass voice's lips and bore for a pitch and mouth pressure (Physical's voice_tune).
function tuneBrass(st, hz, press, lip, bell, rate) {
  const c = st.a1;
  const note = 69 + 12 * Math.log(hz / 440) / Math.LN2;
  const u = clamp((note - BRASS_NOTE0) / 4, 0, BRASS_MIN_DRIVE.length - 1.000001), i = Math.floor(u), fu = u - i;
  const mult = BRASS_MULTS[0] + (BRASS_MULTS.at(-1) - BRASS_MULTS[0]) * clamp(0.5 * lip + 0.5 * (press - 0.2) / 0.8, 0, 1);
  const drive = (BRASS_MIN_DRIVE[i] + (BRASS_MIN_DRIVE[i + 1] - BRASS_MIN_DRIVE[i]) * fu) * mult;
  let j = 0;
  while (j < BRASS_MULTS.length - 2 && mult > BRASS_MULTS[j + 1]) j++;
  const fv = clamp((mult - BRASS_MULTS[j]) / (BRASS_MULTS[j + 1] - BRASS_MULTS[j]), 0, 1);
  const a = BRASS_SHARP[j], b = BRASS_SHARP[j + 1];
  const sharp = (a[i] * (1 - fu) + a[i + 1] * fu) * (1 - fv) + (b[i] * (1 - fu) + b[i + 1] * fu) * fv;
  const f = hz * Math.pow(2, -sharp / 1200);
  c[0] = clamp(2 * rate / f, 2, MODULAR_LINE_SAMPLES - 2);
  const r = Math.exp(-Math.PI * Math.min(42, 0.15 * f) / rate), w = TAU * f / rate;
  c[1] = -2 * r * Math.cos(w);
  c[2] = r * r;
  c[3] = drive * hz * 2 * Math.sin(w) * (1 - r) / (0.3 * press);
  c[4] = press;
  c[5] = Math.exp(-TAU * 0.05 * f / rate);
  c[6] = Math.exp(-TAU * Math.max(1500, 5 * f) / rate);
  c[7] = 1 / (2 * Math.sin(w / 2));
  st.a2[0] = Math.exp(-TAU * (1500 + 6000 * bell) / rate);
}
// Phase delays in samples, at angular frequency w, of a first-order all-pass (a + z^-1) / (1 + a z^-1)
// and of the one-pole low-pass y = (1 - b) x + b y1.
const allpassDelay = (a, w) => -(Math.atan2(-Math.sin(w), a + Math.cos(w)) - Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w))) / w;
const onePoleDelay = (b, w) => Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
// A loop delay as an integer delay and a Thiran all-pass for the fraction: [length, coefficient].
function thiranSplit(L, w) {
  const n = clamp(Math.floor(L - 0.5), 1, MODULAR_LINE_SAMPLES - 2), d = clamp(L - n, 0.5, 1.5);
  let dl = d, a = 0;
  for (let it = 0; it < 4; it++) {
    a = (1 - dl) / (1 + dl);
    dl += d - allpassDelay(a, w);
  }
  return [n, (1 - dl) / (1 + dl)];
}
// A Physical Piano voice's two strings for a pitch and knob setting (Physical's voice_tune):
// a damping low-pass, four dispersion all-passes that stretch the partials like a stiff string,
// and a tuning all-pass per string.
function tunePiano(st, hz, inharmonicity, damping, detune, rate) {
  const c = st.a1, P = MODULAR_PIANO;
  const b = (0.05 + 0.6 * damping) * clamp(Math.sqrt(262 / hz), 0.15, 1) * Math.min(1, Math.pow(2093 / hz, 3));
  // The all-pass coefficient that puts partial n where a string with inharmonicity B has it.
  const k = inharmonicity / 0.35, B = 1.5e-4 * (1 + Math.pow(hz / 262, 1.5)) * k * k;
  const w1 = TAU * hz / rate, n = Math.min(8, Math.floor(0.5 * Math.PI / w1));
  let a = 0;
  if (n >= 2 && B > 0) {
    const wn = n * w1, period = rate / hz;
    const target = period * (1 - 1 / Math.sqrt(1 + B * n * n)) - (onePoleDelay(b, w1) - onePoleDelay(b, wn));
    if (target > 0) {
      const room = period - onePoleDelay(b, w1) - 3;
      let lo = -0.95, hi = 0;
      for (let it = 0; it < 40; it++) {
        const mid = 0.5 * (lo + hi), pd1 = P.allpasses * allpassDelay(mid, w1);
        if (pd1 - P.allpasses * allpassDelay(mid, wn) > target || pd1 > room) lo = mid;
        else hi = mid;
      }
      a = 0.5 * (lo + hi);
    }
  }
  const det = Math.pow(2, detune / 2400), hzA = hz * det, hzB = hz / det;
  const wA = TAU * hzA / rate, wB = TAU * hzB / rate, count = a === 0 ? 0 : P.allpasses;
  [c[0], c[2]] = thiranSplit(rate / hzA - onePoleDelay(b, wA) - count * allpassDelay(a, wA), wA);
  [c[1], c[3]] = thiranSplit(rate / hzB - onePoleDelay(b, wB) - count * allpassDelay(a, wB), wB);
  c[4] = a; c[5] = count; c[6] = b;
  c[7] = 0.9 * clamp(Math.pow(hz / 220, 0.3), 0.7, 2);
  st.a2[2] = wA; st.a2[3] = wB;
}
// Scratch buffers for the hammer pulse (the audio thread renders one voice at a time).
const pianoPulse = new Float64Array(MODULAR_LINE_SAMPLES), pianoForce = new Float64Array(MODULAR_LINE_SAMPLES);
// A felt hammer thrown at the string at v0 m/s (Physical's hammer_force): the force pulse as
// string velocity, written to pianoPulse. Returns its length.
function hammerForce(hz, v0, hardness, beta, rate) {
  const P = MODULAR_PIANO, sub = P.substeps;
  const m = clamp(0.0087 * Math.pow(262 / hz, 0.3), 0.004, 0.012), Z = 2 * Math.pow(262 / hz, 0.2);
  const K = 250000000 * Math.pow(100, hardness - 0.5), dt = 1 / (rate * sub);
  const lagged = clamp(Math.round(beta * rate * sub / hz), 1, MASK);
  const most = Math.min(MODULAR_LINE_SAMPLES, Math.floor(0.03 * rate));
  let vh = v0, d = 0, i = 0, count = 0;
  while (count < most) {
    let acc = 0;
    for (let j = 0; j < sub; j++) {
      const F = d > 0 ? K * Math.pow(d, 2.5) : 0;
      pianoForce[i & MASK] = F;
      const back = i >= lagged ? pianoForce[(i - lagged) & MASK] : 0;
      vh -= F / m * dt;
      d += (vh - (F - back) / (2 * Z)) * dt;
      acc += F;
      i++;
    }
    pianoPulse[count++] = acc / (sub * 2 * Z);
    if (d <= 0 && vh < 0 && count > 3) break;
  }
  return count;
}
// |DFT| of the first `count` pulse samples at w.
function pulseLevel(count, w) {
  let re = 0, im = 0;
  for (let i = 0; i < count; i++) { re += pianoPulse[i] * Math.cos(w * i); im += pianoPulse[i] * Math.sin(w * i); }
  return Math.sqrt(re * re + im * im);
}
// The hammer excitation for a new note (Physical's stiff string note on), written to `line`.
// Returns its length.
function pianoStrike(st, line, hz, vel, hardness, position, rate) {
  const P = MODULAR_PIANO, e = pianoPulse;
  // Hammer speed in m/s: soft and even up to mf, fast only near ff.
  const v0 = 0.3 + 4.7 * vel * vel * vel;
  const len = hammerForce(hz, v0, hardness, position, rate);
  // The strike position comb, after the pulse's tail.
  const pick = Math.max(1, Math.round(position * st.a1[0]));
  const total = Math.min(MODULAR_LINE_SAMPLES, Math.max(len + pick + 1, Math.round(0.03 * rate)));
  for (let i = len; i < total; i++) e[i] = 0;
  for (let i = total - 1; i >= pick; i--) e[i] -= e[i - pick];
  // High-pass at 0.8 x the fundamental: below it the pulse is only a click.
  const hpA = 1 - Math.exp(-TAU * 0.8 * hz / rate), hp = [0, 0, 0, 0];
  for (let i = 0; i < total; i++) {
    let x = e[i];
    for (let k = 0; k < 4; k++) { hp[k] += hpA * (x - hp[k]); x -= hp[k]; }
    e[i] = x;
  }
  // Top octaves: fade towards a windowed sine burst at the fundamental.
  const top = clamp((hz - rate / 16) / (rate / 10 - rate / 16), 0, 1);
  if (top > 0) {
    const w0 = TAU * hz / rate;
    let around = 0;
    for (let k = 0; k < 5; k++) around = Math.max(around, pulseLevel(total, w0 * (0.8 + 0.1 * k)));
    const want = Math.max(pulseLevel(total, w0), 0.3 * around);
    const blen = Math.min(total, Math.max(len, Math.ceil(2 * rate / hz)));
    const amp = want / (blen / 4);
    for (let i = 0; i < total; i++) {
      const burst = i < blen ? amp * (0.5 - 0.5 * Math.cos(TAU * i / blen)) * Math.sin(w0 * i) : 0;
      e[i] = (1 - top) * e[i] + top * burst;
    }
  }
  // Normalise at the fundamental (or 30 % of the level around it, if it falls into a notch).
  let mag = 0, around = 0;
  for (let k = 0; k < 5; k++) {
    const level = pulseLevel(total, TAU * hz * (0.8 + 0.1 * k) / rate);
    if (k === 2) mag = level;
    if (level > around) around = level;
  }
  mag = Math.max(mag, 0.3 * around);
  const scale = P.gain * Math.pow(clamp(hz / 262, 0.35, 8), -1.5) * Math.pow(v0 / 2, 0.6) / Math.max(1e-12, mag);
  // Plus a little key and action thump: decaying low-passed noise.
  const decay = Math.exp(-1 / (0.004 * rate)), thumpA = 1 - Math.exp(-TAU * 600 / rate);
  let env = 0.02 * vel, lp = 0;
  for (let i = 0; i < total; i++) {
    lp += thumpA * (white(st) - lp);
    line[i] = e[i] * scale + lp * env;
    env *= decay;
  }
  return total;
}
// The Physical instrument's piano soundboard: 16 band-pass resonances, dense and long in the
// bass, alternately leaning left and right. mem holds 2 states per mode, then 6 coefficients.
function sampleSoundboard(s, fx, p, inL, inR, sig) {
  const mem = fx.mem, rate = s.sampleRate;
  if (!fx.pos[0]) {
    fx.pos[0] = 1;
    for (let k = 0; k < 16; k++) {
      const f = 75 * Math.pow(2800 / 75, k / 15) * (1 + 0.06 * Math.sin(2.3 * k + 1));
      const t60 = clamp(0.35 * Math.pow(150 / f, 0.4), 0.05, 0.6);
      const kk = 1 / clamp(Math.PI * f * t60 / 6.908, 2, 60), g = Math.tan(Math.PI * Math.min(f, rate * 0.45) / rate);
      const o = 32 + k * 6, a1 = 1 / (1 + g * (g + kk)), gain = (0.7 + 0.3 * Math.cos(1.7 * k)) / (1 + f / 1500) * 0.45;
      mem[o] = kk; mem[o + 1] = a1; mem[o + 2] = g * a1; mem[o + 3] = g * g * a1;
      mem[o + 4] = gain * (k % 2 === 0 ? 1.3 : 0.7);
      mem[o + 5] = gain * (k % 2 === 0 ? 0.7 : 1.3);
    }
  }
  const x = 0.5 * (inL + inR);
  let l = 0, r = 0;
  for (let k = 0; k < 16; k++) {
    const o = 32 + k * 6, i = 2 * k;
    const v3 = x - mem[i + 1];
    const v1 = mem[o + 1] * mem[i] + mem[o + 2] * v3, v2 = mem[i + 1] + mem[o + 2] * mem[i] + mem[o + 3] * v3;
    mem[i] = 2 * v1 - mem[i];
    mem[i + 1] = 2 * v2 - mem[i + 1];
    const bp = v1 * mem[o];
    l += bp * mem[o + 4];
    r += bp * mem[o + 5];
  }
  const body = p.body, dry = 1 - 0.7 * body;
  sig.left = inL * dry + body * l;
  sig.right = inR * dry + body * r;
}
function freeReedFlow(x, bias) {
  const d = Math.abs(x - bias) - MODULAR_WIND.overlap;
  return d > 0 ? d : 0;
}

// The Physical instrument's guitar amp: pre high-pass, asymmetric soft clipping in one or two
// stages, then a resonant cabinet low-pass and an 80 Hz high-pass.
function svfStep(mem, i, x, cutoff, k, rate) {
  const g = Math.tan(Math.PI * clamp(cutoff, 5, rate * 0.49) / rate);
  const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
  const v3 = x - mem[i + 1];
  const v1 = a1 * mem[i] + a2 * v3, v2 = mem[i + 1] + a2 * mem[i] + a3 * v3;
  mem[i] = 2 * v1 - mem[i];
  mem[i + 1] = 2 * v2 - mem[i + 1];
  return [v2, x - k * v1 - v2];
}
function sampleAmp(s, fx, p, inL, inR, sig) {
  const t = MODULAR_AMP_TYPES[p.type], rate = s.sampleRate;
  const drive = t[1] * Math.pow(t[2] / t[1], p.gain), biasOut = softClip(t[3]);
  const cabinet = t[5] * Math.pow(t[6] / t[5], p.tone), out = Math.pow(10, p.level / 20);
  const pre = 1 - Math.exp(-TAU * clamp(t[0], 1, rate * 0.49) / rate), inter = 1 - Math.exp(-TAU * 5000 / rate);
  const channel = (x, base) => {
    const mem = fx.mem;
    mem[base] += pre * (x - mem[base]);
    let y = softClip((x - mem[base]) * drive + t[3]) - biasOut;
    if (t[4] > 1) { mem[base + 1] += inter * (y - mem[base + 1]); y = softClip(mem[base + 1] * 4); }
    const [low] = svfStep(mem, base + 2, y, cabinet, 1.1, rate);
    return svfStep(mem, base + 4, low, 80, 1.4, rate)[1] * out;
  };
  sig.left = channel(inL, 0);
  sig.right = channel(inR, 6);
}

// Runs the patch effects once per sample on the summed voice signals. Returns [left, right].
function sampleGlobals(s) {
  const { nodes, globals } = s.graph;
  let left = 0, right = 0;
  for (const g of globals) {
    const n = nodes[g], sig = s.gsig[g];
    const input = key => {
      const link = n.links[key];
      if (!link) return undefined;
      return MODULAR_TYPES[nodes[link.index].type].global ? s.gsig[link.index][link.port] : s.bus[g][key];
    };
    const inL = input('left') ?? 0, inR = input('right') ?? inL;
    if (n.type === 'fxOutput') {
      left += inL * n.params.level;
      right += inR * n.params.level;
      continue;
    }
    const fx = s.fx[n.slot];
    if (n.type === 'echo') sampleEcho(s, fx, n.params, inL, inR, sig);
    else if (n.type === 'chorus') sampleChorus(s, fx, n.params, inL, inR, sig);
    else if (n.type === 'guitarAmp') sampleAmp(s, fx, n.params, inL, inR, sig);
    else if (n.type === 'soundboard') sampleSoundboard(s, fx, n.params, inL, inR, sig);
    else sampleReverb(s, fx, n.params, inL, inR, sig);
    sig.left = clamp(sig.left, -1e6, 1e6);
    sig.right = clamp(sig.right, -1e6, 1e6);
  }
  return [left, right];
}

/**
 * Host transport at the start of a block: tempo, whether it plays, and the beat (quarter note)
 * position. While playing the beat advances every sample until the next call resyncs it.
 */
export function modular_transport(s, bpm, playing, beat) {
  if (bpm > 0 && Number.isFinite(bpm)) s.host.bpm = clamp(bpm, 1, 1000);
  s.host.playing = !!playing;
  if (playing && Number.isFinite(beat)) s.host.beat = beat;
}

export function modular_all_notes_off(s) {
  s.sustain.fill(0);
  for (const v of s.voices) v.active = false;
}

export function modular_midi(s, status, d1, d2) {
  if (s.graph.autonomous) return;
  const op = status & 0xf0, channel = status & 0x0f;
  if (op === 0xe0) { s.bend[channel] = (((d2 << 7) | d1) - 8192) / 8192; return; }
  if (op === 0xd0) { s.pressure[channel] = clamp(d1, 0, 127) / 127; return; }
  if (op === 0xa0) {
    for (const v of s.voices) if (v.active && v.channel === channel && v.note === d1) v.pressure = clamp(d2, 0, 127) / 127;
    return;
  }
  if (op === 0xb0) {
    if (d1 >= 0 && d1 < 120) s.cc[channel * 128 + d1] = clamp(d2, 0, 127) / 127;
    if (d1 === 121) {
      resetControllers(s, channel);
      for (const v of s.voices) if (v.channel === channel) resetNoteExpressions(v);
    }
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
  resetNoteExpressions(v);
}

// Mono and Legato play voice 0 with last-note priority, as the Synth instrument does.
function monoPlay(s, channel, key, velocity, retrigger, overlap) {
  const v = s.voices[0], { glide, legatoOnly } = s.graph.mono;
  let offset = 0;
  if (glide > 0 && (overlap || !legatoOnly))
    offset = v.active ? v.note + v.glide - key : s.lastKey >= 0 ? s.lastKey - key : 0;
  s.lastKey = key;
  if (retrigger || !v.active) startVoice(s, v, channel, key, velocity);
  else { v.channel = channel; v.note = key; v.held = v.keyDown = true; v.tail = 0; resetNoteExpressions(v); }
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

// Patch effects have one signal for the whole patch; other modules show the first active voice.
function signalOf(s, voice, index, port) {
  if (MODULAR_TYPES[s.graph.nodes[index].type].global) return s.gsig[index][port] ?? 0;
  return voice ? voice.signals[index][port] : 0;
}

function captureScope(s, scope, voice) {
  scope.samples[scope.write] = signalOf(s, voice, scope.index, scope.port);
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
    const value = signalOf(s, voice, index, port);
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
    st.phase = st.p0 = st.prev = st.ic1 = st.ic2 = st.ic3 = 0;
    st.y1.fill(0);
  }
  st.lastGate = trigger;
  st.mode = st.env > 1e-4 ? 1 : 0;
  if (!st.mode) return 0;
  const sound = st.write, t = st.p0, sr = s.sampleRate;
  const tone = parameter(v, n, 'tone');
  const baseHz = MODULAR_DRUM_PITCH[sound] * Math.pow(2, parameter(v, n, 'tune') / 12);
  const noise = white(st);
  const corner = sound === 2 || sound === 8 ? baseHz : 900 + 3200 * tone;
  st.prev += (noise - st.prev) * lag(1 / (TAU * corner), sr);
  st.ic1 += (st.prev - st.ic1) * lag(1 / (TAU * (sound === 2 ? baseHz * 0.48 : 420)), sr);
  const band = st.prev - st.ic1;
  let sample;
  if (sound === 3 || sound === 4 || sound >= 9) {
    let metal = 0;
    for (let i = 0; i < HAT_RATIOS.length; i++) {
      const phase = st.y1[i] + Math.min(0.45, baseHz * HAT_RATIOS[i] / sr);
      st.y1[i] = phase - Math.floor(phase);
      metal += st.y1[i] < 0.5 ? 1 : -1;
    }
    const noiseMix = sound === 9 ? 0.86 : sound === 10 ? 0.29 : 0.55;
    const metalMix = sound === 10 ? 0.32 + 0.42 * tone : 0.12 + 0.38 * tone;
    sample = noiseMix * (noise - st.prev) + metalMix * metal / HAT_RATIOS.length;
  } else if (sound === 2) {
    const burstAge = t < 0.024 ? t % 0.012 : t - 0.024;
    sample = band * (0.38 + Math.exp(-burstAge / 0.0025) * (1.2 + tone));
  } else if (sound === 7) {
    const phase1 = st.y1[0] + Math.min(0.45, baseHz / sr);
    const phase2 = st.y1[1] + Math.min(0.45, baseHz * 1.48 / sr);
    st.y1[0] = phase1 - Math.floor(phase1);
    st.y1[1] = phase2 - Math.floor(phase2);
    const metal = (st.y1[0] < 0.5 ? 0.5 : -0.5) + (st.y1[1] < 0.5 ? 0.5 : -0.5);
    st.ic2 += (metal - st.ic2) * lag(1 / (TAU * (2 + tone) * baseHz), sr);
    st.ic3 += (st.ic2 - st.ic3) * lag(1 / (TAU * baseHz * 0.8), sr);
    sample = (st.ic2 - st.ic3) * (0.58 + 0.42 * Math.exp(-t / 0.019));
  } else if (sound === 8) {
    sample = (0.3 * (noise - st.prev) + band * (0.68 + 0.45 * tone)) * (1 - Math.exp(-t / 0.009));
  } else {
    const bend = sound === 0 ? 2.6 : sound === 5 ? 0.58 : sound === 6 ? 0 : 0.16;
    const sweep = sound === 0 ? parameter(v, n, 'kickSweep') : -1;
    const hz = sweep >= 0 ? baseHz * 2 ** (sweep * Math.exp(-t / parameter(v, n, 'kickSweepTime')))
      : baseHz * (1 + bend * Math.exp(-t / (sound === 0 ? 0.014 : 0.021)));
    const phase = st.phase + Math.min(0.45, hz / sr);
    st.phase = phase - Math.floor(phase);
    const sine = Math.sin(TAU * st.phase);
    if (sound === 1) {
      const secondary = st.y1[0] + Math.min(0.45, hz * 1.46 / sr);
      st.y1[0] = secondary - Math.floor(secondary);
      const body = (0.72 * sine + 0.28 * Math.sin(TAU * st.y1[0])) * Math.exp(-t / 0.05);
      sample = body * (0.68 - 0.35 * tone) + band * (0.68 + 0.55 * tone);
    } else if (sound === 6) {
      const secondary = st.y1[0] + Math.min(0.45, hz * 0.27 / sr);
      st.y1[0] = secondary - Math.floor(secondary);
      const click = (noise - st.prev) * tone * Math.exp(-t / 0.0025);
      sample = Math.tanh(1.4 * sine + 0.45 * Math.sin(TAU * st.y1[0]) + 0.65 * click);
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

// Position within the current pulse, from the host's beat count times pulses per beat.
const hostPhase = pulses => pulses - Math.floor(pulses);

function sampleNode(s, v, i) {
  const n = s.graph.nodes[i], st = v.stages[i], sig = v.signals[i];
  switch (n.type) {
    case 'midi': {
      const bend = s.bend[v.channel], number = n.params.cc, cc = s.cc[v.channel * 128 + number];
      sig.pitch = v.note + v.glide + bend * s.graph.mono.bendRange + v.tuning;
      sig.gate = v.held ? 1 : 0; sig.velocity = v.velocity;
      sig.bend = bend;
      sig.mod = s.cc[v.channel * 128 + 1];
      sig.pressure = Math.max(s.pressure[v.channel], v.pressure);
      sig.cc = number === 74 && !Number.isNaN(v.brightness) ? v.brightness
        : number === 11 && !Number.isNaN(v.expression) ? v.expression : cc;
      break;
    }
    case 'clock':
      if (n.params.sync && !s.host.playing) {
        sig.phase = sig.gate = 0; sig.reset = 1;
        break;
      }
      sig.phase = n.params.sync ? hostPhase(s.host.beat * n.params.pulses) : s.clockPhases[i];
      sig.gate = Number(sig.phase < n.params.duty);
      sig.reset = 0;
      break;
    case 'gatedClock': {
      const run = read(v, n, 'run', Number(v.keyDown)) > 0;
      sig.gate = Number(run && st.phase < parameter(v, n, 'duty'));
      sig.phase = run ? st.phase : 0;
      sig.reset = Number(!run);
      const bpm = n.params.sync ? s.host.bpm : parameter(v, n, 'bpm');
      const phase = st.phase + bpm * parameter(v, n, 'pulses') / (60 * s.sampleRate);
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
    case 'wavetable': {
      const sync = read(v, n, 'sync') > 0;
      if (!st.ready || (sync && !st.lastGate)) {
        const start = parameter(v, n, 'phase');
        for (let copy = 0; copy < 7; copy++) {
          const phase = start + copy * 0.6180339887498949;
          st.y1[copy] = phase - Math.floor(phase);
        }
        st.ready = true;
      }
      st.lastGate = sync;
      const note = read(v, n, 'pitch', 69) + parameter(v, n, 'tune') / 100 +
        12 * (parameter(v, n, 'octave') + read(v, n, 'fm'));
      const position = parameter(v, n, 'position'), voices = parameter(v, n, 'voices');
      const detune = parameter(v, n, 'detune'), spread = parameter(v, n, 'spread');
      const pm = read(v, n, 'pm') / TAU;
      let left = 0, right = 0, mono = 0;
      sig.sync = 0;
      for (let copy = 0; copy < voices; copy++) {
        const offset = voices === 1 ? 0 : 2 * copy / (voices - 1) - 1;
        const hz = 440 * Math.pow(2, (note - 69 + offset * detune / 200) / 12);
        const inc = clamp(hz / s.sampleRate, 0.01 / s.sampleRate, 0.45);
        const sample = wt_sample(st.y1[copy], inc, n.params.bank, position, pm);
        const phase = st.y1[copy] + inc;
        if (copy === 0 && phase >= 1) sig.sync = 1;
        st.y1[copy] = phase < 1 ? phase : phase - 1;
        mono += sample;
        left += sample * Math.sqrt(1 - offset * spread);
        right += sample * Math.sqrt(1 + offset * spread);
      }
      const gain = parameter(v, n, 'level') / voices;
      sig.out = mono * gain; sig.left = left * gain; sig.right = right * gain;
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
    case 'physString': {
      // The Physical instrument's String model: a Karplus-Strong loop with a one-pole damping
      // filter, filled with a pick-combed noise burst or hammer pulse on each rising gate.
      const line = v.lines[n.line];
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12),
        s.sampleRate / (MODULAR_LINE_SAMPLES - 4), s.sampleRate * 0.45);
      const damping = 0.05 + 0.9 * parameter(v, n, 'damping');
      if (st.key[0] !== hz || st.key[1] !== damping) {
        // The loop delay less the damping filter's phase delay at the fundamental.
        st.key[0] = hz; st.key[1] = damping;
        const w = TAU * hz / s.sampleRate;
        st.a1[0] = clamp(s.sampleRate / hz - Math.atan2(damping * Math.sin(w), 1 - damping * Math.cos(w)) / w,
          2, MODULAR_LINE_SAMPLES - 2);
        st.a1[1] = 1.2 * clamp(Math.pow(hz / 220, 0.3), 0.7, 2);
        st.key[2] = NaN;
      }
      if (gate && !st.lastGate) {
        line.fill(0);
        const count = Math.ceil(st.a1[0]);
        const bright = clamp(parameter(v, n, 'brightness') * (0.6 + 0.4 * clamp(read(v, n, 'velocity', 1), 0, 1)), 0.02, 1);
        const a = bright * bright, norm = 1 / Math.sqrt(a / (2 - a));
        const strike = parameter(v, n, 'excitation') >= 0.5, width = Math.max(2, count * (0.5 - 0.45 * bright));
        let lp = 0;
        for (let i = 0; i < count; i++) {
          let x;
          if (strike) x = i < width ? 0.5 - 0.5 * Math.cos(TAU * i / width) : 0;
          else { lp += a * (white(st) - lp); x = lp * norm * 0.5; }
          line[(st.write + i) & MASK] = x;
        }
        // Picking point: subtract the burst delayed by the pick distance.
        const pick = Math.max(1, Math.round(parameter(v, n, 'pick') * count));
        for (let i = count - 1; i >= pick; i--) line[(st.write + i) & MASK] -= line[(st.write + i - pick) & MASK];
        st.write = (st.write + count) & MASK;
        st.prev = 0;
      }
      st.lastGate = gate;
      const decay = parameter(v, n, 'decay');
      const t60 = gate ? decay : Math.min(decay, parameter(v, n, 'release'));
      if (st.key[2] !== t60) { st.key[2] = t60; st.a2[0] = Math.exp(-LN1000 / (hz * t60)); }
      const y = lineRead(line, st.write, st.a1[0]);
      st.prev = (1 - damping) * y + damping * st.prev;
      const feedback = clamp(st.prev * st.a2[0], -4, 4);
      line[st.write] = feedback;
      st.write = (st.write + 1) & MASK;
      st.amp = Math.max(Math.abs(feedback), st.amp * 0.9995);
      st.mode = st.amp > 1e-4 ? 1 : 0;
      sig.out = feedback * st.a1[1] * parameter(v, n, 'level');
      break;
    }
    case 'physBowed': {
      // The Physical instrument's Bowed model: bridge and nut delay lines meeting at the bow, a
      // friction curve between bow and string, and two body resonances. **bow** is the bow
      // envelope, scaled by **speed** into the bow velocity.
      const bridge = v.lines[n.line], nut = v.lines[n.line + 1];
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12),
        s.sampleRate / (MODULAR_LINE_SAMPLES - 4), s.sampleRate * 0.45);
      const damping = 0.1 + 0.75 * (1 - parameter(v, n, 'brightness')), position = parameter(v, n, 'position');
      if (st.key[0] !== hz || st.key[1] !== damping || st.key[2] !== position) {
        st.key[0] = hz; st.key[1] = damping; st.key[2] = position;
        const w = TAU * hz / s.sampleRate;
        const total = s.sampleRate / hz - Math.atan2(damping * Math.sin(w), 1 - damping * Math.cos(w)) / w;
        st.a1[0] = clamp(total * position, 2, MODULAR_LINE_SAMPLES - 2);
        st.a1[1] = clamp(total * (1 - position), 2, MODULAR_LINE_SAMPLES - 2);
      }
      if (!st.ready) {
        // The body's two band-pass resonances at 290 Hz and 1150 Hz.
        st.ready = true;
        for (const [k, hzBody, q] of [[0, 290, 0.6], [1, 1150, 0.9]]) {
          const g = Math.tan(Math.PI * hzBody / s.sampleRate);
          st.a2[3 * k] = 1 / (1 + g * (g + q)); st.a2[3 * k + 1] = g * st.a2[3 * k]; st.a2[3 * k + 2] = g * st.a2[3 * k + 1];
        }
      }
      const bow = clamp(read(v, n, 'bow'), 0, 1) * (0.03 + 0.25 * parameter(v, n, 'speed'));
      const bridgeOut = lineRead(bridge, st.write, st.a1[0]), nutOut = lineRead(nut, st.write, st.a1[1]);
      st.prev = (1 - damping) * bridgeOut + damping * st.prev;
      const reflectedBridge = -st.prev * 0.95, reflectedNut = -nutOut;
      const relative = bow - (reflectedBridge + reflectedNut);
      const friction = Math.min(1, Math.pow(Math.abs(relative * (5 - 4 * parameter(v, n, 'pressure'))) + 0.75, -4));
      nut[st.write] = clamp(reflectedBridge + relative * friction, -4, 4);
      bridge[st.write] = clamp(reflectedNut + relative * friction, -4, 4);
      st.write = (st.write + 1) & MASK;
      // Band-pass outputs of the two body resonances (state-variable filters).
      let body = 0;
      for (let k = 0; k < 2; k++) {
        const ic1 = k ? 'ic3' : 'ic1', ic2 = k ? 'ic4' : 'ic2', a1 = st.a2[3 * k], a2 = st.a2[3 * k + 1], a3 = st.a2[3 * k + 2];
        const v3 = bridgeOut - st[ic2], v1 = a1 * st[ic1] + a2 * v3, v2 = st[ic2] + a2 * st[ic1] + a3 * v3;
        st[ic1] = 2 * v1 - st[ic1]; st[ic2] = 2 * v2 - st[ic2];
        body += (k ? 0.8 : 1.2) * v1;
      }
      st.amp = Math.max(Math.abs(bridgeOut), st.amp * 0.9995);
      st.mode = bow > 1e-5 || st.amp > 1e-4 ? 1 : 0;
      sig.out = (bridgeOut + body) * 1.6 * parameter(v, n, 'level');
      break;
    }
    case 'physPiano': {
      // The Physical instrument's Stiff String (piano) model: two detuned strings with dispersion
      // all-passes, struck by a felt hammer on each rising gate. Raw **velocity** sets the hammer
      // speed, so loud notes are brighter; the level follows velocity only through the hammer.
      const lineA = v.lines[n.line], lineB = v.lines[n.line + 1], pulse = v.lines[n.line + 2], rate = s.sampleRate;
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12), rate / (MODULAR_LINE_SAMPLES - 4), rate * 0.45);
      const inharmonicity = parameter(v, n, 'inharmonicity'), damping = parameter(v, n, 'damping'), detune = parameter(v, n, 'detune');
      if (st.key[0] !== hz || st.key[1] !== inharmonicity || st.key[2] !== damping || st.key[3] !== detune) {
        st.key[0] = hz; st.key[1] = inharmonicity; st.key[2] = damping; st.key[3] = detune;
        tunePiano(st, hz, inharmonicity, damping, detune, rate);
        st.key[4] = NaN;
      }
      const c = st.a1, g = st.a2;
      const decay = parameter(v, n, 'decay');
      if (st.key[4] !== decay) {
        // Higher strings decay faster; the damping filter's loss at the fundamental is divided out.
        st.key[4] = decay;
        const t = decay * clamp(Math.pow(220 / hz, 0.4), 0.25, 2), b = c[6];
        const gain = w => (1 - b) / Math.sqrt(1 - 2 * b * Math.cos(w) + b * b);
        g[0] = Math.min(0.99999, Math.exp(-LN1000 / (g[2] / TAU * rate * t)) / gain(g[2]));
        g[1] = Math.min(0.99999, Math.exp(-LN1000 / (g[3] / TAU * rate * t)) / gain(g[3]));
      }
      if (gate && !st.lastGate) {
        lineA.fill(0); lineB.fill(0);
        st.y1.fill(0); st.y2.fill(0);
        st.ic1 = st.ic2 = st.ic3 = st.ic4 = st.p0 = st.p1 = st.p2 = 0;
        g[4] = pianoStrike(st, pulse, hz, clamp(read(v, n, 'velocity', 1), 0, 1), parameter(v, n, 'hardness'),
          parameter(v, n, 'position'), rate);
      }
      st.lastGate = gate;
      let loopA = g[0], loopB = g[1];
      if (!gate) {
        const released = Math.exp(-LN1000 / (hz * parameter(v, n, 'release')));
        loopA = Math.min(loopA, released);
        loopB = Math.min(loopB, released);
      }
      const exc = st.p2 < g[4] ? pulse[st.p2++] : 0;
      const a = c[4], count = c[5], b = c[6], A = st.y1, B = st.y2;
      // String A: tuning all-pass, dispersion all-passes, damping low-pass.
      let x = lineA[(st.write - c[0]) & MASK];
      let y = c[2] * x + st.ic1 - c[2] * st.ic2;
      st.ic1 = x; st.ic2 = y;
      for (let k = 0; k < count; k++) { x = y; y = a * x + A[2 * k] - a * A[2 * k + 1]; A[2 * k] = x; A[2 * k + 1] = y; }
      st.p0 = (1 - b) * y + b * st.p0;
      const fa = st.p0 * loopA + 0.5 * exc;
      lineA[st.write] = fa;
      x = lineB[(st.write - c[1]) & MASK];
      y = c[3] * x + st.ic3 - c[3] * st.ic4;
      st.ic3 = x; st.ic4 = y;
      for (let k = 0; k < count; k++) { x = y; y = a * x + B[2 * k] - a * B[2 * k + 1]; B[2 * k] = x; B[2 * k + 1] = y; }
      st.p1 = (1 - b) * y + b * st.p1;
      const fb = st.p1 * loopB + 0.32 * exc;
      lineB[st.write] = fb;
      st.write = (st.write + 1) & MASK;
      const out = (fa + fb) * c[7];
      st.amp = Math.max(Math.abs(out), st.amp * 0.9995);
      st.mode = st.amp > 1e-4 || st.p2 < g[4] ? 1 : 0;
      sig.out = clamp(out, -16, 16) * parameter(v, n, 'level');
      break;
    }
    case 'physBrass': {
      // The Physical instrument's Brass model: a lip resonator driven by the mouth pressure
      // against the bore's reflection, wave steepening and a bell filter. **breath** is the breath
      // envelope; raw **velocity** scales the blowing pressure by **velocity** (amount).
      const line = v.lines[n.line], steep = v.lines[n.line + 1], B = MODULAR_BRASS, rate = s.sampleRate;
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12), rate / (MODULAR_LINE_SAMPLES - 4), rate * 0.45);
      const velocity = clamp(read(v, n, 'velocity', 1), 0, 1);
      const press = clamp((0.2 + 0.8 * parameter(v, n, 'pressure')) * Math.pow(10, parameter(v, n, 'velocity') * (velocity - 1)), 0.05, 1);
      const lip = parameter(v, n, 'lip'), bell = parameter(v, n, 'bell');
      if (st.key[0] !== hz || st.key[1] !== press || st.key[2] !== lip || st.key[3] !== bell) {
        st.key[0] = hz; st.key[1] = press; st.key[2] = lip; st.key[3] = bell;
        tuneBrass(st, hz, press, lip, bell, rate);
      }
      const c = st.a1, m = st.y1;
      if (!st.ready) {
        // The tongue release: seed the bore with the note's wave and boost the lip gain for the
        // attack (at least ten periods).
        st.ready = true;
        const count = Math.ceil(c[0]), w = TAU * 2 / c[0];
        for (let i = 0; i < count; i++) line[(st.write + i) & MASK] = B.seed * 0.3 * c[4] * Math.sin(w * i);
        st.write = (st.write + count) & MASK;
        m[7] = B.boost;
        st.a2[1] = Math.exp(-3 / Math.max(parameter(v, n, 'attack') * rate, B.boostPeriods * rate / hz));
      }
      const mouth = 0.3 * c[4] * clamp(read(v, n, 'breath'), 0, 1);
      const atBell = lineRead(line, st.write, c[0]);
      // Wave steepening: a delay shortened by the pressure, outside the loop.
      const w = st.p1;
      steep[w] = atBell;
      st.p1 = (w + 1) & MASK;
      const period = c[0] * 0.5, d0 = Math.min(MODULAR_LINE_SAMPLES * 0.4, period * 0.5 + 2);
      const shaped = lineRead(steep, st.p1, clamp(d0 - B.steep * atBell * period, 1, 2 * d0));
      m[5] = (1 - c[6]) * atBell + c[6] * m[5];
      const bore = 0.85 * m[5];
      const y = mouth - bore - c[1] * m[0] - c[2] * m[1];
      m[1] = m[0]; m[0] = y;
      m[7] *= st.a2[1];
      const u = c[3] * (1 + m[7]) * y, open = 1 - Math.exp(-u * u);
      const x = open * mouth + (1 - open) * bore;
      const d = x - m[2] + c[5] * m[3];
      m[2] = x; m[3] = d;
      line[st.write] = clamp(d, -4, 4);
      st.write = (st.write + 1) & MASK;
      const radiated = (shaped - m[6]) * c[7];
      m[6] = shaped;
      m[4] = (1 - st.a2[0]) * radiated + st.a2[0] * m[4];
      st.amp = Math.max(Math.abs(m[4]), st.amp * 0.9995);
      st.mode = mouth > 1e-6 || st.amp > 1e-4 ? 1 : 0;
      sig.out = clamp(m[4] * B.gain, -16, 16) * parameter(v, n, 'level');
      break;
    }
    case 'physWind': {
      // The Physical instrument's Wind model. **breath** is the breath envelope from 0 to 1.
      const line = v.lines[n.line], line2 = v.lines[n.line + 1], W = MODULAR_WIND, rate = s.sampleRate;
      const kind = parameter(v, n, 'type'), embouchure = parameter(v, n, 'embouchure');
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12), rate / (MODULAR_LINE_SAMPLES - 4), rate * 0.45);
      const musette = parameter(v, n, 'musette');
      if (st.key[0] !== hz || st.key[1] !== kind || st.key[2] !== embouchure || st.key[3] !== musette) {
        st.key[0] = hz; st.key[1] = kind; st.key[2] = embouchure; st.key[3] = musette;
        tuneWind(st, kind, hz, embouchure, musette, rate);
      }
      const m = st.y1, c = st.a1, bias = 0.25 + 0.3 * embouchure;
      if (!st.ready) {
        // Fresh note: the musette reeds start out of phase, and the free reed's radiation starts
        // at its rest flow so it does not click.
        st.ready = true;
        st.y2[1] = 0.33; st.y2[2] = 0.67;
        m[4] = kind === 4 ? freeReedFlow(0, bias) * (musette > 0 ? 1.8 : 1) : 0;
        const g = Math.tan(Math.PI * 1600 / rate);
        st.b[0] = 1 / (1 + g * (g + 1.2)); st.b[1] = g * st.b[0]; st.b[2] = g * st.b[1];
      }
      const env = clamp(read(v, n, 'breath'), 0, 1), noiseAmount = parameter(v, n, 'noise');
      // Breath pressure into the reed or jet (Physical's wind_maxv).
      const pressure = parameter(v, n, 'pressure'), slope = -(0.2 + 0.25 * embouchure);
      const maxv = kind === 4 ? 0.3 + 0.7 * pressure : kind >= 2 ? (0.24 + 0.05 * pressure) / -slope
        : kind === 0 ? (0.2 + 0.06 * pressure) / -slope : (0.6 + 0.4 * pressure) * c[5];
      const nz = white(st);
      m[0] += (1 - Math.exp(-TAU * 5 / rate)) * (nz - m[0]);
      let bp = env * maxv * (1 + 1.4 * m[0]);
      m[1] += (1 - Math.exp(-TAU * 1000 / rate)) * (nz - m[1]);
      const hiss = (nz - m[1]) * env * noiseAmount * 0.05;
      let y;
      if (kind === 4) {
        bp += bp * noiseAmount * 0.25 * m[0];
        const ph = st.y2;
        ph[0] += c[0]; if (ph[0] >= 1) ph[0] -= 1;
        let u = freeReedFlow(bp * Math.sin(TAU * ph[0]), bias);
        if (musette > 0) {
          ph[1] += c[0] * c[1]; if (ph[1] >= 1) ph[1] -= 1;
          ph[2] += c[0] / c[1]; if (ph[2] >= 1) ph[2] -= 1;
          u = 0.6 * (u + freeReedFlow(bp * Math.sin(TAU * ph[1]), bias) + freeReedFlow(bp * Math.sin(TAU * ph[2]), bias));
        }
        const rad = (u - m[4]) * c[3];
        m[4] = u;
        // Body resonance: the band-pass of a 1600 Hz state-variable filter.
        const v3 = rad - m[7], v1 = st.b[0] * m[6] + st.b[1] * v3, v2 = m[7] + st.b[1] * m[6] + st.b[2] * v3;
        m[6] = 2 * v1 - m[6]; m[7] = 2 * v2 - m[7];
        y = (0.7 * rad + 0.5 * v1) * W.freeReedGain + hiss;
      } else if (kind >= 2) {
        bp += bp * noiseAmount * 0.25 * nz;
        const bell = lineRead(line, st.write, c[0]);
        m[2] = (1 - c[2]) * bell + c[2] * m[2];
        const t = -0.95 * m[2];
        const pd = bp - (t - lineRead(line2, st.write, c[1]));
        const reed = clamp(0.7 - slope * pd, -1, 1);
        line2[st.write] = clamp(t, -4, 4);
        line[st.write] = clamp(bp - pd * reed - t, -4, 4);
        let rad = (t - m[4]) * c[3];
        m[4] = t;
        if (kind === 3) {
          // The narrow cone's second difference above ~1 kHz: the nasal double-reed formant.
          const r2 = (rad - m[5]) / (2 * Math.sin(Math.PI * 1000 / rate));
          m[5] = rad;
          rad = 0.4 * rad + 0.6 * r2;
        }
        y = rad * W.coneGain[kind] + hiss;
      } else if (kind === 0) {
        bp += bp * noiseAmount * 0.25 * nz;
        const bore = lineRead(line, st.write, c[0]);
        m[2] = (1 - c[2]) * bore + c[2] * m[2];
        const pd = -0.95 * m[2] - bp;
        const reed = clamp(0.7 + slope * pd, -1, 1);
        line[st.write] = clamp(bp + pd * reed, -4, 4);
        y = bore * 1.1 + hiss;
      } else {
        const bore = lineRead(line, st.write, c[0]);
        m[2] = (1 - c[2]) * bore + c[2] * m[2];
        // Open end: the reflection with its DC removed (20 Hz one-pole high-pass).
        m[3] += (1 - Math.exp(-TAU * 20 / rate)) * (m[2] - m[3]);
        const t = m[2] - m[3];
        const jet = lineRead(line2, st.write, c[1]);
        line2[st.write] = clamp(t + (0.01 + 0.08 * noiseAmount) * env * nz, -4, 4);
        const j = softClip(W.jetGain * jet + c[4]) - softClip(c[4]);
        line[st.write] = clamp(bp * j + 0.5 * t, -4, 4);
        y = bore * 0.3 + hiss;
      }
      st.write = (st.write + 1) & MASK;
      st.amp = Math.max(Math.abs(y), st.amp * 0.9995);
      st.mode = env > 1e-5 || st.amp > 1e-4 ? 1 : 0;
      sig.out = clamp(y, -16, 16) * parameter(v, n, 'level');
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
    case 'reedPipe': {
      const line = v.lines[n.line];
      const gate = read(v, n, 'gate', Number(v.held)) >= 0.5;
      const breath = clamp(read(v, n, 'breath', 1), 0, 1) * parameter(v, n, 'pressure');
      st.env += ((gate ? breath : 0) - st.env) * lag(gate ? parameter(v, n, 'attack') : 0.018, s.sampleRate);
      const hz = clamp(440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12),
        s.sampleRate / (2 * (MODULAR_LINE_SAMPLES - 2)), s.sampleRate * 0.2);
      const brightness = parameter(v, n, 'brightness');
      if (st.key[0] !== hz || st.key[1] !== brightness) {
        // An inverting bell reflection makes the bore half a period long.
        st.key[0] = hz; st.key[1] = brightness;
        const w = TAU * hz / s.sampleRate;
        const damping = Math.exp(-TAU * Math.max(1100 + 1800 * brightness, 5 * hz) / s.sampleRate);
        const phaseDelay = Math.atan2(damping * Math.sin(w), 1 - damping * Math.cos(w)) / w;
        st.a1[0] = damping;
        st.a2[0] = Math.max(1, s.sampleRate * 0.5 / hz - phaseDelay);
      }
      const bore = lineRead(line, st.write, st.a2[0]);
      st.prev += (bore - st.prev) * (1 - st.a1[0]);
      const stiffness = 0.2 + 0.25 * parameter(v, n, 'embouchure');
      const noise = white(st), air = parameter(v, n, 'noise');
      const pressure = st.env * (0.52 + 0.16 * st.env) / stiffness * (1 + 0.07 * air * noise);
      const delta = -0.95 * st.prev - pressure;
      // Pressure closes the reed; the bounded opening feeds the returning wave.
      const opening = clamp(0.7 - stiffness * delta, -1, 1);
      line[st.write] = clamp(pressure + delta * opening, -2, 2);
      st.write = (st.write + 1) & MASK;
      st.ic1 += (bore - st.ic1) * lag(1 / (TAU * 22), s.sampleRate);
      st.ic2 += (noise - st.ic2) * lag(1 / (TAU * 1400), s.sampleRate);
      const ringing = bore - st.ic1;
      st.amp = Math.max(Math.abs(ringing), st.amp * 0.9995);
      st.lastGate = gate;
      st.mode = st.env > 1e-5 || st.amp > 1e-4 ? 1 : 0;
      sig.out = (ringing + (noise - st.ic2) * st.env * air * 0.07) * parameter(v, n, 'level');
      break;
    }
    case 'modal': {
      const gate = read(v, n, 'gate', 1) >= 0.5;
      const hit = gate && !st.lastGate;
      st.lastGate = gate;
      const material = n.modalTable ? -1 : parameter(v, n, 'material');
      const decay = parameter(v, n, 'decay');
      const t60 = gate ? decay : Math.min(decay, parameter(v, n, 'release'));
      const brightness = parameter(v, n, 'brightness');
      const hz = 440 * Math.pow(2, (read(v, n, 'pitch', 69) - 69) / 12);
      const strikePosition = parameter(v, n, 'strikePosition');
      const key = st.key;
      if (key[0] !== hz || key[1] !== material || key[2] !== t60 || key[3] !== brightness || key[4] !== strikePosition) {
        key[0] = hz; key[1] = material; key[2] = t60; key[3] = brightness;
        key[4] = strikePosition;
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
          const strikeGain = strikePosition === 0 ? 1 : 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * (k + 1) * strikePosition));
          st.a1[k] = 2 * r * Math.cos(w); st.a2[k] = r * r; st.b[k] = strikeGain * (mode?.gain ?? mat.gains[k]) * Math.sin(w);
        }
      }
      if (hit) {
        const hardness = parameter(v, n, 'hardness');
        st.value = clamp(read(v, n, 'velocity', 1), 0, 1);
        st.write = 0;
        const contact = 0.6 - 0.56 * hardness * (0.7 + 0.3 * st.value);
        st.p0 = hardness >= 1 ? 1 : clamp(Math.round(s.sampleRate * contact / Math.max(1, hz)), 2, 4096);
      }
      let strike = 0;
      if (st.write < st.p0) {
        strike = st.p0 === 1 ? st.value : st.value * (1 - Math.cos(TAU * st.write / st.p0)) / st.p0;
        st.write++;
      }
      const x = read(v, n, 'in') + strike;
      let sum = 0;
      for (let k = 0; k < MODULAR_MODES; k++) {
        const y = st.b[k] * x + st.a1[k] * st.y1[k] - st.a2[k] * st.y2[k];
        st.y2[k] = st.y1[k]; st.y1[k] = y; sum += y;
      }
      st.amp = Math.max(Math.abs(sum), st.amp * 0.9995);
      st.mode = st.write < st.p0 || st.amp > 1e-4 ? 1 : 0;
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
  const { nodes, order, delays, outputs, envelopes, mono, clocks, autonomous, globals, busLinks } = s.graph;
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
    let sample = 0, sampleRight = 0, gain = 1;
    for (const i of outputs) {
      sample += v.signals[i].out;
      sampleRight += v.signals[i].right;
    }
    if (!v.held) {
      v.tail++;
      const fade = Math.max(1, Math.round(RELEASE_FADE * s.sampleRate));
      if (envelopes.length === 0 || v.tail > MAX_RELEASE * s.sampleRate) {
        const elapsed = envelopes.length ? v.tail - MAX_RELEASE * s.sampleRate : v.tail;
        gain = clamp(1 - elapsed / fade, 0, 1);
        sample *= gain;
        sampleRight *= gain;
        if (elapsed >= fade) v.active = false;
      } else if (envelopes.every(i => v.stages[i].mode === 0 && !v.stages[i].lastGate)) {
        v.active = false;
      }
    }
    for (const { g, input, index, port } of busLinks) s.bus[g][input] += v.signals[index][port] * gain;
    out += sample;
    right += sampleRight;
  }
  if (globals.length) {
    const [fxLeft, fxRight] = sampleGlobals(s);
    out += fxLeft;
    right += fxRight;
    for (const { g, input } of busLinks) s.bus[g][input] = 0;
  }
  if (s.host.playing) s.host.beat += s.host.bpm / (60 * s.sampleRate);
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
  if (s.meter?.scope) captureScope(s, s.meter.scope, meterVoice);
  s.out_l = Math.tanh(out);
  s.out_r = Math.tanh(right);
}
