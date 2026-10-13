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
];
