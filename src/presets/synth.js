// Built-in synth presets. Each preset only lists values that differ from the
// parameter defaults (src/dsp/params.js), so presets stay valid when new
// parameters are added. Tuning parameters are never part of a preset.
//
// LLM tip: a preset is just { name, category, description, params } where
// params keys are the parameter ids documented in params.js / jsfx/generated/params.json.

/** @typedef {{name:string, category:string, description:string, params:Record<string, number>}} Preset */

/** @type {Preset[]} */
export const SYNTH_PRESETS = [
  {
    name: 'Init',
    category: 'Basic',
    description: 'Default patch: detuned saw + square through a 24 dB low-pass.',
    params: {},
  },
  {
    name: 'Acid Bass',
    category: 'Bass',
    description: 'Single saw, resonant 24 dB filter with a snappy envelope and glide.',
    params: {
      master_volume_db: -9,
      osc2_level: 0, osc1_waveform: 0, filter_cutoff_hz: 260, filter_resonance: 0.82, filter_env_amount_oct: 4.2,
      filter_env_attack_ms: 1, filter_env_decay_ms: 180, filter_env_sustain: 0, filter_key_tracking: 0.3,
      filter_velocity_amount: 0.8, filter_drive: 0.35, amp_attack_ms: 1, amp_decay_ms: 300, amp_sustain: 0.8,
      amp_release_ms: 40, voice_count: 1, glide_ms: 70,
    },
  },
  {
    name: 'Sub Bass',
    category: 'Bass',
    description: 'Round sine + sub square, almost no filter movement.',
    params: {
      osc1_waveform: 3, osc1_level: 0.9, osc2_level: 0, sub_osc_level: 0.45, filter_cutoff_hz: 600, filter_resonance: 0,
      filter_env_amount_oct: 0.5, amp_attack_ms: 2, amp_sustain: 1, amp_release_ms: 80, voice_count: 1, glide_ms: 25,
    },
  },
  {
    name: 'Pluck',
    category: 'Keys',
    description: 'Short decaying saw/pulse pluck for arpeggios.',
    params: {
      master_volume_db: -1,
      osc2_waveform: 1, osc2_pulse_width: 0.3, osc2_level: 0.4, filter_cutoff_hz: 400, filter_resonance: 0.25,
      filter_env_amount_oct: 4.5, filter_env_attack_ms: 1, filter_env_decay_ms: 220, filter_env_sustain: 0,
      amp_attack_ms: 1, amp_decay_ms: 450, amp_sustain: 0, amp_release_ms: 200,
    },
  },
  {
    name: 'FM Bell',
    category: 'Keys',
    description: 'Sine carrier modulated by a sine at 3.5x: inharmonic bell. Velocity opens the FM via the envelope.',
    params: {
      master_volume_db: -3,
      osc1_waveform: 3, osc2_waveform: 3, osc1_level: 1, osc2_level: 0, osc2_transpose_cents: 2169, osc2_detune_cents: 0,
      fm_index: 3.5, filter_mode: 0, filter_cutoff_hz: 12000, filter_resonance: 0, filter_env_amount_oct: 0,
      amp_attack_ms: 1, amp_decay_ms: 2500, amp_sustain: 0, amp_release_ms: 1500,
    },
  },
  {
    name: 'FM E-Piano',
    category: 'Keys',
    description: 'Sine 1:1 FM with a short bright attack (osc2 pitch envelope adds the tine "ding").',
    params: {
      master_volume_db: -3,
      osc1_waveform: 3, osc2_waveform: 3, osc1_level: 1, osc2_level: 0.08, osc2_transpose_cents: 0, osc2_detune_cents: 1,
      fm_index: 1.6, osc2_env_pitch_cents: 2400, filter_env_attack_ms: 1, filter_env_decay_ms: 90, filter_env_sustain: 0,
      filter_cutoff_hz: 9000, filter_resonance: 0, filter_env_amount_oct: 0, amp_attack_ms: 2, amp_decay_ms: 1800,
      amp_sustain: 0.25, amp_release_ms: 400, amp_velocity_amount: 0.9,
    },
  },
  {
    name: 'Supersaw Lead',
    category: 'Lead',
    description: '4-voice unison saws, wide stereo, slight glide.',
    params: {
      osc2_waveform: 0, osc2_level: 0.7, osc2_detune_cents: -9, unison_voices: 4, unison_detune_cents: 28,
      unison_stereo_width: 0.9, filter_cutoff_hz: 3500, filter_resonance: 0.15, filter_env_amount_oct: 1.5,
      filter_env_sustain: 0.5, amp_attack_ms: 4, amp_sustain: 0.85, amp_release_ms: 220, glide_ms: 40,
      modwheel_vibrato_cents: 40,
    },
  },
  {
    name: 'Sync Lead',
    category: 'Lead',
    description: 'Osc2 hard-synced to osc1, its pitch swept by the filter envelope.',
    params: {
      osc1_level: 0.2, osc2_waveform: 0, osc2_level: 0.9, osc2_hard_sync: 1, osc2_transpose_cents: 700,
      osc2_env_pitch_cents: 2400, filter_env_attack_ms: 1, filter_env_decay_ms: 600, filter_env_sustain: 0.1,
      filter_cutoff_hz: 5000, filter_resonance: 0.1, filter_env_amount_oct: 0.5, amp_sustain: 0.9,
      voice_count: 1, glide_ms: 30, lfo_pitch_cents: 8, lfo_rate_hz: 5.5,
    },
  },
  {
    name: 'Chiptune Square',
    category: 'Lead',
    description: '12.5% pulse, no filter, instant envelopes: 8-bit console style.',
    params: {
      osc1_waveform: 1, osc1_pulse_width: 0.125, osc1_level: 0.8, osc2_level: 0, filter_cutoff_hz: 20000,
      filter_resonance: 0, filter_env_amount_oct: 0, filter_key_tracking: 0, amp_attack_ms: 0.5, amp_decay_ms: 100,
      amp_sustain: 1, amp_release_ms: 15, amp_velocity_amount: 0, voice_count: 1,
    },
  },
  {
    name: 'PWM Strings',
    category: 'Pad',
    description: 'Two slowly pulse-width-modulated pulses, slow attack and release.',
    params: {
      master_volume_db: -9,
      osc1_waveform: 1, osc2_waveform: 1, osc2_level: 0.7, osc2_detune_cents: 9, lfo_waveform: 1, lfo_rate_hz: 0.6,
      lfo_pulse_width: 0.35, filter_cutoff_hz: 2600, filter_resonance: 0.1, filter_env_amount_oct: 0.6,
      filter_env_attack_ms: 400, filter_env_sustain: 0.8, amp_attack_ms: 350, amp_decay_ms: 1000, amp_sustain: 0.9,
      amp_release_ms: 900, unison_voices: 2, unison_detune_cents: 12,
    },
  },
  {
    name: 'Warm Pad',
    category: 'Pad',
    description: 'Detuned triangle + saw, slow swelling filter.',
    params: {
      osc1_waveform: 2, osc2_waveform: 0, osc2_level: 0.35, osc2_detune_cents: 12, filter_cutoff_hz: 700,
      filter_resonance: 0.2, filter_env_amount_oct: 2, filter_env_attack_ms: 1500, filter_env_decay_ms: 3000,
      filter_env_sustain: 0.5, filter_env_release_ms: 2000, amp_attack_ms: 900, amp_sustain: 1, amp_release_ms: 2000,
      unison_voices: 3, unison_detune_cents: 18, lfo_rate_hz: 0.3, lfo_filter_oct: 0.3,
    },
  },
  {
    name: 'Brass',
    category: 'Lead',
    description: 'Two saws, filter envelope with a slight attack "blat".',
    params: {
      osc2_waveform: 0, osc2_level: 0.8, osc2_detune_cents: 6, filter_cutoff_hz: 700, filter_resonance: 0.12,
      filter_env_amount_oct: 2.6, filter_env_attack_ms: 60, filter_env_decay_ms: 500, filter_env_sustain: 0.55,
      amp_attack_ms: 25, amp_sustain: 0.9, amp_release_ms: 180, filter_velocity_amount: 0.6, modwheel_vibrato_cents: 25,
    },
  },
  {
    name: 'Organ',
    category: 'Keys',
    description: 'Square + octave-up square + sub, gate envelope, LFO tremolo.',
    params: {
      master_volume_db: -9,
      osc1_waveform: 1, osc2_waveform: 1, osc2_transpose_cents: 1200, osc2_detune_cents: 0, osc2_level: 0.45,
      sub_osc_level: 0.4, filter_cutoff_hz: 4500, filter_resonance: 0, filter_env_amount_oct: 0, amp_attack_ms: 4,
      amp_decay_ms: 50, amp_sustain: 1, amp_release_ms: 40, amp_velocity_amount: 0, lfo_rate_hz: 6.5, lfo_amp: 0.18,
    },
  },
  {
    name: 'Wobble Bass',
    category: 'Bass',
    description: 'Saw + sub through a resonant low-pass swept by a triangle LFO.',
    params: {
      osc2_waveform: 0, osc2_level: 0.6, osc2_detune_cents: 12, sub_osc_level: 0.5, filter_cutoff_hz: 260,
      filter_resonance: 0.6, filter_env_amount_oct: 0, filter_drive: 0.5, lfo_waveform: 1, lfo_rate_hz: 3,
      lfo_filter_oct: 2.6, amp_attack_ms: 2, amp_sustain: 1, amp_release_ms: 60, voice_count: 1,
    },
  },
  {
    name: 'Noise Sweep FX',
    category: 'FX',
    description: 'Band-passed noise riser; hold a note and let the filter envelope rise.',
    params: {
      master_volume_db: 0,
      osc1_level: 0, osc2_level: 0, noise_level: 0.9, filter_mode: 2, filter_cutoff_hz: 300, filter_resonance: 0.55,
      filter_env_amount_oct: 5, filter_env_attack_ms: 3000, filter_env_sustain: 1, filter_env_release_ms: 1500,
      amp_attack_ms: 800, amp_sustain: 1, amp_release_ms: 1500, filter_key_tracking: 0,
    },
  },
  {
    name: 'Sample & Hold Blips',
    category: 'FX',
    description: 'Random filter steps from the S&H LFO over a resonant pulse.',
    params: {
      osc1_waveform: 1, osc1_pulse_width: 0.3, osc2_level: 0, filter_cutoff_hz: 1200, filter_resonance: 0.7,
      filter_env_amount_oct: 0, lfo_waveform: 4, lfo_rate_hz: 8, lfo_filter_oct: 2.2, amp_sustain: 1, amp_release_ms: 300,
    },
  },
];
