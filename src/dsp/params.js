// Single source of truth for every parameter of AmiSynth (synth + drums).
//
// Each entry maps 1:1 to a JSFX slider declaration:
//   sliderN:<id>=<default><<min>,<max>,<step>{options}>-<name> [unit]
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
//   scale       'log' for exponential knobs in the web UI. The JSFX slider stays linear on purpose so
//               that REAPER automation / MCP take the real value (1800 for 1800 Hz, not ln(1800)).
//   options     enum labels (value = index)
//   description one-line explanation (for docs / LLM tools)

import { WT_BANK_NAMES } from './wavetable.js';

/** @typedef {{id:string,name:string,group:string,min:number,max:number,default:number,step:number,unit:string,scale?:'log',options?:string[],description:string}} ParamDef */

// 'Wavetable' was appended later, so saved values 0..3 keep their meaning.
const WAVES = ['Saw', 'Pulse', 'Triangle', 'Sine', 'Wavetable'];
/** Wavetable banks (value = index; the tables are generated in src/dsp/wavetable.js). */
const WT_BANKS = WT_BANK_NAMES;
const LFO_WAVES = ['Sine', 'Triangle', 'Saw Down', 'Square', 'Sample & Hold', 'Duck (pump)'];

/** Note values for the tempo-synced LFO, in beats (quarter notes). Index 0 = free running. */
export const LFO_SYNC_BEATS = [0, 16, 8, 4, 2, 3, 4 / 3, 1, 1.5, 2 / 3, 0.5, 0.75, 1 / 3, 0.25, 0.375, 1 / 6, 0.125];
const LFO_SYNC_NAMES = ['Off', '4 bars', '2 bars', '1/1', '1/2', '1/2 dotted', '1/2 triplet', '1/4', '1/4 dotted', '1/4 triplet',
  '1/8', '1/8 dotted', '1/8 triplet', '1/16', '1/16 dotted', '1/16 triplet', '1/32'];

/**
 * Note values for the tempo-synced delay, in beats (same style as LFO_SYNC_BEATS, without the bar
 * lengths). Index 0 = not synced (Delay Time in ms).
 */
export const DELAY_SYNC_BEATS = [0, 4, 2, 3, 4 / 3, 1, 1.5, 2 / 3, 0.5, 0.75, 1 / 3, 0.25, 0.375, 1 / 6, 0.125];
const DELAY_SYNC_NAMES = ['Off', '1/1', '1/2', '1/2 dotted', '1/2 triplet', '1/4', '1/4 dotted', '1/4 triplet',
  '1/8', '1/8 dotted', '1/8 triplet', '1/16', '1/16 dotted', '1/16 triplet', '1/32'];
/** Longest echo (seconds of delay memory); synced times beyond it (1/1 below 60 bpm) are capped. */
export const DELAY_MAX_SECONDS = 4;

/** Arpeggiator step lengths in beats. */
export const ARP_RATE_BEATS = [1, 0.5, 1 / 3, 0.75, 0.25, 1 / 6, 0.125];
const ARP_RATE_NAMES = ['1/4', '1/8', '1/8 triplet', '1/8 dotted', '1/16', '1/16 triplet', '1/32'];

/** Number of mod matrix slots of the synth (mod1_* .. mod4_*). */
export const MOD_SLOTS = 4;

/**
 * Mod matrix sources (value = index). Ranges: LFO 1 / LFO 2 / Random -1..1; Mod Env, Velocity,
 * Mod Wheel, Pressure 0..1; Key Track = octaves from middle C (261.63 Hz, any tuning).
 */
export const MOD_SOURCES = ['Off', 'LFO 1', 'LFO 2', 'Mod Env', 'Velocity', 'Key Track', 'Mod Wheel', 'Pressure', 'Random (per note)'];

/**
 * Mod matrix destinations (value = index) and the unit of the slot amount for each: the amount is
 * what the destination moves by at source value 1. `range` / `step` only size the web UI knob
 * (the JSFX slider takes the whole -4800..4800 range). LFO 1 / LFO 2 Rate are global: they follow
 * only LFO 1, LFO 2, Mod Wheel and channel pressure (per-note sources are ignored there).
 */
export const MOD_DESTINATIONS = [
  { name: 'Off', unit: '', range: 1, step: 0.001 },
  { name: 'Pitch', unit: 'cents', range: 2400, step: 0.1 },
  { name: 'Filter Cutoff', unit: 'oct', range: 8, step: 0.01 },
  { name: 'Filter Resonance', unit: '', range: 1, step: 0.001 },
  { name: 'Pulse Width', unit: '', range: 0.45, step: 0.001 },
  { name: 'Osc2 Pitch', unit: 'cents', range: 4800, step: 1 },
  { name: 'FM Index', unit: 'rad', range: 10, step: 0.01 },
  { name: 'Amp', unit: 'dB', range: 48, step: 0.1 },
  { name: 'Pan', unit: '', range: 1, step: 0.001 },
  { name: 'LFO 1 Rate', unit: 'oct', range: 6, step: 0.01 },
  { name: 'LFO 2 Rate', unit: 'oct', range: 6, step: 0.01 },
  { name: 'Noise Level', unit: '', range: 1, step: 0.001 },
];

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

/** Number of shared scale slots (one "AmiSynth Tuning" JSFX per slot). */
export const TUNING_SLOTS = 8;
/** Notes per period an AmiSynth Tuning instance can hold in its sliders (files can hold more). */
export const TUNING_MAX_DEGREES = 32;

/**
 * JSFX only: where the scale comes from, so every track of a microtonal song can follow one
 * definition. The web app loads scales in its Tuning panel instead.
 */
const TUNING_SOURCE = /** @type {ParamDef} */ ({
  id: 'tuning_source', name: 'Tuning Source', group: 'Tuning', min: 0, max: 2, default: 0, step: 1, unit: '',
  options: ['EDO sliders', 'Scale file (Data/AmiSynth/tuning.txt)', 'Shared (AmiSynth Tuning)'],
  description: 'EDO sliders: Tuning Divisions / Period. Scale file: a Scala (.scl) scale saved as REAPER/Data/AmiSynth/tuning.txt (re-read on playback start or any slider change). Shared: the scale (and reference note / frequency) published by an "AmiSynth Tuning" JSFX on any track for the slot in Tuning Slot; changes there apply at once. Falls back to the EDO sliders when the file / slot is empty.',
});
const TUNING_SLOT = /** @type {ParamDef} */ ({
  id: 'tuning_slot', name: 'Tuning Slot', group: 'Tuning', min: 1, max: TUNING_SLOTS, default: 1, step: 1, unit: '',
  description: 'Which AmiSynth Tuning instance to follow when Tuning Source is Shared (its Slot number), so one song can use several scales.',
});

export const SYNTH_PARAMS = /** @type {ParamDef[]} */ ([
  ...TUNING_PARAMS,

  { id: 'osc1_waveform', name: 'Osc1 Waveform', group: 'Oscillators', min: 0, max: 4, default: 0, step: 1, unit: '', options: WAVES,
    description: 'Waveform of oscillator 1. Wavetable plays the bank chosen in Osc1 Wavetable at Osc1 WT Position.' },
  { id: 'osc1_pulse_width', name: 'Osc1 Pulse Width', group: 'Oscillators', min: 0.05, max: 0.95, default: 0.5, step: 0.001, unit: '',
    description: 'Duty cycle of oscillator 1 when its waveform is Pulse (0.5 = square).' },
  { id: 'osc1_level', name: 'Osc1 Level', group: 'Oscillators', min: 0, max: 1, default: 0.8, step: 0.001, unit: '',
    description: 'Mix level of oscillator 1.' },
  { id: 'osc2_waveform', name: 'Osc2 Waveform', group: 'Oscillators', min: 0, max: 4, default: 1, step: 1, unit: '', options: WAVES,
    description: 'Waveform of oscillator 2. Wavetable plays the bank chosen in Osc2 Wavetable at Osc2 WT Position.' },
  { id: 'osc2_pulse_width', name: 'Osc2 Pulse Width', group: 'Oscillators', min: 0.05, max: 0.95, default: 0.5, step: 0.001, unit: '',
    description: 'Duty cycle of oscillator 2 when its waveform is Pulse (0.5 = square).' },
  { id: 'osc2_level', name: 'Osc2 Level', group: 'Oscillators', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Mix level of oscillator 2.' },
  { id: 'osc2_transpose_cents', name: 'Osc2 Transpose', group: 'Oscillators', min: -2400, max: 2400, default: 0, step: 1, unit: 'cents',
    description: 'Coarse pitch offset of oscillator 2 in cents (tuning independent; 1200 = one octave up).' },
  { id: 'osc2_detune_cents', name: 'Osc2 Detune', group: 'Oscillators', min: -100, max: 100, default: 7, step: 0.1, unit: 'cents',
    description: 'Fine detune of oscillator 2 against oscillator 1.' },
  { id: 'sub_osc_level', name: 'Sub Osc Level', group: 'Oscillators', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Square wave one octave below oscillator 1.' },
  { id: 'noise_level', name: 'Noise Level', group: 'Oscillators', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'White noise mixed into the filter input.' },

  { id: 'osc2_hard_sync', name: 'Osc2 Hard Sync', group: 'Osc Modulation', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Off', 'On'],
    description: 'Restart oscillator 2 every cycle of oscillator 1 (classic sync lead; sweep Osc2 Transpose or Osc2 Env Pitch).' },
  { id: 'osc2_env_pitch_cents', name: 'Osc2 Env Pitch', group: 'Osc Modulation', min: -4800, max: 4800, default: 0, step: 1, unit: 'cents',
    description: 'How far the filter envelope bends oscillator 2 pitch (sync sweeps, FM brightness changes).' },
  { id: 'fm_index', name: 'FM Index', group: 'Osc Modulation', min: 0, max: 10, default: 0, step: 0.01, unit: 'rad',
    description: 'Phase modulation of oscillator 1 by oscillator 2 (0 = off; use Sine waves for bells/e-pianos).' },

  { id: 'filter_mode', name: 'Filter Mode', group: 'Filter', min: 0, max: 3, default: 0, step: 1, unit: '', options: ['Low-pass', 'High-pass', 'Band-pass', 'Notch'],
    description: 'Filter response type.' },
  { id: 'filter_cutoff_hz', name: 'Filter Cutoff', group: 'Filter', min: 20, max: 20000, default: 1800, step: 1, unit: 'Hz', scale: 'log',
    description: 'Base cutoff frequency of the resonant filter.' },
  { id: 'filter_resonance', name: 'Filter Resonance', group: 'Filter', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'Filter resonance (approaches self-oscillation near 1).' },
  { id: 'filter_slope', name: 'Filter Slope', group: 'Filter', min: 0, max: 1, default: 1, step: 1, unit: '', options: ['12 dB/oct', '24 dB/oct'],
    description: 'Filter slope: 2-pole or 4-pole.' },
  { id: 'filter_drive', name: 'Filter Drive', group: 'Filter', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Soft saturation before the filter.' },
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

  { id: 'lfo_waveform', name: 'LFO Waveform', group: 'LFO', min: 0, max: 5, default: 0, step: 1, unit: '', options: LFO_WAVES,
    description: 'Shape of the global LFO. Duck drops at the start of every cycle and recovers (sidechain-style pumping; use it with LFO Tremolo Depth and LFO Sync).' },
  { id: 'lfo_rate_hz', name: 'LFO Rate', group: 'LFO', min: 0.05, max: 20, default: 5, step: 0.01, unit: 'Hz', scale: 'log',
    description: 'Rate of the global LFO (used while LFO Sync is Off).' },
  { id: 'lfo_pitch_cents', name: 'LFO Pitch Depth', group: 'LFO', min: 0, max: 1200, default: 0, step: 0.1, unit: 'cents',
    description: 'Constant vibrato depth (independent of the mod wheel).' },
  { id: 'lfo_filter_oct', name: 'LFO Filter Depth', group: 'LFO', min: 0, max: 4, default: 0, step: 0.01, unit: 'oct',
    description: 'Constant filter cutoff modulation depth.' },
  { id: 'lfo_pulse_width', name: 'LFO Pulse Width Depth', group: 'LFO', min: 0, max: 0.45, default: 0, step: 0.001, unit: '',
    description: 'Pulse width modulation (PWM) depth for Pulse waveforms.' },
  { id: 'lfo_amp', name: 'LFO Tremolo Depth', group: 'LFO', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Amplitude modulation (tremolo) depth.' },

  { id: 'modwheel_vibrato_cents', name: 'Mod Wheel Vibrato Depth', group: 'Mod Wheel / Bend', min: 0, max: 200, default: 30, step: 0.1, unit: 'cents',
    description: 'Extra vibrato depth at full mod wheel.' },
  { id: 'modwheel_filter_oct', name: 'Mod Wheel Filter LFO Depth', group: 'Mod Wheel / Bend', min: 0, max: 4, default: 0, step: 0.01, unit: 'oct',
    description: 'Extra filter cutoff wobble depth at full mod wheel.' },
  { id: 'pitch_bend_range_cents', name: 'Pitch Bend Range', group: 'Mod Wheel / Bend', min: 0, max: 2400, default: 200, step: 1, unit: 'cents',
    description: 'Pitch bend range in cents (tuning independent; 200 = +/-2 semitones).' },

  { id: 'voice_count', name: 'Max Voices', group: 'Voice', min: 1, max: 8, default: 8, step: 1, unit: 'voices',
    description: 'Maximum polyphony (1 = mono).' },
  { id: 'glide_ms', name: 'Glide Time', group: 'Voice', min: 0, max: 1000, default: 0, step: 1, unit: 'ms',
    description: 'Portamento time from the previously played note (0 = off).' },
  { id: 'unison_voices', name: 'Unison Voices', group: 'Voice', min: 1, max: 9, default: 1, step: 1, unit: 'voices',
    description: 'Stacked detuned copies of both oscillators per note (supersaw-style thickness). CPU grows with Max Voices x Unison Voices.' },
  { id: 'unison_detune_cents', name: 'Unison Detune', group: 'Voice', min: 0, max: 100, default: 15, step: 0.1, unit: 'cents',
    description: 'Total detune spread across the unison copies.' },
  { id: 'unison_stereo_width', name: 'Unison Stereo Width', group: 'Voice', min: 0, max: 1, default: 0.7, step: 0.001, unit: '',
    description: 'How far the unison copies are spread left/right.' },

  { id: 'master_volume_db', name: 'Master Volume', group: 'Master', min: -60, max: 6, default: -6, step: 0.1, unit: 'dB',
    description: 'Output volume of the synth.' },

  // ---- added later: kept at the end so existing REAPER projects keep their slider numbers
  { id: 'transpose_semitones', name: 'Transpose', group: 'Voice', min: -24, max: 24, default: 0, step: 1, unit: 'semitones',
    description: 'Shifts incoming notes by this many MIDI note numbers (= semitones in 12-EDO, scale steps in other tunings). Applied at note-on, so automating it never cuts off or hangs sounding notes.' },
  { id: 'voice_mode', name: 'Voice Mode', group: 'Voice', min: 0, max: 2, default: 0, step: 1, unit: '', options: ['Poly', 'Mono', 'Legato'],
    description: 'Poly: chords. Mono: one note at a time (last note wins, returns to a still-held note), envelopes restart on every note. Legato: like Mono, but overlapping notes only change pitch (no envelope restart).' },
  { id: 'glide_mode', name: 'Glide Mode', group: 'Voice', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Always', 'Legato only'],
    description: 'Always: every note glides from the previous one. Legato only: glide only when the new note overlaps a held note.' },
  { id: 'unison_detune_curve', name: 'Unison Detune Curve', group: 'Voice', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Spacing of the unison copies: 0 = even, 1 = bunched near the centre pitch with a few far-out copies (supersaw-like).' },
  { id: 'unison_side_level', name: 'Unison Side Level', group: 'Voice', min: 0, max: 1, default: 1, step: 0.001, unit: '',
    description: 'Level of the outer unison copies relative to the centre one(s) (1 = all equal).' },
  { id: 'lfo_sync', name: 'LFO Sync', group: 'LFO', min: 0, max: LFO_SYNC_BEATS.length - 1, default: 0, step: 1, unit: '', options: LFO_SYNC_NAMES,
    description: 'Lock the LFO to the host tempo: one cycle per note value, phase locked to the beat grid (so it restarts on the beat). Off = free running at LFO Rate.' },

  { id: 'arp_mode', name: 'Arp Mode', group: 'Arpeggiator', min: 0, max: 6, default: 0, step: 1, unit: '',
    options: ['Off', 'Up', 'Down', 'Up-Down', 'Random', 'As Played', 'Chord'],
    description: 'Arpeggiator on the held notes, in time with the host tempo. Chord repeats the whole chord on every step (stabs; shape the rhythm with the Arp Step switches).' },
  { id: 'arp_rate', name: 'Arp Rate', group: 'Arpeggiator', min: 0, max: ARP_RATE_BEATS.length - 1, default: 4, step: 1, unit: '', options: ARP_RATE_NAMES,
    description: 'Length of one arpeggiator step (note value, tempo synced).' },
  { id: 'arp_octaves', name: 'Arp Octave Range', group: 'Arpeggiator', min: 1, max: 4, default: 1, step: 1, unit: 'oct',
    description: 'How many octaves (tuning periods) the arpeggio climbs.' },
  { id: 'arp_gate', name: 'Arp Gate', group: 'Arpeggiator', min: 0.05, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Note length as a fraction of the step (1 = notes touch; with Voice Mode Legato they slur).' },
  { id: 'arp_swing_percent', name: 'Arp Swing', group: 'Arpeggiator', min: 50, max: 75, default: 50, step: 0.1, unit: '%',
    description: 'Share of each pair of steps given to the first one (50 = straight, 66.7 = triplet shuffle).' },
  { id: 'arp_steps', name: 'Arp Pattern Length', group: 'Arpeggiator', min: 1, max: 16, default: 16, step: 1, unit: 'steps',
    description: 'Length of the step on/off pattern (Arp Step 1..16). The pattern restarts every this many steps, counted from beat 0 of the host.' },
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `arp_step_${i + 1}`, name: `Arp Step ${i + 1}`, group: 'Arp Rhythm', min: 0, max: 1, default: 1, step: 1, unit: '', options: ['Off', 'On'],
    description: `Rhythm gate: whether arpeggiator step ${i + 1} plays (Off = rest).`,
  })),

  { id: 'noise_type', name: 'Noise Type', group: 'Noise', min: 0, max: 7, default: 0, step: 1, unit: '',
    options: ['White', 'Chip Long (LFSR)', 'Chip Short (metallic)', 'Sample & Hold', 'Rotor', 'Crowd Claps', 'Shot', 'Rain'],
    description: 'White: hiss. Chip Long / Short and Sample & Hold are clocked from the note pitch. Rotor: periodic blade thumps with air wash. Crowd Claps: six independently timed short noise bursts. Shot: a brief crack, low body and falling thump, restarted on note-on. Rain: continuous filtered rain wash with irregular short droplets of varying strength and resonance. The four sound FX sources ignore note pitch and are mixed at Noise Level before the main filter and amp envelope.' },
  { id: 'noise_clock_oct', name: 'Noise Clock', group: 'Noise', min: -4, max: 4, default: 0, step: 0.01, unit: 'oct',
    description: 'Chip / S&H clock relative to the note (higher = brighter); at 0, Chip Short sounds at the note pitch. For Rotor / Crowd Claps / Rain this scales the blade / clap / droplet rate; for Shot it scales playback speed. These FX rates do not follow note pitch.' },
  { id: 'noise_filter_mode', name: 'Noise Filter', group: 'Noise', min: 0, max: 3, default: 0, step: 1, unit: '', options: ['Off', 'Low-pass', 'High-pass', 'Band-pass'],
    description: 'Extra filter on the noise only (before the main filter), e.g. a high-passed hiss or a band of noise.' },
  { id: 'noise_filter_hz', name: 'Noise Filter Cutoff', group: 'Noise', min: 20, max: 20000, default: 4000, step: 1, unit: 'Hz', scale: 'log',
    description: 'Cutoff / centre frequency of the noise filter.' },
  { id: 'cc_cutoff_number', name: 'Cutoff CC Number', group: 'Filter', min: 0, max: 127, default: 74, step: 1, unit: 'cc',
    description: 'MIDI CC that moves the filter cutoff (74 = brightness; 0 = none). CC value 64 = no change.' },
  { id: 'cc_cutoff_depth_oct', name: 'Cutoff CC Depth', group: 'Filter', min: 0, max: 8, default: 4, step: 0.01, unit: 'oct',
    description: 'How far the cutoff CC moves the cutoff: CC 0 = this many octaves down, CC 127 = up.' },
  TUNING_SOURCE,
  TUNING_SLOT,

  // ---- effects after the voice sum: chorus -> delay -> reverb (all Off by default)
  { id: 'fx_chorus_on', name: 'Chorus', group: 'Chorus', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Off', 'On'],
    description: 'Stereo chorus on the whole synth (first effect). Off = bypassed, no CPU.' },
  { id: 'fx_chorus_mix', name: 'Chorus Mix', group: 'Chorus', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Dry/wet balance of the chorus (0 = dry, 0.5 = classic chorus, 1 = only the modulated copy: vibrato).' },
  { id: 'fx_chorus_rate_hz', name: 'Chorus Rate', group: 'Chorus', min: 0.05, max: 5, default: 0.8, step: 0.01, unit: 'Hz', scale: 'log',
    description: 'Speed of the chorus sweep (left and right a quarter cycle apart).' },
  { id: 'fx_chorus_depth_ms', name: 'Chorus Depth', group: 'Chorus', min: 0, max: 8, default: 3, step: 0.01, unit: 'ms',
    description: 'How far the delay sweeps (from 7 ms up to 7 ms + depth). More = more detune and wobble.' },

  { id: 'fx_delay_on', name: 'Delay', group: 'Delay', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Off', 'On'],
    description: 'Stereo echo after the chorus. Off = bypassed, no CPU.' },
  { id: 'fx_delay_mix', name: 'Delay Mix', group: 'Delay', min: 0, max: 1, default: 0.25, step: 0.001, unit: '',
    description: 'Dry/wet balance of the delay (0 = dry, 1 = only the echoes).' },
  { id: 'fx_delay_sync', name: 'Delay Sync', group: 'Delay', min: 0, max: DELAY_SYNC_BEATS.length - 1, default: 9, step: 1, unit: '', options: DELAY_SYNC_NAMES,
    description: `Echo time as a note value at the host tempo (JSFX: REAPER tempo, web: BPM). Off = use Delay Time. Capped at ${DELAY_MAX_SECONDS} s.` },
  { id: 'fx_delay_time_ms', name: 'Delay Time', group: 'Delay', min: 1, max: 2000, default: 375, step: 1, unit: 'ms', scale: 'log',
    description: 'Echo time in ms when Delay Sync is Off. Changes glide (tape-like) instead of clicking.' },
  { id: 'fx_delay_feedback', name: 'Delay Feedback', group: 'Delay', min: 0, max: 0.95, default: 0.35, step: 0.001, unit: '',
    description: 'How much of each echo is fed back (more = more repeats).' },
  { id: 'fx_delay_ping_pong', name: 'Delay Ping-Pong', group: 'Delay', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Off', 'On'],
    description: 'On: the echoes bounce left -> right -> left (input summed to mono). Off: each side echoes itself.' },
  { id: 'fx_delay_high_cut_hz', name: 'Delay High Cut', group: 'Delay', min: 200, max: 20000, default: 6000, step: 1, unit: 'Hz', scale: 'log',
    description: 'Low-pass in the feedback loop: every repeat gets darker (damping, like tape or analog delays).' },

  { id: 'fx_reverb_on', name: 'Reverb', group: 'Reverb', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Off', 'On'],
    description: 'Algorithmic reverb (diffusers + 4-line feedback delay network) after the delay. Off = bypassed, no CPU.' },
  { id: 'fx_reverb_mix', name: 'Reverb Mix', group: 'Reverb', min: 0, max: 1, default: 0.25, step: 0.001, unit: '',
    description: 'Dry/wet balance of the reverb (0 = dry, 1 = only the reverb).' },
  { id: 'fx_reverb_decay_ms', name: 'Reverb Decay', group: 'Reverb', min: 200, max: 15000, default: 2500, step: 1, unit: 'ms', scale: 'log',
    description: 'Reverb time: how long the tail takes to fall by 60 dB.' },
  { id: 'fx_reverb_size', name: 'Reverb Size', group: 'Reverb', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Size of the space (spacing of the reflections): 0 = small room, 1 = large hall.' },
  { id: 'fx_reverb_damping', name: 'Reverb Damping', group: 'Reverb', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'How fast high frequencies die in the tail (0 = bright, 1 = dark).' },

  // ---- wavetable (Osc Waveform = Wavetable); appended so existing slider numbers stay
  { id: 'osc1_wt_bank', name: 'Osc1 Wavetable', group: 'Wavetable', min: 0, max: WT_BANKS.length - 1, default: 0, step: 1, unit: '', options: WT_BANKS,
    description: 'Wavetable bank of oscillator 1 (used while Osc1 Waveform is Wavetable). Basic Shapes: sine -> triangle -> saw -> square. PWM Sweep: pulse 50 % -> 5 %. Vocal Formants: vowels a-e-i-o-u. Harmonic Sweep: a band of harmonics rising 5 octaves. Digital: 8-bit XOR waveforms. Band-limited, generated in the synth (no samples).' },
  { id: 'osc1_wt_position', name: 'Osc1 WT Position', group: 'Wavetable', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Position in the oscillator 1 wavetable (0 = first frame, 1 = last; frames are crossfaded in between).' },
  { id: 'osc2_wt_bank', name: 'Osc2 Wavetable', group: 'Wavetable', min: 0, max: WT_BANKS.length - 1, default: 0, step: 1, unit: '', options: WT_BANKS,
    description: 'Wavetable bank of oscillator 2 (used while Osc2 Waveform is Wavetable). Same banks as Osc1 Wavetable.' },
  { id: 'osc2_wt_position', name: 'Osc2 WT Position', group: 'Wavetable', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Position in the oscillator 2 wavetable (0 = first frame, 1 = last).' },
  { id: 'wt_position_lfo', name: 'WT Position LFO', group: 'Wavetable', min: -1, max: 1, default: 0, step: 0.001, unit: '',
    description: 'How far the global LFO moves the wavetable position of both oscillators (+/- this amount at the LFO peaks; the result is limited to 0..1).' },
  { id: 'wt_position_filter_env', name: 'WT Position Filter Env', group: 'Wavetable', min: -1, max: 1, default: 0, step: 0.001, unit: '',
    description: 'How far the filter envelope moves the wavetable position of both oscillators (negative = moves it down).' },
  { id: 'wt_position_amp_env', name: 'WT Position Amp Env', group: 'Wavetable', min: -1, max: 1, default: 0, step: 0.001, unit: '',
    description: 'How far the amp envelope moves the wavetable position of both oscillators (negative = moves it down).' },
  // ---- modulation (added later, appended so the older slider numbers stay)
  { id: 'lfo2_waveform', name: 'LFO2 Waveform', group: 'LFO 2', min: 0, max: 5, default: 0, step: 1, unit: '', options: LFO_WAVES,
    description: 'Shape of the second global LFO. It only acts through the mod matrix (source LFO 2).' },
  { id: 'lfo2_rate_hz', name: 'LFO2 Rate', group: 'LFO 2', min: 0.05, max: 20, default: 0.5, step: 0.01, unit: 'Hz', scale: 'log',
    description: 'Rate of LFO 2 (used while LFO2 Sync is Off).' },
  { id: 'lfo2_sync', name: 'LFO2 Sync', group: 'LFO 2', min: 0, max: LFO_SYNC_BEATS.length - 1, default: 0, step: 1, unit: '', options: LFO_SYNC_NAMES,
    description: 'Lock LFO 2 to the host tempo (one cycle per note value, phase locked to the beat grid). Off = free running at LFO2 Rate.' },
  { id: 'mod_env_attack_ms', name: 'Mod Env Attack', group: 'Mod Envelope', min: 0.5, max: 5000, default: 5, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Attack time of the per-note modulation envelope (mod matrix source Mod Env).' },
  { id: 'mod_env_decay_ms', name: 'Mod Env Decay', group: 'Mod Envelope', min: 1, max: 10000, default: 300, step: 1, unit: 'ms', scale: 'log',
    description: 'Decay time of the modulation envelope.' },
  { id: 'mod_env_sustain', name: 'Mod Env Sustain', group: 'Mod Envelope', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Sustain level of the modulation envelope.' },
  { id: 'mod_env_release_ms', name: 'Mod Env Release', group: 'Mod Envelope', min: 1, max: 10000, default: 300, step: 1, unit: 'ms', scale: 'log',
    description: 'Release time of the modulation envelope.' },
  ...Array.from({ length: MOD_SLOTS }, (_, i) => [
    { id: `mod${i + 1}_source`, name: `Mod ${i + 1} Source`, group: 'Mod Matrix', min: 0, max: MOD_SOURCES.length - 1, default: 0, step: 1, unit: '',
      options: MOD_SOURCES,
      description: `Mod matrix slot ${i + 1}: what modulates. LFO 1 / LFO 2 / Random (a new value per note) swing -1..1; Mod Env, Velocity, Mod Wheel (CC1) and Pressure (channel pressure or polyphonic aftertouch) go 0..1; Key Track is the octaves above (+) / below (-) middle C. Off = slot unused.` },
    { id: `mod${i + 1}_destination`, name: `Mod ${i + 1} Destination`, group: 'Mod Matrix', min: 0, max: MOD_DESTINATIONS.length - 1, default: 0, step: 1, unit: '',
      options: MOD_DESTINATIONS.map((d) => d.name),
      description: `Mod matrix slot ${i + 1}: what is modulated (per note, except LFO 1 / LFO 2 Rate which are global and only follow LFO 1, LFO 2, Mod Wheel and channel pressure). Off = slot unused.` },
    { id: `mod${i + 1}_amount`, name: `Mod ${i + 1} Amount`, group: 'Mod Matrix', min: -4800, max: 4800, default: 0, step: 0.001, unit: '',
      description: `Mod matrix slot ${i + 1}: how far the destination moves at source value 1, in the destination's unit: Pitch / Osc2 Pitch in cents, Filter Cutoff / LFO Rate in octaves, FM Index in rad, Amp in dB, Resonance / Pulse Width / Noise Level added to the knob value (0..1), Pan -1 (left) .. +1 (right). Negative values invert.` },
  ]).flat(),
]);

// ---------------------------------------------------------------------------
// Physical modelling instrument (Karplus-Strong string / modal resonators)

/** Mode tables used by the modal model (see src/dsp/phys.js MATERIALS). */
export const MODAL_MATERIALS = ['Marimba Bar', 'Vibraphone Bar', 'Glockenspiel (free bar)', 'Wine Glass', 'Church Bell', 'Drum Membrane', 'Harmonic (string-like)', 'Kalimba Tine',
  'Gong Ageng (gamelan)', 'Kettle Gong (bonang)', 'Tam-tam', 'Steel Drum', 'Tubular Bell'];

export const PHYS_PARAMS = /** @type {ParamDef[]} */ ([
  ...TUNING_PARAMS,

  { id: 'phys_model', name: 'Physical Model', group: 'Model', min: 0, max: 7, default: 0, step: 1, unit: '',
    options: ['String (Karplus-Strong)', 'Modal (resonators)', 'Bowed String', 'Wind (reed / jet)', 'Membrane / Plate (2D mesh)', 'Stiff String (piano)', 'Brass (lip reed)', 'Organ (tonewheel drawbars)'],
    description: 'String: plucked delay-line loop. Modal: tuned resonators struck by a mallet. Bowed: delay lines + bow friction. Wind: bore + reed/jet. Mesh: 2D wave equation on a grid. Stiff string: string with dispersion (inharmonic partials). Brass: bore + buzzing lips. Organ: nine drawbar sine partials (tonewheel organ) with percussion and key click.' },

  { id: 'string_excitation', name: 'String Excitation', group: 'String', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Pluck (noise burst)', 'Strike (hammer pulse)'],
    description: 'What initially fills the delay line: a burst of noise (plucked) or a smooth pulse (hammered).' },
  { id: 'string_decay_ms', name: 'String Decay', group: 'String', min: 100, max: 20000, default: 3000, step: 1, unit: 'ms', scale: 'log',
    description: 'Time for the fundamental to fall by 60 dB while the key is held (loop gain per round trip).' },
  { id: 'string_damping', name: 'String Damping', group: 'String', min: 0, max: 1, default: 0.35, step: 0.001, unit: '',
    description: 'Low-pass in the loop: higher = high harmonics die out faster (nylon/felt-like).' },
  { id: 'string_pick_position', name: 'String Pick Position', group: 'String', min: 0.02, max: 0.5, default: 0.13, step: 0.001, unit: '',
    description: 'Where the string is plucked (0.5 = middle, removes even harmonics; near 0 = bright/thin).' },
  { id: 'string_brightness', name: 'String Pick Brightness', group: 'String', min: 0, max: 1, default: 0.7, step: 0.001, unit: '',
    description: 'Spectrum of the excitation (soft finger vs hard pick).' },

  { id: 'modal_material', name: 'Modal Material', group: 'Modal', min: 0, max: MODAL_MATERIALS.length - 1, default: 0, step: 1, unit: '', options: MODAL_MATERIALS,
    description: 'Set of mode frequency ratios / gains (measured or textbook values for each object).' },
  { id: 'modal_decay_ms', name: 'Modal Decay', group: 'Modal', min: 50, max: 20000, default: 1500, step: 1, unit: 'ms', scale: 'log',
    description: 'Decay time (-60 dB) of the lowest mode.' },
  { id: 'modal_high_damping', name: 'Modal High Mode Damping', group: 'Modal', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'How much faster higher modes decay than the fundamental.' },
  { id: 'modal_hardness', name: 'Modal Mallet Hardness', group: 'Modal', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Short hard mallet (1) excites high modes; long soft mallet (0) mostly the low ones.' },
  { id: 'modal_strike_position', name: 'Modal Strike Position', group: 'Modal', min: 0.02, max: 0.5, default: 0.22, step: 0.001, unit: '',
    description: 'Where the object is struck; modes with a node there are not excited (approximation: sin(pi*k*pos)).' },
  { id: 'modal_inharmonicity', name: 'Modal Ratio Stretch', group: 'Modal', min: -0.5, max: 0.5, default: 0, step: 0.001, unit: '',
    description: 'Bends the mode ratios toward (negative) or away from (positive) harmonic, to hear what inharmonicity does.' },

  { id: 'bow_pressure', name: 'Bow Pressure', group: 'Bowed', min: 0, max: 1, default: 0.45, step: 0.001, unit: '',
    description: 'Force of the bow on the string: low = airy/flautando, high = gritty (steeper friction curve).' },
  { id: 'bow_speed', name: 'Bow Speed', group: 'Bowed', min: 0, max: 1, default: 0.55, step: 0.001, unit: '',
    description: 'Bow velocity (loudness and brightness of the Helmholtz motion).' },
  { id: 'bow_position', name: 'Bow Position', group: 'Bowed', min: 0.02, max: 0.5, default: 0.127, step: 0.001, unit: '',
    description: 'Distance of the bow from the bridge (small = sul ponticello, larger = sul tasto).' },
  { id: 'bow_attack_ms', name: 'Bow Attack', group: 'Bowed', min: 1, max: 2000, default: 90, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Time for the bow to reach full speed.' },
  { id: 'bowed_brightness', name: 'Bowed String Brightness', group: 'Bowed', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Losses of high frequencies at the bridge (string material / damping).' },

  { id: 'wind_type', name: 'Wind Type', group: 'Wind', min: 0, max: 4, default: 0, step: 1, unit: '',
    options: ['Clarinet (reed)', 'Flute (air jet)', 'Saxophone (conical reed)', 'Oboe / Bassoon (double reed)', 'Free reed (accordion / harmonica)'],
    description: 'Clarinet: a reed valve at the closed end of a cylindrical bore (odd harmonics). Flute: an air jet across an open bore. Saxophone / Oboe: a reed on a conical bore (all harmonics); the double reed sits further down a narrower cone, for a thinner, nasal tone. Free reed: a metal tongue swinging through a slot at its own pitch (accordion, harmonica, harmonium); breath pressure sets how far it swings (louder, fuller), embouchure the reed offset (tone).' },
  { id: 'breath_pressure', name: 'Breath Pressure', group: 'Wind', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Blowing pressure; too low does not start the tone, too high overblows.' },
  { id: 'breath_noise', name: 'Breath Noise', group: 'Wind', min: 0, max: 1, default: 0.15, step: 0.001, unit: '',
    description: 'Turbulence noise mixed into the breath.' },
  { id: 'wind_attack_ms', name: 'Breath Attack', group: 'Wind', min: 1, max: 2000, default: 40, step: 0.1, unit: 'ms', scale: 'log',
    description: 'Time for the breath pressure to build up.' },
  { id: 'wind_embouchure', name: 'Embouchure', group: 'Wind', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Reed stiffness (clarinet) or the air jet offset against the edge (flute: more even harmonics).' },

  { id: 'mesh_shape', name: 'Mesh Shape', group: 'Mesh', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Circular drum', 'Square plate'],
    description: 'Shape of the vibrating 2D surface (fixed edges).' },
  { id: 'mesh_size', name: 'Mesh Resolution', group: 'Mesh', min: 6, max: 16, default: 12, step: 1, unit: 'cells',
    description: 'Grid points per side (more = more modes and a smoother sound, but more CPU). Max 3 voices in this model.' },
  { id: 'mesh_decay_ms', name: 'Mesh Decay', group: 'Mesh', min: 50, max: 10000, default: 900, step: 1, unit: 'ms', scale: 'log',
    description: 'Overall decay time of the surface.' },
  { id: 'mesh_high_damping', name: 'Mesh High Damping', group: 'Mesh', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'Extra damping of short wavelengths (high modes die faster, like a skin).' },
  { id: 'mesh_strike_x', name: 'Mesh Strike X', group: 'Mesh', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'Horizontal strike position (0.5 = centre).' },
  { id: 'mesh_strike_y', name: 'Mesh Strike Y', group: 'Mesh', min: 0, max: 1, default: 0.42, step: 0.001, unit: '',
    description: 'Vertical strike position (0.5 = centre). Hitting the centre excites mostly the symmetric modes.' },
  { id: 'mesh_hardness', name: 'Mesh Mallet Hardness', group: 'Mesh', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Small hard mallet (1) vs broad soft mallet (0).' },

  { id: 'piano_inharmonicity', name: 'Piano Inharmonicity', group: 'Stiff String', min: 0, max: 1, default: 0.35, step: 0.001, unit: '',
    description: 'String stiffness: higher partials are pushed sharp (dispersion all-passes in the loop, set per note from a piano-like B curve). 0.35 = typical piano, 1 = about 8x.' },
  { id: 'piano_hammer_hardness', name: 'Piano Hammer Hardness', group: 'Stiff String', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Felt stiffness of the hammer. The felt hardens as it is compressed, so louder notes are always brighter; this sets the overall brightness.' },
  { id: 'piano_strike_position', name: 'Piano Strike Position', group: 'Stiff String', min: 0.02, max: 0.5, default: 0.12, step: 0.001, unit: '',
    description: 'Where the hammer hits (about 1/8 on real pianos).' },
  { id: 'piano_decay_ms', name: 'Piano Decay', group: 'Stiff String', min: 200, max: 30000, default: 8000, step: 1, unit: 'ms', scale: 'log',
    description: 'Decay time of the fundamental while the key is held.' },
  { id: 'piano_damping', name: 'Piano Damping', group: 'Stiff String', min: 0, max: 1, default: 0.25, step: 0.001, unit: '',
    description: 'Extra loss of high partials per round trip.' },
  { id: 'piano_soundboard', name: 'Piano Soundboard', group: 'Stiff String', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'How much of the sound comes through the soundboard (16 resonances fed by the bridge) instead of straight from the strings.' },
  { id: 'piano_unison_detune_cents', name: 'Piano Unison Detune', group: 'Stiff String', min: 0, max: 10, default: 1.2, step: 0.01, unit: 'cents',
    description: 'Two strings per note slightly detuned: slow beating and a two-stage decay.' },

  { id: 'phys_vibrato_cents', name: 'Vibrato Depth', group: 'Output', min: 0, max: 100, default: 0, step: 0.1, unit: 'cents',
    description: 'Pitch vibrato for the delay-line models (string, bowed, wind, stiff string).' },
  { id: 'phys_vibrato_rate_hz', name: 'Vibrato Rate', group: 'Output', min: 1, max: 10, default: 5.5, step: 0.01, unit: 'Hz',
    description: 'Vibrato speed.' },
  { id: 'phys_release_ms', name: 'Release Damping', group: 'Output', min: 10, max: 20000, default: 400, step: 1, unit: 'ms', scale: 'log',
    description: 'Decay time after the key is released (like a damper touching the string/bar).' },
  { id: 'phys_velocity_amount', name: 'Velocity Amount', group: 'Output', min: 0, max: 1, default: 0.8, step: 0.001, unit: '',
    description: 'How much velocity changes loudness and brightness.' },
  { id: 'phys_stereo_width', name: 'Stereo Width', group: 'Output', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Spreads low notes left and high notes right.' },
  { id: 'phys_pitch_bend_range_cents', name: 'Pitch Bend Range', group: 'Output', min: 0, max: 2400, default: 200, step: 1, unit: 'cents',
    description: 'Pitch bend range in cents.' },
  { id: 'phys_room_mix', name: 'Room', group: 'Output', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Amount of a small room (4-line feedback delay network). Acoustic instruments sound dry and synthetic without one.' },
  { id: 'phys_room_decay_ms', name: 'Room Decay', group: 'Output', min: 200, max: 6000, default: 1300, step: 1, unit: 'ms', scale: 'log',
    description: 'Reverberation time (T60) of the room.' },
  { id: 'phys_volume_db', name: 'Volume', group: 'Output', min: -60, max: 6, default: -8, step: 0.1, unit: 'dB',
    description: 'Output volume of the physical model instrument.' },

  // (appended so the JSFX slider numbers of the older parameters stay the same)
  { id: 'brass_pressure', name: 'Brass Blowing Pressure', group: 'Brass', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Mouth pressure: louder and brighter (brass get brassier the harder they are blown). Velocity adds to it.' },
  { id: 'brass_lip', name: 'Brass Lip Buzz', group: 'Brass', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'How easily the lips open: more = a buzzier, edgier tone.' },
  { id: 'brass_attack_ms', name: 'Brass Attack', group: 'Brass', min: 1, max: 1000, default: 30, step: 0.1, unit: 'ms', scale: 'log',
    description: 'How fast the pressure builds up (short = a tongued attack).' },
  { id: 'brass_bell', name: 'Brass Bell Brightness', group: 'Brass', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Low-pass of the sound leaving the bell; low values sound like a mute or a horn played into the hand.' },

  // ---- added later: kept at the end so existing REAPER projects keep their slider numbers
  TUNING_SOURCE,
  { id: 'amp_type', name: 'Amp', group: 'Amp', min: 0, max: 4, default: 0, step: 1, unit: '',
    options: ['Off', 'Clean', 'Crunch', 'Overdrive', 'Distortion'],
    description: 'Guitar amp after the instrument (before the room): pre EQ, drive and a speaker cabinet filter. Clean adds only colour; Crunch to Distortion clip harder (Distortion has two gain stages). Mostly for the String model (electric guitar).' },
  { id: 'amp_gain', name: 'Amp Gain', group: 'Amp', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Drive into the amp (range depends on the amp type).' },
  { id: 'amp_tone', name: 'Amp Tone', group: 'Amp', min: 0, max: 1, default: 0.5, step: 0.001, unit: '',
    description: 'Brightness of the speaker cabinet (its high-frequency roll-off).' },
  { id: 'amp_level_db', name: 'Amp Level', group: 'Amp', min: -24, max: 12, default: 0, step: 0.1, unit: 'dB',
    description: 'Output level of the amp.' },
  TUNING_SLOT,
  { id: 'phys_sustain_mode', name: 'Sustain Pedal', group: 'Output', min: 0, max: 2, default: 1, step: 1, unit: '',
    options: ['Off', 'Auto (strings / piano / modal)', 'On (all models)'],
    description: 'MIDI CC64 delays note-off damping until pedal release. Auto supports plucked strings, piano and modal materials except Drum Membrane; bowed, wind, brass and mesh ignore it. On sustains all models. Natural decay still continues.' },
  { id: 'phys_pressure_excitation', name: 'Pressure to Breath / Bow', group: 'Pressure', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'How much aftertouch (channel pressure or polyphonic aftertouch, 0..1) adds to Breath Pressure (wind), Brass Blowing Pressure (brass) and Bow Pressure (bowed) while a note sounds. 0 = off.' },
  { id: 'phys_pressure_vibrato_cents', name: 'Pressure to Vibrato', group: 'Pressure', min: 0, max: 100, default: 0, step: 0.1, unit: 'cents',
    description: 'Extra vibrato depth at full aftertouch, per note (delay-line models: string, bowed, wind, stiff string, brass). 0 = off.' },
  { id: 'phys_pressure_brightness', name: 'Pressure to Brightness', group: 'Pressure', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'How much aftertouch adds to Bowed String Brightness (bowed) and Brass Bell Brightness (brass). 0 = off.' },  // Organ model and rotary speaker (added later)
  { id: 'organ_drawbar_16', name: "Drawbar 16'", group: 'Organ', min: 0, max: 8, default: 8, step: 1, unit: '',
    description: 'Sub-octave. 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_5_13', name: "Drawbar 5 1/3'", group: 'Organ', min: 0, max: 8, default: 8, step: 1, unit: '',
    description: 'Fifth above the fundamental (3rd harmonic of the sub-octave). 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_8', name: "Drawbar 8'", group: 'Organ', min: 0, max: 8, default: 8, step: 1, unit: '',
    description: 'Fundamental. 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_4', name: "Drawbar 4'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Octave. 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_2_23', name: "Drawbar 2 2/3'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Twelfth (octave + fifth). 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_2', name: "Drawbar 2'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Two octaves. 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_1_35', name: "Drawbar 1 3/5'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Seventeenth (two octaves + major third). 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_1_13', name: "Drawbar 1 1/3'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Nineteenth (two octaves + fifth). 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_drawbar_1', name: "Drawbar 1'", group: 'Organ', min: 0, max: 8, default: 0, step: 1, unit: '',
    description: 'Three octaves. 0 = pushed in, each step +3 dB, 8 = full (as on a tonewheel organ).' },
  { id: 'organ_percussion', name: 'Percussion', group: 'Organ', min: 0, max: 2, default: 0, step: 1, unit: '',
    options: ["Off", "Second (4')", "Third (2 2/3')"],
    description: 'A decaying extra partial at the octave or the twelfth on each attack. Single trigger: only a note played with no other key held starts it, so legato lines do not re-strike.' },
  { id: 'organ_perc_decay_ms', name: 'Percussion Decay', group: 'Organ', min: 50, max: 3000, default: 300, step: 1, unit: 'ms', scale: 'log',
    description: 'Time for the percussion to fall by 60 dB (fast ~ 200 ms, slow ~ 1000 ms).' },
  { id: 'organ_perc_level', name: 'Percussion Level', group: 'Organ', min: 0, max: 1, default: 0.6, step: 0.001, unit: '',
    description: 'Loudness of the percussion partial.' },
  { id: 'organ_click', name: 'Key Click', group: 'Organ', min: 0, max: 1, default: 0.3, step: 0.001, unit: '',
    description: 'Short noise burst of the key contacts closing.' },
  { id: 'rotary_mode', name: 'Rotary Speaker', group: 'Rotary', min: 0, max: 2, default: 0, step: 1, unit: '',
    options: ['Off', 'Slow (chorale)', 'Fast (tremolo)'],
    description: 'Rotating speaker after the amp: a horn (highs, Doppler + loudness swirl) and a drum (lows) spin at their own speeds and speed up / slow down gradually. The mod wheel above half switches Slow to Fast. Works on every model.' },
  { id: 'rotary_mix', name: 'Rotary Mix', group: 'Rotary', min: 0, max: 1, default: 1, step: 0.001, unit: '',
    description: 'Share of the rotary speaker in the output (1 = the speaker only).' },
  { id: 'free_reed_detune_cents', name: 'Free Reed Musette', group: 'Wind', min: 0, max: 50, default: 0, step: 0.1, unit: 'cents',
    description: 'Free reed only: two more reeds this many cents above and below the note beat against it (accordion musette / tremolo). 0 = a single reed.' },
  { id: 'string_sawari', name: 'String Sawari', group: 'String', min: 0, max: 1, default: 0, step: 0.001, unit: '',
    description: 'Sitar / tanpura bridge (jawari): the string grazes a flat curved bridge on every swing, which keeps folding energy into the high partials - the sustained buzz. Higher = the string lies on the bridge for more of each cycle. 0 = an ordinary bridge.' },
]);

// ---------------------------------------------------------------------------
// AmiSynth Tuning (JSFX only): holds a scale and shares it with the instruments

/**
 * Parameters of "AmiSynth Tuning". The scale is kept in sliders (real cents values, so MCP tools
 * can write it by name) or read from a Scala file in REAPER/Data/AmiSynth/ chosen by name.
 * `file` marks a JSFX file-chooser slider (its value is the index of the file in that folder).
 */
export const TUNING_HOLDER_PARAMS = /** @type {(ParamDef & {file?: {dir:string, default:string}})[]} */ ([
  { id: 'tuning_slot', name: 'Slot', group: 'Shared Scale', min: 1, max: TUNING_SLOTS, default: 1, step: 1, unit: '',
    description: 'Slot this scale is published to. Instruments with Tuning Source = Shared and the same Tuning Slot follow it.' },
  { id: 'scale_source', name: 'Scale Source', group: 'Shared Scale', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Sliders', 'File'],
    description: 'Sliders: Scale Size + Degree 1..N below. File: the Scala file chosen in Scale File (falls back to the sliders if it cannot be read).' },
  { id: 'scale_file', name: 'Scale File', group: 'Shared Scale', min: 0, max: 0, default: 0, step: 1, unit: '', file: { dir: '/AmiSynth', default: 'tuning.txt' },
    description: 'A Scala (.scl) scale saved with a .txt name in REAPER/Data/AmiSynth/ (the value is its position in that folder, alphabetical).' },
  { id: 'scale_ref_note', name: 'Reference Note', group: 'Shared Scale', min: 0, max: 127, default: 69, step: 1, unit: 'note',
    description: 'MIDI note that sounds at the reference frequency (replaces the instruments\' own reference while they follow this slot).' },
  { id: 'scale_ref_hz', name: 'Reference Frequency', group: 'Shared Scale', min: 100, max: 1000, default: 440, step: 0.01, unit: 'Hz',
    description: 'Frequency of the reference note.' },
  { id: 'scale_size', name: 'Scale Size', group: 'Shared Scale', min: 1, max: TUNING_MAX_DEGREES, default: 12, step: 1, unit: 'notes',
    description: 'Notes per period (Degree 1..this; the last one is the period, e.g. 1200 cents for an octave).' },
  ...Array.from({ length: TUNING_MAX_DEGREES }, (_, i) => ({
    id: `scale_degree_${i + 1}`, name: `Degree ${i + 1}`, group: 'Degrees', min: 0, max: 4800, default: (i + 1) * 100, step: 0.001, unit: 'cents',
    description: `Pitch of scale degree ${i + 1} above the reference, in cents (Scala order: degree 0 = 0 cents is implied; degree Scale Size = the period).`,
  })),
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
  { key: 'rimshot', name: 'Rimshot', note: 37 },
  { key: 'low_tom', name: 'Low Tom', note: 45 },
  { key: 'mid_tom', name: 'Mid Tom', note: 47 },
  { key: 'high_tom', name: 'High Tom', note: 50 },
  { key: 'crash', name: 'Crash', note: 49 },
  { key: 'ride', name: 'Ride', note: 51 },
  { key: 'cowbell', name: 'Cowbell', note: 56 },
  { key: 'shaker', name: 'Shaker', note: 70 },
  // GM percussion added later (the other GM notes of each family play variants of these, see
  // GM_DRUM_VARIANTS)
  { key: 'tambourine', name: 'Tambourine', note: 54 },
  { key: 'conga', name: 'Conga', note: 63 },
  { key: 'timbale', name: 'Timbale', note: 65 },
  { key: 'agogo', name: 'Agogo', note: 67 },
  { key: 'claves', name: 'Claves', note: 75 },
  { key: 'triangle', name: 'Triangle', note: 81 },
  { key: 'vibraslap', name: 'Vibraslap', note: 58 },
  { key: 'whistle', name: 'Whistle', note: 72 },
  { key: 'guiro', name: 'Guiro', note: 74 },
  { key: 'cuica', name: 'Cuica', note: 79 },
];

/**
 * Other GM percussion notes the drum machine plays as a variant of a part: its parameters with
 * the pitch / decay / level scaled. Variants of the kick, snare, closed hat and shaker (35, 40,
 * 44, 69) retrigger the part itself; the others have a voice of their own, so they can ring
 * together with the part. With these every GM note 35-81 sounds.
 */
export const GM_DRUM_VARIANTS = [
  { note: 35, name: 'Acoustic Bass Drum', part: 'kick', pitch: 1, decay: 1, level: 1 },
  { note: 40, name: 'Electric Snare', part: 'snare', pitch: 1, decay: 1, level: 1 },
  { note: 41, name: 'Low Floor Tom', part: 'low_tom', pitch: 0.75, decay: 1.15, level: 1 },
  { note: 43, name: 'High Floor Tom', part: 'low_tom', pitch: 0.87, decay: 1.1, level: 1 },
  { note: 44, name: 'Pedal Hi-Hat', part: 'closed_hat', pitch: 1, decay: 0.8, level: 0.6 },
  { note: 48, name: 'Hi-Mid Tom', part: 'mid_tom', pitch: 1.2, decay: 1, level: 1 },
  { note: 52, name: 'Chinese Cymbal', part: 'crash', pitch: 0.8, decay: 0.8, level: 1 },
  { note: 53, name: 'Ride Bell', part: 'ride', pitch: 1.55, decay: 0.7, level: 1 },
  { note: 55, name: 'Splash Cymbal', part: 'crash', pitch: 1.45, decay: 0.3, level: 0.9 },
  { note: 57, name: 'Crash Cymbal 2', part: 'crash', pitch: 1.1, decay: 1, level: 1 },
  { note: 59, name: 'Ride Cymbal 2', part: 'ride', pitch: 0.92, decay: 1, level: 1 },
  { note: 60, name: 'Hi Bongo', part: 'conga', pitch: 2, decay: 0.6, level: 0.9 },
  { note: 61, name: 'Low Bongo', part: 'conga', pitch: 1.5, decay: 0.7, level: 0.9 },
  { note: 62, name: 'Mute Hi Conga', part: 'conga', pitch: 1.05, decay: 0.25, level: 1 },
  { note: 64, name: 'Low Conga', part: 'conga', pitch: 0.75, decay: 1.2, level: 1 },
  { note: 66, name: 'Low Timbale', part: 'timbale', pitch: 0.78, decay: 1.1, level: 1 },
  { note: 68, name: 'Low Agogo', part: 'agogo', pitch: 0.75, decay: 1, level: 1 },
  { note: 69, name: 'Cabasa', part: 'shaker', pitch: 1, decay: 1, level: 1 },
  { note: 76, name: 'Hi Wood Block', part: 'claves', pitch: 0.62, decay: 0.6, level: 1 },
  { note: 77, name: 'Low Wood Block', part: 'claves', pitch: 0.47, decay: 0.6, level: 1 },
  { note: 80, name: 'Mute Triangle', part: 'triangle', pitch: 1, decay: 0.05, level: 1 },
  { note: 71, name: 'Short Whistle', part: 'whistle', pitch: 1, decay: 0.3, level: 1 },
  { note: 73, name: 'Short Guiro', part: 'guiro', pitch: 1, decay: 0.3, level: 1 },
  { note: 78, name: 'Mute Cuica', part: 'cuica', pitch: 1.5, decay: 0.35, level: 1 },
];

/**
 * Separate outputs of the JSFX drums (pins 3..10): one stereo bus per group of parts. Outputs 1/2
 * are the main mix; each bus can be left out of it (e.g. a kick-only sidechain source).
 */
export const DRUM_BUSES = [
  { key: 'kick', name: 'Kick Out', parts: 'kick', pins: '3/4' },
  { key: 'snare', name: 'Snare/Clap Out', parts: 'snare, clap and rimshot', pins: '5/6' },
  { key: 'hats', name: 'Hats/Cymbals Out', parts: 'hi-hats, crash and ride', pins: '7/8' },
  { key: 'perc', name: 'Toms/Perc Out', parts: 'toms, cowbell, shaker and the Latin / hand percussion', pins: '9/10' },
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

  ...partParams('low_tom', 'Low Tom', {
    pitch: [40, 600, 90], decay: [40, 3000, 420], tone: 0.4, level: -3, pan: -0.3,
    pitchDesc: 'Resting frequency of the tom sine.',
    decayDesc: 'Amplitude decay time of the tom.',
    toneDesc: 'Downward pitch bend at the attack plus stick noise.',
  }),
  ...partParams('mid_tom', 'Mid Tom', {
    pitch: [40, 600, 135], decay: [40, 3000, 420], tone: 0.4, level: -3, pan: 0,
    pitchDesc: 'Resting frequency of the tom sine.',
    decayDesc: 'Amplitude decay time of the tom.',
    toneDesc: 'Downward pitch bend at the attack plus stick noise.',
  }),
  ...partParams('high_tom', 'High Tom', {
    pitch: [40, 600, 200], decay: [40, 3000, 420], tone: 0.4, level: -3, pan: 0.3,
    pitchDesc: 'Resting frequency of the tom sine.',
    decayDesc: 'Amplitude decay time of the tom.',
    toneDesc: 'Downward pitch bend at the attack plus stick noise.',
  }),

  ...partParams('rimshot', 'Rimshot', {
    pitch: [400, 4000, 1700], decay: [5, 300, 40], tone: 0.5, level: -6, pan: 0.1,
    pitchDesc: 'Frequency of the high resonance (a lower partial follows at ~0.27x).',
    decayDesc: 'Decay time of the rim click.',
    toneDesc: 'Drive / hardness of the click.',
  }),

  ...partParams('cowbell', 'Cowbell', {
    pitch: [200, 1500, 540], decay: [30, 2000, 300], tone: 0.4, level: -8, pan: 0.2,
    pitchDesc: 'Frequency of the lower square (the upper one sits at ~1.48x, as on the 808).',
    decayDesc: 'Decay time of the cowbell tail.',
    toneDesc: 'Band-pass brightness.',
  }),

  ...partParams('crash', 'Crash', {
    pitch: [100, 1000, 420], decay: [200, 8000, 1800], tone: 0.35, level: -9, pan: -0.35,
    pitchDesc: 'Base frequency of the metallic square-wave cluster.',
    decayDesc: 'Decay time of the crash cymbal.',
    toneDesc: 'High-pass cutoff (brightness).',
  }),
  { id: 'crash_metal_mix', name: 'Crash Metal Mix', group: 'Crash', min: 0, max: 1, default: 0.35, step: 0.001, unit: '',
    description: 'Balance between noise (0) and detuned square cluster (1).' },

  ...partParams('ride', 'Ride', {
    pitch: [100, 1000, 520], decay: [200, 8000, 2200], tone: 0.6, level: -7, pan: 0.35,
    pitchDesc: 'Base frequency of the metallic square-wave cluster.',
    decayDesc: 'Decay time of the ride cymbal.',
    toneDesc: 'High-pass cutoff (brightness).',
  }),
  { id: 'ride_metal_mix', name: 'Ride Metal Mix', group: 'Ride', min: 0, max: 1, default: 0.85, step: 0.001, unit: '',
    description: 'Balance between noise (0) and detuned square cluster (1).' },

  ...partParams('shaker', 'Shaker', {
    pitch: [1500, 15000, 6500], decay: [10, 500, 70], tone: 0.4, level: -10, pan: 0.25,
    pitchDesc: 'Centre frequency of the band-passed noise.',
    decayDesc: 'Decay time after the swell.',
    toneDesc: 'Attack swell length (0 = instant, 1 = slow shake).',
  }),

  { id: 'drum_master_volume_db', name: 'Drum Master Volume', group: 'Master', min: -60, max: 6, default: -4, step: 0.1, unit: 'dB',
    description: 'Output volume of the drum machine.' },

  // ---- added later: kept at the end so existing REAPER projects keep their slider numbers
  ...DRUM_BUSES.map((b) => ({
    id: `${b.key}_bus_in_main`, name: `${b.name} In Main Mix`, group: 'In Main Mix (JSFX: separate outputs)', min: 0, max: 1, default: 1, step: 1, unit: '', options: ['Off', 'On'],
    description: `Whether the ${b.parts} also play in the main mix (outputs 1/2). In the JSFX they always play on their own outputs ${b.pins}.`,
  })),

  // ---- GM percussion parts (and the variants in GM_DRUM_VARIANTS)
  ...partParams('tambourine', 'Tambourine', {
    pitch: [200, 2000, 700], decay: [20, 1000, 180], tone: 0.5, level: -10, pan: -0.15,
    pitchDesc: 'Base frequency of the jingle cluster (metallic squares).',
    decayDesc: 'Decay time of the jingles.',
    toneDesc: 'High-pass cutoff (brightness).',
  }),
  ...partParams('conga', 'Conga', {
    pitch: [80, 600, 200], decay: [30, 1500, 250], tone: 0.5, level: -4, pan: 0.2,
    pitchDesc: 'Open hi conga (note 63); low conga, mute conga and the bongos (60-64) are tuned from it.',
    decayDesc: 'Decay time of the open hi conga.',
    toneDesc: 'Hand slap: pitch bend at the attack plus slap noise.',
  }),
  ...partParams('timbale', 'Timbale', {
    pitch: [150, 1200, 420], decay: [50, 2000, 600], tone: 0.7, level: -6, pan: -0.2,
    pitchDesc: 'High timbale (note 65); the low timbale (66) sits ~0.78x below.',
    decayDesc: 'Decay time of the timbale shell.',
    toneDesc: 'Stick attack: pitch bend plus stick noise.',
  }),
  ...partParams('agogo', 'Agogo', {
    pitch: [300, 3000, 900], decay: [30, 2000, 500], tone: 0.4, level: -9, pan: 0.3,
    pitchDesc: 'High agogo bell (note 67); the low bell (68) is 0.75x.',
    decayDesc: 'Decay time of the bell.',
    toneDesc: 'Band-pass brightness.',
  }),
  ...partParams('claves', 'Claves', {
    pitch: [800, 5000, 2500], decay: [10, 500, 80], tone: 0.5, level: -8, pan: -0.3,
    pitchDesc: 'Claves (note 75); the hi / low wood blocks (76 / 77) are tuned from it.',
    decayDesc: 'Ring time of the wood.',
    toneDesc: 'Upper mode and click (hardness).',
  }),
  ...partParams('triangle', 'Triangle', {
    pitch: [400, 4000, 1200], decay: [100, 8000, 2200], tone: 0.6, level: -12, pan: 0.35,
    pitchDesc: 'Lowest partial of the triangle.',
    decayDesc: 'Ring time of the open triangle (note 81); the mute triangle (80) is cut short and chokes it.',
    toneDesc: 'Balance of the upper partials (brightness).',
  }),
  ...partParams('vibraslap', 'Vibraslap', {
    pitch: [1000, 6000, 2800], decay: [200, 3000, 900], tone: 0.5, level: -10, pan: -0.25,
    pitchDesc: 'Resonance of the rattle box.',
    decayDesc: 'How long the rattle goes on.',
    toneDesc: 'Rattle rate (slow .. fast clicks).',
  }),
  ...partParams('whistle', 'Whistle', {
    pitch: [1000, 5000, 2600], decay: [100, 2000, 450], tone: 0.6, level: -8, pan: 0.1,
    pitchDesc: 'Pitch of the samba whistle.',
    decayDesc: 'Length of the long whistle (note 72); the short whistle (71) is 0.3x.',
    toneDesc: 'Trill of the pea inside (pitch and loudness warble).',
  }),
  ...partParams('guiro', 'Guiro', {
    pitch: [1000, 8000, 3500], decay: [100, 1000, 380], tone: 0.5, level: -8, pan: 0.25,
    pitchDesc: 'Resonance of the gourd (each ridge click rings at it).',
    decayDesc: 'Length of the long scrape (note 74); the short guiro (73) is 0.3x.',
    toneDesc: 'Ridge rate of the scrape (slow .. fast).',
  }),
  ...partParams('cuica', 'Cuica', {
    pitch: [200, 1200, 520], decay: [100, 1500, 450], tone: 0.6, level: -8, pan: -0.1,
    pitchDesc: 'Open cuica (note 79); the mute cuica (78) is 1.5x higher and short.',
    decayDesc: 'Decay of the open cuica.',
    toneDesc: 'Upward glide of the rubbed stick at the start.',
  }),
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
