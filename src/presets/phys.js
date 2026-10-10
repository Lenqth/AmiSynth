// Built-in presets for the physical model instrument (diffs from the defaults).

/** @type {import('./synth.js').Preset[]} */
export const PHYS_PRESETS = [
  { name: 'Nylon Guitar', category: 'String', description: 'Soft plucked string: strong loop damping, warm pick, plucked away from the bridge.',
    params: { phys_model: 0, string_excitation: 0, string_decay_ms: 3500, string_damping: 0.55, string_pick_position: 0.2, string_brightness: 0.45 } },
  { name: 'Steel String', category: 'String', description: 'Bright, long-sustaining steel string picked near the bridge.',
    params: { phys_model: 0, string_excitation: 0, string_decay_ms: 6000, string_damping: 0.15, string_pick_position: 0.12, string_brightness: 0.85, phys_release_ms: 800 } },
  { name: 'Harp', category: 'String', description: 'Plucked near the middle (fewer even harmonics), rings on after release.',
    params: { phys_model: 0, string_excitation: 0, string_decay_ms: 7000, string_damping: 0.35, string_pick_position: 0.32, string_brightness: 0.5, phys_release_ms: 3000 } },
  { name: 'Koto-ish', category: 'String', description: 'Plucked very close to the bridge with a hard pick: thin and twangy.',
    params: { phys_model: 0, string_excitation: 0, string_decay_ms: 2500, string_damping: 0.25, string_pick_position: 0.06, string_brightness: 0.95, phys_release_ms: 1200 } },
  { name: 'Hammered Dulcimer', category: 'String', description: 'Hammer pulse instead of a noise burst, long ring.',
    params: { phys_model: 0, string_excitation: 1, string_decay_ms: 5000, string_damping: 0.25, string_pick_position: 0.1, string_brightness: 0.8, phys_release_ms: 3000 } },
  { name: 'Marimba', category: 'Mallet', description: 'Tuned bar (modes ~1 : 3.9 : 9.2), soft-ish mallet, high modes die quickly.',
    params: { phys_model: 1, modal_material: 0, modal_decay_ms: 900, modal_high_damping: 0.6, modal_hardness: 0.4, modal_strike_position: 0.22 } },
  { name: 'Vibraphone', category: 'Mallet', description: 'Metal bar tuned 1 : 4 : 10 with a long sustain.',
    params: { phys_model: 1, modal_material: 1, modal_decay_ms: 4000, modal_high_damping: 0.5, modal_hardness: 0.55, phys_release_ms: 2500 } },
  { name: 'Glockenspiel', category: 'Mallet', description: 'Untuned free bar (1 : 2.76 : 5.40): the classic inharmonic shimmer.',
    params: { phys_model: 1, modal_material: 2, modal_decay_ms: 3000, modal_high_damping: 0.2, modal_hardness: 0.85, phys_release_ms: 2000 } },
  { name: 'Wine Glass', category: 'Mallet', description: 'Glass modes, very little high damping, gently struck.',
    params: { phys_model: 1, modal_material: 3, modal_decay_ms: 6000, modal_high_damping: 0.2, modal_hardness: 0.7, phys_release_ms: 4000 } },
  { name: 'Church Bell', category: 'Mallet', description: 'Hum / prime / tierce / quint / nominal partials, very long decay.',
    params: { phys_model: 1, modal_material: 4, modal_decay_ms: 9000, modal_high_damping: 0.1, modal_hardness: 0.9, phys_release_ms: 9000 } },
  { name: 'Kalimba', category: 'Mallet', description: 'Plucked tine: strong fundamental, one high partial (~5.9x).',
    params: { phys_model: 1, modal_material: 7, modal_decay_ms: 1800, modal_high_damping: 0.6, modal_hardness: 0.6, phys_release_ms: 1500 } },
  { name: 'Hand Drum', category: 'Percussion', description: 'Circular membrane modes (1 : 1.59 : 2.14 ...), short decay.',
    params: { phys_model: 1, modal_material: 5, modal_decay_ms: 450, modal_high_damping: 0.7, modal_hardness: 0.5, modal_strike_position: 0.3, phys_release_ms: 450 } },
];
