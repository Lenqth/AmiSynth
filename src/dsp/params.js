// Single source of truth for every parameter of AmiSynth (synth + drums).
//
// Each entry maps 1:1 to a JSFX slider declaration:
//   sliderN:<id>=<default><<min>,<max>,<step>[:log]{options}>-<name> [unit]
// (see scripts/gen-jsfx-sliders.js). Keep ids snake_case and self-describing so
// that REAPER automation lanes / MCP tools / LLMs can understand them without docs.
//
// Fields:
//   id          variable name (JSFX slider variable, worklet param key)
//   name        human readable label (JSFX slider label)
//   group       UI grouping only
//   min, max    range
//   default     default value
//   step        slider step (1 for integers / enums)
//   unit        unit string ('' if none)
//   scale       'log' for exponential knobs (JSFX ':log')
//   options     enum labels (value = index)
//   description one-line explanation (for docs / LLM tools)

/** @typedef {{id:string,name:string,group:string,min:number,max:number,default:number,step:number,unit:string,scale?:'log',options?:string[],description:string}} ParamDef */

const WAVES = ['Saw', 'Square', 'Triangle'];

/** Tuning is shared by synth & piano roll. 12-EDO is just the default. */
export const TUNING_PARAMS = /** @type {ParamDef[]} */ ([
  { id: 'tuning_divisions', name: 'Tuning Divisions Per Period', group: 'Tuning', min: 1, max: 72, default: 12, step: 1, unit: 'steps',
    description: 'Equal divisions of the period (12 = standard 12-TET, 19/22/31/53 etc. for microtonal EDOs). Ignored while a custom scale table is loaded.' },
  { id: 'tuning_period_cents', name: 'Tuning Period', group: 'Tuning', min: 100, max: 2400, default: 1200, step: 0.001, unit: 'cents',
    description: 'Size of the repeating period. 1200 = octave, 1901.955 = tritave (Bohlen-Pierce).' },
  { id: 'tuning_ref_note', name: 'Tuning Reference Note', group: 'Tuning', min: 0, max: 127, default: 69, step: 1, unit: 'note',
    description: 'MIDI note number that sounds at the reference frequency.' },
  { id: 'tuning_ref_hz', name: 'Tuning Reference Frequency', group: 'Tuning', min: 100, max: 1000, default: 440, step: 0.01, unit: 'Hz',
    description: 'Frequency of the reference note.' },
]);

export const SYNTH_PARAMS = /** @type {ParamDef[]} */ ([
  ...TUNING_PARAMS,

  { id: 'osc1_waveform', name: 'Osc1 Waveform', group: 'Oscillators', min: 0, max: 2, default: 0, step: 1, unit: '', options: WAVES,
    description: 'Waveform of oscillator 1.' },
  { id: 'osc1_level', name: 'Osc1 Level', group: 'Oscillators', min: 0, max: 1, default: 0.8, step: 0.001, unit: '',
    description: 'Mix level of oscillator 1.' },
  { id: 'osc2_waveform', name: 'Osc2 Waveform', group: 'Oscillators', min: 0, max: 2, default: 1, step: 1, unit: '', options: WAVES,
    description: 'Waveform of oscillator 2.' },
  { id: 'osc2_level', name: 'Osc2 Level', group: 'Oscillators', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Mix level of oscillator 2.' },
  { id: 'osc2_transpose_cents', name: 'Osc2 Transpose', group: 'Oscillators', min: -2400, max: 2400, default: 0, step: 1, unit: 'cents',
    description: 'Coarse pitch offset of oscillator 2 in cents (tuning independent; 1200 = one octave up).' },
  { id: 'osc2_detune_cents', name: 'Osc2 Detune', group: 'Oscillators', min: -100, max: 100, default: 7, step: 0.1, unit: 'cents',
    description: 'Fine detune of oscillator 2 against oscillator 1.' },
  { id: 'noise_level', name: 'Noise Level', group: 'Oscillators', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'White noise mixed into the filter input.' },

  { id: 'filter_cutoff_hz', name: 'Filter Cutoff', group: 'Filter', min: 20, max: 20000, default: 1800, step: 1, unit: 'Hz', scale: 'log',
    description: 'Base cutoff frequency of the resonant low-pass filter.' },
  { id: 'filter_resonance', name: 'Filter Resonance', group: 'Filter', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'Filter resonance (approaches self-oscillation near 1).' },
  { id: 'filter_slope', name: 'Filter Slope', group: 'Filter', min: 0, max: 1, default: 1, step: 1, unit: '', options: ['12 dB/oct', '24 dB/oct'],
    description: 'Low-pass slope: 2-pole or 4-pole.' },
  { id: 'filter_env_amount_oct', name: 'Filter Env Amount', group: 'Filter', min: -8, max: 8, default: 3, step: 0.01, unit: 'oct',
    description: 'How far the filter envelope moves the cutoff, in octaves.' },
  { id: 'filter_key_tracking', name: 'Filter Key Tracking', group: 'Filter', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Cutoff follows note frequency (1 = fully).' },
  { id: 'filter_velocity_amount', name: 'Filter Velocity Amount', group: 'Filter', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'How much note velocity scales the filter envelope.' },

  { id: 'filter_env_attack_ms', name: 'Filter Env Attack', group: 'Filter Envelope', min: 0.5, max: 5000, default: 5, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Filter envelope attack time.' },
  { id: 'filter_env_decay_ms', name: 'Filter Env Decay', group: 'Filter Envelope', min: 1, max: 10000, default: 300, step: 1, unit: 'ms', scale: 'log',
    description: 'Filter envelope decay time.' },
  { id: 'filter_env_sustain', name: 'Filter Env Sustain', group: 'Filter Envelope', min: 0, max: 1, default: 0.2, step: 0.001, unit: '',
    description: 'Filter envelope sustain level.' },
  { id: 'filter_env_release_ms', name: 'Filter Env Release', group: 'Filter Envelope', min: 1, max: 10000, default: 300, step: 1, unit: 'ms', scale: 'log',
    description: 'Filter envelope release time.' },

  { id: 'amp_attack_ms', name: 'Amp Attack', group: 'Amp Envelope', min: 0.5, max: 5000, default: 3, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Amplitude envelope attack time.' },
  { id: 'amp_decay_ms', name: 'Amp Decay', group: 'Amp Envelope', min: 1, max: 10000, default: 400, step: 1, unit: 'ms', scale: 'log',
    description: 'Amplitude envelope decay time.' },
  { id: 'amp_sustain', name: 'Amp Sustain', group: 'Amp Envelope', min: 0, max: 1, default: 0.7, step: 0.001, unit: '',
    description: 'Amplitude envelope sustain level.' },
  { id: 'amp_release_ms', name: 'Amp Release', group: 'Amp Envelope', min: 1, max: 10000, default: 250, step: 1, unit: 'ms', scale: 'log',
    description: 'Amplitude envelope release time.' },
  { id: 'amp_velocity_amount', name: 'Amp Velocity Amount', group: 'Amp Envelope', min: 0, max: 1, default: 0.7, step: 0.001, unit: '',
    description: 'How much note velocity scales loudness (0 = ignore velocity).' },

  { id: 'lfo_rate_hz', name: 'LFO Rate', group: 'Modulation', min: 0.05, max: 20, default: 5, step: 0.01, unit: 'Hz', scale: 'log',
    description: 'Rate of the global LFO driven by the mod wheel.' },
  { id: 'modwheel_vibrato_cents', name: 'Mod Wheel Vibrato Depth', group: 'Modulation', min: 0, max: 200, default: 30, step: 0.1, unit: 'cents',
    description: 'Vibrato depth at full mod wheel.' },
  { id: 'modwheel_filter_oct', name: 'Mod Wheel Filter LFO Depth', group: 'Modulation', min: 0, max: 4, default: 0, step: 0.01, unit: 'oct',
    description: 'Filter cutoff wobble depth at full mod wheel.' },
  { id: 'pitch_bend_range_cents', name: 'Pitch Bend Range', group: 'Modulation', min: 0, max: 2400, default: 200, step: 1, unit: 'cents',
    description: 'Pitch bend range in cents (tuning independent; 200 = +/-2 semitones).' },

  { id: 'voice_count', name: 'Max Voices', group: 'Master', min: 1, max: 8, default: 8, step: 1, unit: 'voices',
    description: 'Maximum polyphony (1 = mono).' },
  { id: 'master_volume_db', name: 'Master Volume', group: 'Master', min: -60, max: 6, default: -6, step: 0.1, unit: 'dB',
    description: 'Output volume of the synth.' },
]);

// ---------------------------------------------------------------------------
// Drums

/** MIDI note assignment (GM compatible). */
export const DRUM_PARTS = [
  { key: 'kick', name: 'Kick', note: 36 },
  { key: 'snare', name: 'Snare', note: 38 },
  { key: 'clap', name: 'Clap', note: 39 },
  { key: 'closed_hat', name: 'Closed Hi-Hat', note: 42 },
  { key: 'open_hat', name: 'Open Hi-Hat', note: 46 },
];

/** Common per-part parameters: pitch, decay, tone, level, pan. */
function partParams(key, label, p) {
  return /** @type {ParamDef[]} */ ([
    { id: `${key}_pitch_hz`, name: `${label} Pitch`, group: label, min: p.pitch[0], max: p.pitch[1], default: p.pitch[2], step: 0.1, unit: 'Hz', scale: 'log',
      description: p.pitchDesc },
    { id: `${key}_decay_ms`, name: `${label} Decay`, group: label, min: p.decay[0], max: p.decay[1], default: p.decay[2], step: 1, unit: 'ms', scale: 'log',
      description: p.decayDesc },
    { id: `${key}_tone`, name: `${label} Tone`, group: label, min: 0, max: 1, default: p.tone, step: 0.001, unit: '',
      description: p.toneDesc },
    { id: `${key}_level_db`, name: `${label} Level`, group: label, min: -60, max: 6, default: p.level, step: 0.1, unit: 'dB',
      description: `Output level of the ${label.toLowerCase()}.` },
    { id: `${key}_pan`, name: `${label} Pan`, group: label, min: -1, max: 1, default: p.pan, step: 0.01, unit: '',
      description: `Stereo position of the ${label.toLowerCase()} (-1 = left, +1 = right).` },
  ]);
}

export const DRUM_PARAMS = /** @type {ParamDef[]} */ ([
  ...partParams('kick', 'Kick', {
    pitch: [25, 200, 50], decay: [30, 2000, 450], tone: 0.3, level: 0, pan: 0,
    pitchDesc: 'Final (resting) frequency of the kick sine.',
    decayDesc: 'Amplitude decay time of the kick (to -60 dB).',
    toneDesc: 'Click transient and saturation amount.',
  }),
  { id: 'kick_sweep_oct', name: 'Kick Pitch Sweep Depth', group: 'Kick', min: 0, max: 6, default: 2.5, step: 0.01, unit: 'oct',
    description: 'How many octaves above the resting pitch the kick starts.' },
  { id: 'kick_sweep_ms', name: 'Kick Pitch Sweep Time', group: 'Kick', min: 2, max: 300, default: 35, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Time constant of the downward pitch sweep.' },

  ...partParams('snare', 'Snare', {
    pitch: [80, 600, 190], decay: [30, 1500, 220], tone: 0.5, level: -1, pan: 0,
    pitchDesc: 'Frequency of the tonal (drum shell) component.',
    decayDesc: 'Decay time of the noise (snares) component.',
    toneDesc: 'Brightness of the band-passed noise (low = dark, high = bright).',
  }),
  { id: 'snare_snappy', name: 'Snare Snappy', group: 'Snare', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Balance between tonal body (0) and noise (1).' },

  ...partParams('clap', 'Clap', {
    pitch: [400, 5000, 1200], decay: [30, 2000, 280], tone: 0.4, level: -2, pan: 0.1,
    pitchDesc: 'Center frequency of the band-pass filter on the noise.',
    decayDesc: 'Decay time of the reverberant tail after the bursts.',
    toneDesc: 'Filter sharpness (low = wide/noisy, high = narrow/ringing).',
  }),
  { id: 'clap_spread_ms', name: 'Clap Burst Spread', group: 'Clap', min: 2, max: 40, default: 11, step: 0.1, unit: 'ms',
    description: 'Gap between the individual hand-clap bursts.' },

  ...partParams('closed_hat', 'Closed Hi-Hat', {
    pitch: [100, 1000, 330], decay: [10, 500, 60], tone: 0.55, level: -4, pan: -0.25,
    pitchDesc: 'Base frequency of the metallic square-wave cluster.',
    decayDesc: 'Decay time of the closed hi-hat.',
    toneDesc: 'High-pass cutoff (brightness).',
  }),
  { id: 'closed_hat_metal_mix', name: 'Closed Hi-Hat Metal Mix', group: 'Closed Hi-Hat', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Balance between noise (0) and detuned square cluster (1).' },

  ...partParams('open_hat', 'Open Hi-Hat', {
    pitch: [100, 1000, 330], decay: [50, 3000, 550], tone: 0.5, level: -6, pan: -0.25,
    pitchDesc: 'Base frequency of the metallic square-wave cluster.',
    decayDesc: 'Decay time of the open hi-hat (closed hi-hat chokes it).',
    toneDesc: 'High-pass cutoff (brightness).',
  }),
  { id: 'open_hat_metal_mix', name: 'Open Hi-Hat Metal Mix', group: 'Open Hi-Hat', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Balance between noise (0) and detuned square cluster (1).' },

  { id: 'drum_master_volume_db', name: 'Drum Master Volume', group: 'Master', min: -60, max: 6, default: -4, step: 0.1, unit: 'dB',
    description: 'Output volume of the drum machine.' },
]);

/** @param {ParamDef[]} defs */
export function defaultValues(defs) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const d of defs) out[d.id] = d.default;
  return out;
}

/** Clamp + quantize a value to a param's range/step. */
export function clampParam(def, v) {
  v = Math.min(def.max, Math.max(def.min, v));
  if (def.step >= 1) v = Math.round(v);
  return v;
}
