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
    params: { master_volume_db: -9.6 },
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
      master_volume_db: -8.4,
      osc1_waveform: 3, osc1_level: 0.9, osc2_level: 0, sub_osc_level: 0.45, filter_cutoff_hz: 600, filter_resonance: 0,
      filter_env_amount_oct: 0.5, amp_attack_ms: 2, amp_sustain: 1, amp_release_ms: 80, voice_count: 1, glide_ms: 25,
    },
  },
  {
    name: 'Pluck',
    category: 'Keys',
    description: 'Short decaying saw/pulse pluck for arpeggios.',
    params: {
      master_volume_db: 2.2,
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
      master_volume_db: -9,
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
      master_volume_db: -4.2,
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
      master_volume_db: -10.4,
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
      master_volume_db: -7,
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
      master_volume_db: -8.9,
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
      master_volume_db: -13.7,
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
      master_volume_db: -9.4,
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
      master_volume_db: -9.8,
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
      master_volume_db: -15.7,
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
      master_volume_db: -5.6,
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
      master_volume_db: -14.4,
      osc1_waveform: 1, osc1_pulse_width: 0.3, osc2_level: 0, filter_cutoff_hz: 1200, filter_resonance: 0.7,
      filter_env_amount_oct: 0, lfo_waveform: 4, lfo_rate_hz: 8, lfo_filter_oct: 2.2, amp_sustain: 1, amp_release_ms: 300,
    },
  },
  {
    name: 'Hyper Saw',
    category: 'Lead',
    description: '7 unison saws bunched around the centre pitch (supersaw), quieter outer copies, wide stereo.',
    params: {
      master_volume_db: -10,
      osc2_waveform: 0, osc2_level: 0.6, osc2_detune_cents: -6, unison_voices: 7, unison_detune_cents: 45,
      unison_detune_curve: 0.6, unison_side_level: 0.75, unison_stereo_width: 1, filter_cutoff_hz: 5000,
      filter_resonance: 0.1, filter_env_amount_oct: 1, filter_env_sustain: 0.6, amp_attack_ms: 3, amp_sustain: 0.9,
      amp_release_ms: 260, voice_count: 6,
    },
  },
  {
    name: 'Eurobeat Arp',
    category: 'Arp',
    description: 'Hold a chord: 1/16 up-arpeggio over 2 octaves in time with the host tempo. Short bright pluck.',
    params: {
      master_volume_db: -0.4,
      osc2_waveform: 0, osc2_level: 0.5, osc2_detune_cents: 9, filter_cutoff_hz: 900, filter_resonance: 0.3,
      filter_env_amount_oct: 4, filter_env_attack_ms: 1, filter_env_decay_ms: 160, filter_env_sustain: 0,
      amp_attack_ms: 1, amp_decay_ms: 220, amp_sustain: 0.2, amp_release_ms: 80,
      arp_mode: 1, arp_rate: 4, arp_octaves: 2, arp_gate: 0.6,
    },
  },
  {
    name: 'Off-beat Stabs',
    category: 'Arp',
    description: 'Hold a chord: the Chord arpeggiator plays it on the 8th-note off-beats (rhythm gate), detuned saws.',
    params: {
      master_volume_db: -0.8,
      osc2_waveform: 0, osc2_level: 0.7, osc2_detune_cents: 12, unison_voices: 3, unison_detune_cents: 20,
      filter_cutoff_hz: 1500, filter_resonance: 0.2, filter_env_amount_oct: 2.5, filter_env_attack_ms: 1,
      filter_env_decay_ms: 250, filter_env_sustain: 0.1, amp_attack_ms: 1, amp_decay_ms: 300, amp_sustain: 0.4,
      amp_release_ms: 90, arp_mode: 6, arp_rate: 1, arp_gate: 0.45, arp_steps: 2, arp_step_1: 0,
    },
  },
  {
    name: 'Pumping Pad',
    category: 'Pad',
    description: 'Wide saw pad that ducks on every beat (synced Duck LFO on the volume), like a kick sidechain.',
    params: {
      master_volume_db: -8.8,
      osc2_waveform: 0, osc2_level: 0.7, unison_voices: 5, unison_detune_cents: 25, unison_stereo_width: 1,
      filter_cutoff_hz: 2200, filter_resonance: 0.1, filter_env_amount_oct: 0.5, amp_attack_ms: 150, amp_sustain: 1,
      amp_release_ms: 900, lfo_waveform: 5, lfo_sync: 7, lfo_amp: 0.85,
    },
  },
  {
    name: 'Octave Legato Bass',
    category: 'Bass',
    description: 'Mono legato saw bass: overlapping notes slide without restarting the envelope (glide only when legato).',
    params: {
      master_volume_db: -9,
      osc2_waveform: 1, osc2_level: 0.5, osc2_detune_cents: 4, sub_osc_level: 0.3, filter_cutoff_hz: 500,
      filter_resonance: 0.35, filter_env_amount_oct: 3, filter_env_attack_ms: 1, filter_env_decay_ms: 200,
      filter_env_sustain: 0.2, amp_attack_ms: 1, amp_sustain: 0.9, amp_release_ms: 60,
      voice_mode: 2, glide_ms: 45, glide_mode: 1,
    },
  },
  {
    name: 'Chip Noise Drum',
    category: 'FX',
    description: '8-bit console style shift-register noise, short decay: pitch the note for hats (high) or snares (low).',
    params: {
      master_volume_db: 0.2,
      osc1_level: 0, osc2_level: 0, noise_level: 1, noise_type: 1, noise_clock_oct: 1, filter_cutoff_hz: 20000,
      filter_resonance: 0, filter_env_amount_oct: 0, filter_key_tracking: 0, amp_attack_ms: 0.5, amp_decay_ms: 120,
      amp_sustain: 0, amp_release_ms: 60, amp_velocity_amount: 0.4,
    },
  },
  {
    name: 'Chip Metal Noise',
    category: 'FX',
    description: 'Short-mode shift-register noise: a buzzy, metallic tone at the note pitch (8-bit bells, laser zaps).',
    params: {
      master_volume_db: -4.6,
      osc1_level: 0, osc2_level: 0, noise_level: 1, noise_type: 2, filter_cutoff_hz: 9000, filter_resonance: 0.1,
      filter_env_amount_oct: 0, amp_attack_ms: 0.5, amp_decay_ms: 400, amp_sustain: 0.3, amp_release_ms: 120,
    },
  },
  {
    name: 'Rubber Mono Bass', category: 'Bass',
    description: 'Rounded pulse/sub bass with a quick resonant envelope. Detached notes punch; overlaps slide.',
    params: {
      master_volume_db: -0.9, osc1_waveform: 1, osc1_pulse_width: 0.42, osc2_level: 0, sub_osc_level: 0.35,
      filter_cutoff_hz: 180, filter_resonance: 0.48, filter_env_amount_oct: 3.5, filter_env_attack_ms: 1,
      filter_env_decay_ms: 140, filter_env_sustain: 0, filter_drive: 0.15, amp_attack_ms: 1,
      amp_decay_ms: 260, amp_sustain: 0.6, amp_release_ms: 50, voice_mode: 1, glide_ms: 65, glide_mode: 1,
    },
  },
  {
    name: 'Reese Bass', category: 'Bass',
    description: 'Detuned saw pair with a sub foundation and slow filter movement. Play single low notes.',
    params: {
      master_volume_db: -6.2, osc2_waveform: 0, osc2_level: 0.8, osc2_detune_cents: -18, sub_osc_level: 0.25,
      unison_voices: 3, unison_detune_cents: 22, unison_stereo_width: 0.45, filter_cutoff_hz: 650,
      filter_resonance: 0.18, filter_env_amount_oct: 0, filter_drive: 0.25, lfo_rate_hz: 0.18,
      lfo_filter_oct: 0.35, amp_attack_ms: 8, amp_sustain: 1, amp_release_ms: 100, voice_mode: 1,
    },
  },
  {
    name: 'Hollow Pulse Lead', category: 'Lead',
    description: 'Narrow pulse with triangle body and gentle PWM; mono legato for lyrical melodies.',
    params: {
      master_volume_db: -7.9, osc1_waveform: 1, osc1_pulse_width: 0.22, osc2_waveform: 2,
      osc2_level: 0.35, osc2_detune_cents: 3, filter_cutoff_hz: 3800, filter_resonance: 0.15,
      filter_env_amount_oct: 0.7, lfo_rate_hz: 4.8, lfo_pulse_width: 0.08, modwheel_vibrato_cents: 45,
      amp_attack_ms: 12, amp_sustain: 0.85, amp_release_ms: 160, voice_mode: 2, glide_ms: 75, glide_mode: 1,
    },
  },
  {
    name: 'Soft Sine Lead', category: 'Lead',
    description: 'Pure sine with a faint octave overtone, slow legato slides and mod-wheel vibrato.',
    params: {
      master_volume_db: -9.3, osc1_waveform: 3, osc1_level: 1, osc2_waveform: 3, osc2_level: 0.12,
      osc2_transpose_cents: 1200, osc2_detune_cents: 0, filter_cutoff_hz: 6000, filter_resonance: 0,
      filter_env_amount_oct: 0, amp_attack_ms: 15, amp_sustain: 1, amp_release_ms: 220,
      voice_mode: 2, glide_ms: 110, glide_mode: 1, modwheel_vibrato_cents: 35,
    },
  },
  {
    name: 'Poly Chord Stab', category: 'Chord',
    description: 'Short saw/pulse chord hits without an arpeggiator. Use off-beat MIDI chords for house or pop.',
    params: {
      master_volume_db: 2.7, osc2_waveform: 1, osc2_pulse_width: 0.35, osc2_level: 0.55,
      unison_voices: 3, unison_detune_cents: 14, unison_stereo_width: 0.8, filter_cutoff_hz: 700,
      filter_resonance: 0.2, filter_env_amount_oct: 3, filter_env_attack_ms: 1, filter_env_decay_ms: 180,
      filter_env_sustain: 0, amp_attack_ms: 1, amp_decay_ms: 340, amp_sustain: 0.08, amp_release_ms: 90,
    },
  },
  {
    name: 'Slow Chord Wash', category: 'Pad',
    description: 'Soft triangle/pulse layers, rising filter and subtle stereo drift. Release before the next large chord.',
    params: {
      master_volume_db: -10.3, osc1_waveform: 2, osc2_waveform: 1, osc2_pulse_width: 0.4, osc2_level: 0.45,
      unison_voices: 4, unison_detune_cents: 11, unison_stereo_width: 1, filter_cutoff_hz: 1100,
      filter_resonance: 0.08, filter_env_amount_oct: 1.4, filter_env_attack_ms: 1100,
      filter_env_decay_ms: 2200, filter_env_sustain: 0.6, filter_env_release_ms: 1800,
      amp_attack_ms: 650, amp_sustain: 0.9, amp_release_ms: 1600, lfo_rate_hz: 0.22, lfo_pulse_width: 0.12,
    },
  },
  {
    name: 'Glass Pluck', category: 'Keys',
    description: 'Octave-ratio sine FM with a short glassy transient; play individual notes or small chords.',
    params: {
      master_volume_db: -1.8, osc1_waveform: 3, osc1_level: 1, osc2_waveform: 3, osc2_level: 0,
      osc2_transpose_cents: 1200, osc2_detune_cents: 0, fm_index: 1.8, filter_cutoff_hz: 10000,
      filter_resonance: 0, filter_env_amount_oct: 0, amp_attack_ms: 1, amp_decay_ms: 650,
      amp_sustain: 0, amp_release_ms: 260, amp_velocity_amount: 0.9,
    },
  },
  {
    name: 'Dusty Keys', category: 'Keys',
    description: 'Dark triangle/pulse keys with a little filtered noise and slow pitch wobble. No samples or bit crusher.',
    params: {
      master_volume_db: -2.3, osc1_waveform: 2, osc2_waveform: 1, osc2_level: 0.18, osc2_detune_cents: -5,
      noise_level: 0.025, noise_filter_mode: 1, noise_filter_hz: 1200, filter_cutoff_hz: 1300,
      filter_resonance: 0.12, filter_env_amount_oct: 0.6, filter_env_decay_ms: 450,
      amp_attack_ms: 6, amp_decay_ms: 1300, amp_sustain: 0.25, amp_release_ms: 350,
      lfo_rate_hz: 0.7, lfo_pitch_cents: 5,
    },
  },
  {
    name: 'Triplet Cascade', category: 'Arp',
    description: 'Hold a chord for a descending two-octave triplet arpeggio; short pulse/triangle plucks.',
    params: {
      master_volume_db: -3.8, osc1_waveform: 1, osc1_pulse_width: 0.3, osc2_waveform: 2, osc2_level: 0.4,
      filter_cutoff_hz: 1400, filter_resonance: 0.22, filter_env_amount_oct: 2,
      filter_env_attack_ms: 1, filter_env_decay_ms: 120, filter_env_sustain: 0,
      amp_attack_ms: 1, amp_decay_ms: 210, amp_sustain: 0.1, amp_release_ms: 60,
      arp_mode: 2, arp_rate: 5, arp_octaves: 2, arp_gate: 0.55,
    },
  },
  {
    name: 'Rhythmic Steps', category: 'Arp',
    description: 'Hold a chord for a swung, five-step up/down pattern with a rest on step 3. Follows host tempo.',
    params: {
      master_volume_db: 2.3, osc2_waveform: 0, osc2_level: 0.35, filter_cutoff_hz: 850,
      filter_resonance: 0.4, filter_env_amount_oct: 2.8, filter_env_attack_ms: 1,
      filter_env_decay_ms: 110, filter_env_sustain: 0, amp_attack_ms: 1, amp_decay_ms: 200,
      amp_sustain: 0.15, amp_release_ms: 50, arp_mode: 3, arp_rate: 4, arp_octaves: 2,
      arp_gate: 0.5, arp_swing_percent: 60, arp_steps: 5, arp_step_3: 0,
    },
  },
  {
    name: 'Pressure Pad', category: 'Pad',
    description: 'Slow saw pad that opens and shimmers as you press into the keys (aftertouch -> cutoff and vibrato speed); LFO 2 drifts it across the stereo field, each note a little detuned at random.',
    params: {
      master_volume_db: -7.9, osc2_waveform: 0, osc2_level: 0.7, osc2_detune_cents: 9, filter_cutoff_hz: 650,
      filter_resonance: 0.2, filter_env_amount_oct: 0.8, filter_env_attack_ms: 600, filter_env_decay_ms: 1500,
      filter_env_sustain: 0.5, amp_attack_ms: 450, amp_decay_ms: 2000, amp_sustain: 0.85, amp_release_ms: 1400,
      lfo_rate_hz: 4.5, lfo_pitch_cents: 6, lfo2_waveform: 1, lfo2_rate_hz: 0.13,
      mod1_source: 7, mod1_destination: 2, mod1_amount: 2.5,
      mod2_source: 7, mod2_destination: 9, mod2_amount: 1,
      mod3_source: 2, mod3_destination: 8, mod3_amount: 0.6,
      mod4_source: 8, mod4_destination: 5, mod4_amount: 8,
    },
  },
  {
    name: 'Sync Sweep Lead', category: 'Lead',
    description: 'Hard-sync lead whose sync sweep comes from the mod envelope; harder notes open the filter, aftertouch pushes the sync pitch higher (screams).',
    params: {
      master_volume_db: -6.6, osc1_waveform: 0, osc2_waveform: 0, osc2_level: 0.8, osc1_level: 0.3, osc2_detune_cents: 0,
      osc2_hard_sync: 1, filter_cutoff_hz: 2200, filter_resonance: 0.25, filter_env_amount_oct: 1,
      amp_attack_ms: 2, amp_sustain: 0.9, amp_release_ms: 180, voice_mode: 2, glide_ms: 35,
      mod_env_attack_ms: 1, mod_env_decay_ms: 450, mod_env_sustain: 0.25, mod_env_release_ms: 300,
      mod1_source: 3, mod1_destination: 5, mod1_amount: 2400,
      mod2_source: 4, mod2_destination: 2, mod2_amount: 1.5,
      mod3_source: 7, mod3_destination: 5, mod3_amount: 1200,
    },
  },
  {
    name: 'Tempo Wobble Bass', category: 'Bass',
    description: 'LFO 2 locked to 1/8 notes sweeps the cutoff (dubstep-style wobble, follows the host tempo); aftertouch adds resonance, the mod wheel adds a second, faster filter wobble from LFO 1.',
    params: {
      master_volume_db: -5.8, osc2_waveform: 0, osc2_level: 0.6, osc2_transpose_cents: -1200, osc2_detune_cents: 4,
      sub_osc_level: 0.4, filter_cutoff_hz: 300, filter_resonance: 0.45, filter_env_amount_oct: 0.5,
      filter_drive: 0.3, filter_key_tracking: 0.3, amp_attack_ms: 2, amp_sustain: 1, amp_release_ms: 90, voice_count: 1,
      lfo_rate_hz: 9, modwheel_vibrato_cents: 0, modwheel_filter_oct: 1.5,
      lfo2_waveform: 0, lfo2_sync: 10,
      mod1_source: 2, mod1_destination: 2, mod1_amount: 2.5,
      mod2_source: 7, mod2_destination: 3, mod2_amount: 0.35,
    },
  },
  {
    name: 'Scatter Pluck', category: 'Keys',
    description: 'Every note gets its own random pan position and brightness, and a quick pitch blip from the mod envelope at the attack: lively plucked chords.',
    params: {
      master_volume_db: -0.2, osc2_waveform: 2, osc2_level: 0.5, osc2_transpose_cents: 1200, filter_cutoff_hz: 700,
      filter_resonance: 0.3, filter_env_amount_oct: 3.5, filter_env_attack_ms: 1, filter_env_decay_ms: 250,
      filter_env_sustain: 0, amp_attack_ms: 1, amp_decay_ms: 700, amp_sustain: 0, amp_release_ms: 300,
      mod_env_attack_ms: 0.5, mod_env_decay_ms: 40, mod_env_sustain: 0,
      mod1_source: 8, mod1_destination: 8, mod1_amount: 0.8,
      mod2_source: 8, mod2_destination: 2, mod2_amount: 0.8,
      mod3_source: 3, mod3_destination: 1, mod3_amount: 150,
    },
  },
];
