// Built-in drum kits. Same format as synth presets: only values that differ from the defaults.

/** @type {import('./synth.js').Preset[]} */
export const DRUM_PRESETS = [
  {
    name: 'AmiSynth Default',
    category: 'Kit',
    description: 'Balanced all-round analog-style kit.',
    params: { drum_master_volume_db: -5.3 },
  },
  {
    name: '808-ish',
    category: 'Kit',
    description: 'Long boomy kick, soft snare, metallic hats, classic cowbell.',
    params: {
      drum_master_volume_db: -5.6,
      kick_pitch_hz: 46, kick_decay_ms: 1300, kick_sweep_oct: 1.4, kick_sweep_ms: 60, kick_tone: 0.05,
      snare_pitch_hz: 175, snare_snappy: 0.45, snare_tone: 0.35, snare_decay_ms: 200,
      closed_hat_metal_mix: 0.9, open_hat_metal_mix: 0.9, closed_hat_decay_ms: 45, open_hat_decay_ms: 650,
      clap_spread_ms: 9, clap_decay_ms: 380, cowbell_level_db: -5, low_tom_decay_ms: 700, mid_tom_decay_ms: 650,
      high_tom_decay_ms: 600, low_tom_tone: 0.15, mid_tom_tone: 0.15, high_tom_tone: 0.15,
    },
  },
  {
    name: '909-ish',
    category: 'Kit',
    description: 'Punchy kick with a click, bright snappy snare, noisy hats.',
    params: {
      drum_master_volume_db: -6.5,
      kick_pitch_hz: 55, kick_decay_ms: 380, kick_sweep_oct: 3, kick_sweep_ms: 18, kick_tone: 0.75,
      snare_pitch_hz: 220, snare_snappy: 0.75, snare_tone: 0.7, snare_decay_ms: 170,
      closed_hat_metal_mix: 0.3, open_hat_metal_mix: 0.3, closed_hat_tone: 0.7, open_hat_tone: 0.65,
      crash_metal_mix: 0.2, ride_metal_mix: 0.7, clap_decay_ms: 250, low_tom_tone: 0.6, mid_tom_tone: 0.6, high_tom_tone: 0.6,
    },
  },
  {
    name: 'Tight Lo-fi',
    category: 'Kit',
    description: 'Short, dry and dark: everything decays fast.',
    params: {
      kick_decay_ms: 220, kick_tone: 0.5, snare_decay_ms: 110, snare_tone: 0.2, clap_decay_ms: 120,
      closed_hat_decay_ms: 30, open_hat_decay_ms: 220, closed_hat_tone: 0.2, open_hat_tone: 0.2,
      crash_decay_ms: 700, ride_decay_ms: 900, low_tom_decay_ms: 250, mid_tom_decay_ms: 230, high_tom_decay_ms: 210,
      shaker_decay_ms: 40, drum_master_volume_db: -3.8,
    },
  },
  {
    name: 'Electro Big Room',
    category: 'Kit',
    description: 'Huge distorted kick, wide clap, long cymbals.',
    params: {
      kick_pitch_hz: 52, kick_decay_ms: 700, kick_sweep_oct: 3.8, kick_sweep_ms: 25, kick_tone: 1,
      clap_level_db: 0, clap_decay_ms: 600, clap_spread_ms: 14, clap_tone: 0.25, clap_pan: 0,
      snare_level_db: -6, crash_decay_ms: 3500, crash_level_db: -6, open_hat_decay_ms: 900,
      closed_hat_pan: -0.5, open_hat_pan: 0.5, drum_master_volume_db: -8.4,
    },
  },
  {
    name: 'Dry House', category: 'Kit',
    description: 'Compact four-on-the-floor kick, crisp snare/clap and short hats; leaves room for a bass line.',
    params: {
      drum_master_volume_db: -4.3, kick_pitch_hz: 55, kick_decay_ms: 240, kick_sweep_oct: 2.6,
      kick_sweep_ms: 20, kick_tone: 0.55, snare_pitch_hz: 205, snare_decay_ms: 140,
      snare_snappy: 0.7, snare_tone: 0.6, clap_decay_ms: 170, clap_spread_ms: 7,
      closed_hat_decay_ms: 35, closed_hat_tone: 0.65, open_hat_decay_ms: 280,
      open_hat_tone: 0.6, crash_decay_ms: 1000, ride_decay_ms: 1100,
      low_tom_decay_ms: 230, mid_tom_decay_ms: 200, high_tom_decay_ms: 180,
    },
  },
  {
    name: 'Synthwave Arena', category: 'Kit',
    description: 'Deep electronic kick, broad snare/clap and ringing toms for retro pop. Synthesized tails, no gated reverb.',
    params: {
      drum_master_volume_db: -5.8, kick_pitch_hz: 48, kick_decay_ms: 500, kick_sweep_oct: 2.4,
      kick_sweep_ms: 32, kick_tone: 0.4, snare_pitch_hz: 185, snare_decay_ms: 340,
      snare_snappy: 0.8, snare_tone: 0.45, clap_spread_ms: 12, clap_decay_ms: 430,
      closed_hat_decay_ms: 60, closed_hat_metal_mix: 0.65, open_hat_decay_ms: 600,
      crash_decay_ms: 2400, ride_decay_ms: 2000, low_tom_decay_ms: 850,
      mid_tom_decay_ms: 650, high_tom_decay_ms: 480, low_tom_tone: 0.3, mid_tom_tone: 0.35, high_tom_tone: 0.4,
    },
  },
  {
    name: 'Soft Percussion', category: 'Kit',
    description: 'Rounded kick, dry rim and subdued cymbals with forward shaker/toms; useful for sparse arrangements.',
    params: {
      drum_master_volume_db: -0.1, kick_pitch_hz: 62, kick_decay_ms: 180, kick_sweep_oct: 1.2,
      kick_tone: 0.15, snare_snappy: 0.35, snare_tone: 0.25, snare_decay_ms: 120,
      rimshot_level_db: -2, rimshot_decay_ms: 65, closed_hat_tone: 0.3, closed_hat_level_db: -14,
      open_hat_decay_ms: 240, open_hat_level_db: -16, crash_level_db: -18, ride_level_db: -16,
      shaker_level_db: -3, shaker_decay_ms: 110, cowbell_level_db: -12, clap_level_db: -12,
      low_tom_decay_ms: 400, mid_tom_decay_ms: 320, high_tom_decay_ms: 240,
    },
  },
];
