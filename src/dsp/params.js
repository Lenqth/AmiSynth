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

  { id: 'lfo_waveform', name: 'LFO Waveform', group: 'LFO', min: 0, max: 5, default: 0, step: 1, unit: '', options: ['Sine', 'Triangle', 'Saw Down', 'Square', 'Sample & Hold', 'Duck (pump)'],
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

  { id: 'noise_type', name: 'Noise Type', group: 'Noise', min: 0, max: 3, default: 0, step: 1, unit: '',
    options: ['White', 'Chip Long (LFSR)', 'Chip Short (metallic)', 'Sample & Hold'],
    description: 'White: hiss. Chip Long / Short: 8-bit console style shift-register noise, clocked from the note pitch (Short repeats every 93 steps: a pitched, metallic tone). Sample & Hold: random steps at the clock rate.' },
  { id: 'noise_clock_oct', name: 'Noise Clock', group: 'Noise', min: -4, max: 4, default: 0, step: 0.01, unit: 'oct',
    description: 'Clock of the chip / S&H noise relative to the note (higher = brighter). At 0, Chip Short sounds at the note pitch.' },
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
]);

// ---------------------------------------------------------------------------
// Physical modelling instrument (Karplus-Strong string / modal resonators)

/** Mode tables used by the modal model (see src/dsp/phys.js MATERIALS). */
export const MODAL_MATERIALS = ['Marimba Bar', 'Vibraphone Bar', 'Glockenspiel (free bar)', 'Wine Glass', 'Church Bell', 'Drum Membrane', 'Harmonic (string-like)', 'Kalimba Tine',
  'Gong Ageng (gamelan)', 'Kettle Gong (bonang)', 'Tam-tam'];

export const PHYS_PARAMS = /** @type {ParamDef[]} */ ([
  ...TUNING_PARAMS,

  { id: 'phys_model', name: 'Physical Model', group: 'Model', min: 0, max: 6, default: 0, step: 1, unit: '',
    options: ['String (Karplus-Strong)', 'Modal (resonators)', 'Bowed String', 'Wind (reed / jet)', 'Membrane / Plate (2D mesh)', 'Stiff String (piano)', 'Brass (lip reed)'],
    description: 'String: plucked delay-line loop. Modal: tuned resonators struck by a mallet. Bowed: delay lines + bow friction. Wind: bore + reed/jet. Mesh: 2D wave equation on a grid. Stiff string: string with dispersion (inharmonic partials). Brass: bore + buzzing lips.' },

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

  { id: 'wind_type', name: 'Wind Type', group: 'Wind', min: 0, max: 1, default: 0, step: 1, unit: '', options: ['Clarinet (reed)', 'Flute (air jet)'],
    description: 'Reed: a pressure-controlled valve at a closed bore end (odd harmonics). Jet: an air jet across an open bore.' },
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
];

/**
 * Separate outputs of the JSFX drums (pins 3..10): one stereo bus per group of parts. Outputs 1/2
 * are the main mix; each bus can be left out of it (e.g. a kick-only sidechain source).
 */
export const DRUM_BUSES = [
  { key: 'kick', name: 'Kick Out', parts: 'kick', pins: '3/4' },
  { key: 'snare', name: 'Snare/Clap Out', parts: 'snare, clap and rimshot', pins: '5/6' },
  { key: 'hats', name: 'Hats/Cymbals Out', parts: 'hi-hats, crash and ride', pins: '7/8' },
  { key: 'perc', name: 'Toms/Perc Out', parts: 'toms, cowbell and shaker', pins: '9/10' },
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
