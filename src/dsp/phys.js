// AmiSynth physical-modelling instrument (8 voices).
// Same JSFX-style structure as synth.js: phys_init / phys_update / phys_note_on/off / phys_render.
//
// Model 0 - String (extended Karplus-Strong)
//   A delay line of length ~ sr / f is filled with an excitation (noise burst = pluck,
//   smooth pulse = hammer). Every sample the oldest value is read, low-passed (damping)
//   and scaled (decay), then written back. The loop round-trip time sets the pitch;
//   high harmonics lose more energy per trip than low ones, as on a real string.
//   The pick position is a comb filter on the excitation: modes with a node at the
//   pick point are not excited (pluck at 1/2 -> no even harmonics).
//
// Model 1 - Modal
//   An object's vibration is a sum of decaying sinusoids (modes) with fixed frequency
//   ratios. Each mode is a two-pole resonator; a short raised-cosine "mallet" pulse
//   strikes all of them. A short pulse (hard mallet) contains high frequencies and
//   excites the upper modes; a long one (soft mallet) mostly the lowest. The contact
//   time scales with the period, so the timbre stays similar across the range.

import {
  clamp, db_to_gain, delay_clear, delay_init, delay_read, delay_write, noise_white,
  onepole_hp, onepole_init, onepole_set, pan_gains, reson_init, reson_process, reson_reset,
  reson_set, reson_set_decay, soft_clip, t60_coef, tuning_init, tuning_note_to_hz, tuning_set_edo,
  tuning_set_table, TWO_PI,
} from './lib.js';

export const PHYS_MAX_VOICES = 8;
export const MAX_MODES = 8;
const MAX_DELAY = 8192;

/** ratios: frequency / fundamental; gains: relative excitation; (values are textbook approximations) */
export const MATERIALS = [
  { name: 'Marimba Bar', ratios: [1, 3.93, 9.17, 15.3, 22.6, 30.7, 39.6, 49.4], gains: [1, 0.55, 0.25, 0.12, 0.06, 0.04, 0.03, 0.02] },
  { name: 'Vibraphone Bar', ratios: [1, 4, 10, 17.6, 26.3, 35.9, 46.3, 57.4], gains: [1, 0.45, 0.22, 0.1, 0.05, 0.03, 0.02, 0.01] },
  { name: 'Glockenspiel (free bar)', ratios: [1, 2.756, 5.404, 8.933, 13.345, 18.638, 24.813, 31.87], gains: [1, 0.7, 0.45, 0.3, 0.2, 0.12, 0.08, 0.05] },
  { name: 'Wine Glass', ratios: [1, 2.32, 4.25, 6.63, 9.38, 12.5, 16, 19.8], gains: [1, 0.5, 0.25, 0.15, 0.08, 0.05, 0.03, 0.02] },
  { name: 'Church Bell', ratios: [0.5, 1, 1.183, 1.506, 2, 2.514, 2.662, 3.011], gains: [0.6, 0.8, 0.7, 0.4, 1, 0.5, 0.45, 0.35] },
  { name: 'Drum Membrane', ratios: [1, 1.593, 2.136, 2.296, 2.653, 2.918, 3.156, 3.501], gains: [1, 0.7, 0.55, 0.5, 0.4, 0.35, 0.3, 0.25] },
  { name: 'Harmonic (string-like)', ratios: [1, 2, 3, 4, 5, 6, 7, 8], gains: [1, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12] },
  { name: 'Kalimba Tine', ratios: [1, 5.93, 13.0, 21.9, 32.6, 45.2, 59.6, 75.8], gains: [1, 0.35, 0.12, 0.05, 0.03, 0.02, 0.01, 0.01] },
];

function voice_create() {
  const v = {
    active: 0, note: -1, gate: 0, age: 0, vel: 0, hz: 0, level: 0, frames: 0,
    // string
    line: {}, lp_z: 0, loop_gain: 1, damp_b: 0, delay_len: 0, read_gain: 1,
    // modal
    modes: [], mode_hz: new Float64Array(MAX_MODES), mode_t60: new Float64Array(MAX_MODES),
    exc_t: 0, exc_len: 1,
    gl: 1, gr: 1,
  };
  delay_init(v.line, MAX_DELAY);
  for (let k = 0; k < MAX_MODES; k++) {
    v.modes.push({});
    reson_init(v.modes[k]);
  }
  return v;
}

export function phys_init(s, sr) {
  s.sr = sr;
  s.voices = [];
  for (let i = 0; i < PHYS_MAX_VOICES; i++) s.voices.push(voice_create());
  s.tuning = {};
  tuning_init(s.tuning);
  s.custom_scale = 0;
  s.age_counter = 0;
  s.bend_ratio = 1;
  s.dc = {};
  onepole_init(s.dc);
  onepole_set(s.dc, 20, sr);
  s.dc_r = {};
  onepole_init(s.dc_r);
  onepole_set(s.dc_r, 20, sr);
  s.level_coef = t60_coef(300, sr);
  s.last_voice = -1;
  s.p = {};
  s.out_l = 0;
  s.out_r = 0;
}

export function phys_update(s, p) {
  s.p = p;
  if (!s.custom_scale) tuning_set_edo(s.tuning, p.tuning_divisions, p.tuning_period_cents);
  s.tuning.ref_note = p.tuning_ref_note;
  s.tuning.ref_hz = p.tuning_ref_hz;
  s.gain = db_to_gain(p.phys_volume_db);
  s.damp_b = 0.05 + 0.9 * p.string_damping; // one-pole coefficient in the loop
}

export function phys_set_scale(s, cents_list, count) {
  if (count > 0) {
    tuning_set_table(s.tuning, cents_list, count);
    s.custom_scale = 1;
  } else {
    s.custom_scale = 0;
  }
  phys_update(s, s.p);
}

/** Phase delay (samples) of the loop low-pass y = (1-b)x + b*y1 at frequency hz. */
function lp_phase_delay(b, hz, sr) {
  const w = (TWO_PI * hz) / sr;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

/** (Re)compute pitch dependent coefficients of a voice. */
function voice_tune(s, v, keep_decay) {
  const p = s.p;
  const sr = s.sr;
  const hz = v.hz * s.bend_ratio;
  if (p.phys_model < 0.5) {
    // total loop delay = sr/hz = delay line + phase delay of the low-pass
    const b = s.damp_b;
    v.damp_b = b;
    v.delay_len = clamp(sr / hz - lp_phase_delay(b, hz, sr), 2, MAX_DELAY - 2);
    if (!keep_decay) v.loop_gain = Math.exp(-6.907755 / (hz * Math.max(p.string_decay_ms, 1) * 0.001));
  } else {
    const mat = MATERIALS[clamp(Math.round(p.modal_material), 0, MATERIALS.length - 1)];
    for (let k = 0; k < MAX_MODES; k++) {
      // stretch: ratio^(1+x) bends the series away from / toward harmonic
      const ratio = Math.pow(mat.ratios[k], 1 + p.modal_inharmonicity);
      v.mode_hz[k] = hz * ratio;
      if (!keep_decay) v.mode_t60[k] = p.modal_decay_ms / (1 + p.modal_high_damping * 4 * (ratio - 1));
      const pos_w = Math.abs(Math.sin(Math.PI * (k + 1) * p.modal_strike_position));
      reson_set(v.modes[k], v.mode_hz[k], v.mode_t60[k], mat.gains[k] * (0.3 + 0.7 * pos_w), sr);
    }
  }
}

function voice_allocate(s) {
  let best = 0;
  let best_score = -1;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) return i;
    const score = (v.gate ? 0 : 1e12) + (s.age_counter - v.age);
    if (score > best_score) {
      best_score = score;
      best = i;
    }
  }
  return best;
}

export function phys_note_on(s, note, velocity) {
  if (velocity <= 0) {
    phys_note_off(s, note);
    return;
  }
  const p = s.p;
  const sr = s.sr;
  let idx = -1;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) if (s.voices[i].active && s.voices[i].note === note) idx = i;
  if (idx < 0) idx = voice_allocate(s);
  const v = s.voices[idx];
  const vel = velocity / 127;
  v.vel = 1 - p.phys_velocity_amount + p.phys_velocity_amount * vel;
  v.note = note;
  v.hz = tuning_note_to_hz(s.tuning, note);
  v.active = 1;
  v.gate = 1;
  v.age = ++s.age_counter;
  v.frames = 0;
  v.level = 1;
  pan_gains(v, clamp(((note - 60) / 36) * p.phys_stereo_width, -1, 1));
  s.last_voice = idx;
  voice_tune(s, v, false);

  if (p.phys_model < 0.5) {
    // Fill the delay line with the excitation (classic Karplus-Strong initialisation).
    delay_clear(v.line);
    v.lp_z = 0;
    const n = Math.ceil(v.delay_len);
    // brightness: one-pole low-pass on the noise, velocity makes it brighter
    const bright = clamp(p.string_brightness * (0.6 + 0.4 * vel), 0.02, 1);
    const a = bright * bright;
    const pick = Math.max(1, Math.round(p.string_pick_position * n));
    const norm = 1 / Math.sqrt(a / (2 - a)); // keep loudness independent of brightness
    let lp = 0;
    for (let i = 0; i < n; i++) {
      let x;
      if (p.string_excitation < 0.5) {
        lp += a * (noise_white() - lp);
        x = lp * norm * 0.5;
      } else {
        // hammer: raised-cosine pulse, narrower when brighter
        const width = Math.max(2, n * (0.5 - 0.45 * bright));
        x = i < width ? 0.5 - 0.5 * Math.cos((TWO_PI * i) / width) : 0;
      }
      delay_write(v.line, x);
    }
    // pick position comb: subtract the excitation delayed by the pick distance
    for (let i = n - 1; i >= pick; i--) {
      const idx_a = (v.line.w - n + i + v.line.size) % v.line.size;
      const idx_b = (v.line.w - n + i - pick + v.line.size) % v.line.size;
      v.line.buf[idx_a] -= v.line.buf[idx_b];
    }
    // high notes lose more energy per second (more round trips); compensate gently
    v.read_gain = 1.2 * v.vel * clamp(Math.pow(v.hz / 220, 0.3), 0.7, 2);
  } else {
    for (let k = 0; k < MAX_MODES; k++) reson_reset(v.modes[k]);
    // Contact time as a fraction of the fundamental period (smaller bars are hit for a
    // shorter time): soft mallet 0.6 period .. hard mallet 0.04 period. Velocity hardens it.
    const hard = clamp(p.modal_hardness * (0.7 + 0.3 * vel), 0, 1);
    v.exc_len = Math.max(2, Math.round((sr / v.hz) * (0.6 - 0.56 * hard)));
    v.exc_t = 0;
  }
}

export function phys_note_off(s, note) {
  const p = s.p;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active || !v.gate || v.note !== note) continue;
    v.gate = 0;
    if (p.phys_model < 0.5) {
      const g_rel = Math.exp(-6.907755 / (v.hz * p.phys_release_ms * 0.001));
      v.loop_gain = Math.min(v.loop_gain, g_rel);
    } else {
      for (let k = 0; k < MAX_MODES; k++) {
        v.mode_t60[k] = Math.min(v.mode_t60[k], p.phys_release_ms);
        reson_set_decay(v.modes[k], v.mode_hz[k], v.mode_t60[k], s.sr);
      }
    }
  }
}

export function phys_all_notes_off(s) {
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (v.active && v.gate) phys_note_off(s, v.note);
  }
}

/** value -1..1: retunes active voices (the delay length / resonator frequencies follow). */
export function phys_pitch_bend(s, value) {
  s.bend_ratio = Math.pow(2, (clamp(value, -1, 1) * s.p.phys_pitch_bend_range_cents) / 1200);
  for (let i = 0; i < PHYS_MAX_VOICES; i++) if (s.voices[i].active) voice_tune(s, s.voices[i], true);
}

export function phys_render(s) {
  const p = s.p;
  const string = p.phys_model < 0.5;
  let l = 0;
  let r = 0;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) continue;
    let y;
    if (string) {
      // read the oldest sample, damp it, feed it back
      const x = delay_read(v.line, v.delay_len);
      v.lp_z = (1 - v.damp_b) * x + v.damp_b * v.lp_z;
      const fb = v.lp_z * v.loop_gain;
      delay_write(v.line, fb);
      y = fb * v.read_gain;
    } else {
      let exc = 0;
      if (v.exc_t < v.exc_len) {
        // unit-area pulse: low modes get the full hit, modes above ~1/pulse-length are filtered out
        exc = ((0.5 - 0.5 * Math.cos((TWO_PI * v.exc_t) / v.exc_len)) * v.vel) / (0.5 * v.exc_len);
        v.exc_t++;
      }
      y = 0;
      for (let k = 0; k < MAX_MODES; k++) y += reson_process(v.modes[k], exc);
      y *= 1.6;
    }
    l += y * v.gl;
    r += y * v.gr;
    // voice ends once it has been quiet for a while
    const a = y < 0 ? -y : y;
    v.level = a > v.level ? a : v.level * s.level_coef;
    v.frames++;
    if (v.frames > 2000 && v.level < 0.00005) {
      v.active = 0;
      v.note = -1;
    }
  }
  const g = s.gain * 0.5;
  s.out_l = soft_clip(onepole_hp(s.dc, l) * g);
  s.out_r = soft_clip(onepole_hp(s.dc_r, r) * g);
}

/**
 * Visualisation snapshot of the most recently played voice (only built when the UI
 * asks for it, so it costs nothing otherwise). Not part of the JSFX port.
 */
export function phys_snapshot(s, points = 192) {
  const v = s.voices[s.last_voice];
  if (!v || !v.active) return { active: false, model: s.p.phys_model < 0.5 ? 'string' : 'modal' };
  if (s.p.phys_model < 0.5) {
    const n = Math.max(2, Math.floor(v.delay_len));
    const wave = new Float32Array(Math.min(points, n));
    for (let i = 0; i < wave.length; i++) {
      // oldest (about to be read) -> newest (just written)
      const d = n - (i * (n - 1)) / Math.max(1, wave.length - 1);
      wave[i] = delay_read(v.line, d);
    }
    return {
      active: true, model: 'string', note: v.note, hz: v.hz * s.bend_ratio, wave,
      delaySamples: v.delay_len, loopGain: v.loop_gain, damping: v.damp_b, sr: s.sr, gate: v.gate,
    };
  }
  const mat = MATERIALS[clamp(Math.round(s.p.modal_material), 0, MATERIALS.length - 1)];
  const modes = [];
  for (let k = 0; k < MAX_MODES; k++) {
    modes.push({ ratio: v.mode_hz[k] / v.hz, hz: v.mode_hz[k], amp: v.modes[k].amp, t60: v.mode_t60[k], silent: v.modes[k].b0 === 0 });
  }
  return { active: true, model: 'modal', note: v.note, hz: v.hz * s.bend_ratio, material: mat.name, modes, gate: v.gate };
}
