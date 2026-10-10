// AmiSynth physical-modelling instrument (8 voices; the 2D mesh uses at most 4).
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
//
// Model 2 - Bowed string (digital waveguide + friction, after McIntyre/Schumacher/Woodhouse)
//   The string is split at the bow into two delay lines (bow->nut, bow->bridge). Each sample
//   the velocity waves arriving at the bow are compared with the bow velocity; a friction
//   curve decides how much force the bow applies (high when the relative velocity is small =
//   "stick", low when large = "slip"). This produces the sawtooth-like Helmholtz motion.
//
// Model 3 - Wind (bore + reed or air jet, after the STK clarinet/flute)
//   Clarinet: one delay line = the bore (closed at the reed, so only odd harmonics). The
//   pressure difference across the reed sets how far it opens (a clipped straight line).
//   Flute: the bore plus a short "jet" delay; the jet is deflected in or out of the pipe by
//   the returning wave through a cubic curve.
//
// Model 4 - Membrane / plate (2D finite-difference wave equation)
//   A grid of points; every sample each point is pushed by the curvature (Laplacian) of its
//   neighbours: u' = 2u - u_prev + c^2 * Lap(u) (+ damping). Edges are fixed. The wave speed
//   c is chosen from the grid's lowest eigenvalue (computed numerically) so the fundamental
//   lands on the note, for any shape. A mallet hits a small round area.
//
// Model 5 - Stiff string (piano-like)
//   Karplus-Strong plus four first-order all-pass filters in the loop: they delay low
//   frequencies more than high ones (dispersion), so the partials are stretched sharp as on
//   a stiff steel string. Two strings per note, slightly detuned, beat against each other.

import {
  adsr_gate_off, adsr_gate_on, adsr_init, adsr_process, adsr_set, ap1_init, ap1_phase_delay, ap1_process,
  clamp, db_to_gain, delay_clear, delay_init, delay_read, delay_write, lp1_phase_delay, noise_seed, noise_white,
  onepole_hp, onepole_init, onepole_set, pan_gains, reson_init, reson_process, reson_reset,
  reson_set, reson_set_decay, soft_clip, svf_init, svf_process, svf_reset, svf_set, t60_coef, tuning_init,
  tuning_note_to_hz, tuning_set_edo, tuning_set_table, TWO_PI,
} from './lib.js';

export const PHYS_MAX_VOICES = 8;
export const MESH_MAX_VOICES = 4;
export const MAX_MODES = 8;
export const MESH_MAX = 20;
const MESH_W = MESH_MAX + 2; // padded row length (zero border = fixed edge)
const MAX_DELAY = 8192;
const K_MESH = 5.5;
const FLUTE_JET_RATIO = 0.52;
const N_AP = 4; // dispersion all-passes per stiff string

export const MODEL_STRING = 0;
export const MODEL_MODAL = 1;
export const MODEL_BOWED = 2;
export const MODEL_WIND = 3;
export const MODEL_MESH = 4;
export const MODEL_STIFF = 5;

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

const MESH_CELLS = MESH_W * MESH_W;

function voice_create() {
  const v = {
    active: 0, note: -1, gate: 0, age: 0, vel: 0, vel_raw: 0, hz: 0, level: 0, frames: 0,
    // string / shared delay-line state
    line: {}, line2: {}, lp_z: 0, lp_z2: 0, loop_gain: 1, loop_gain2: 1, damp_b: 0,
    delay_len: 0, delay_len2: 0, read_gain: 1,
    // modal
    modes: [], mode_hz: new Float64Array(MAX_MODES), mode_t60: new Float64Array(MAX_MODES),
    exc_t: 0, exc_len: 1,
    // bowed / wind
    env: {}, maxv: 0, slope: 0, slip: 1, body1: {}, body2: {}, dc: {},
    // mesh
    mesh_u: new Float64Array(MESH_CELLS), mesh_up: new Float64Array(MESH_CELLS), mesh_un: new Float64Array(MESH_CELLS),
    mesh_c2: 0, mesh_sig: 0, mesh_w: 0, jet_bias: 0,
    // stiff string
    ap_a: 0, apA: [], apB: [], tuneA: {}, tuneB: {}, tune_a: 0, tune_a2: 0, tune_d: 1, tune_d2: 1,
    gl: 1, gr: 1,
  };
  delay_init(v.line, MAX_DELAY);
  delay_init(v.line2, MAX_DELAY);
  for (let k = 0; k < MAX_MODES; k++) {
    v.modes.push({});
    reson_init(v.modes[k]);
  }
  adsr_init(v.env);
  svf_init(v.body1);
  svf_init(v.body2);
  onepole_init(v.dc);
  for (let k = 0; k < N_AP; k++) {
    v.apA.push({});
    v.apB.push({});
    ap1_init(v.apA[k]);
    ap1_init(v.apB[k]);
  }
  ap1_init(v.tuneA);
  ap1_init(v.tuneB);
  return v;
}

export function phys_init(s, sr) {
  noise_seed(12345);
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
  s.vib_phase = 0;
  s.mesh_mask = new Float64Array(MESH_CELLS);
  s.mesh_n = 0;
  s.mesh_shape = -1;
  s.mesh_mu = 1;
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
  s.vib_inc = p.phys_vibrato_rate_hz / s.sr;
  const n = clamp(Math.floor(p.mesh_size + 0.5), 6, MESH_MAX);
  const shape = Math.floor(p.mesh_shape + 0.5);
  if (n !== s.mesh_n || shape !== s.mesh_shape) mesh_setup(s, n, shape);
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

/** Phase delay (samples) of the loop low-pass y = (1-b)x + b*y1 at hz. */
function lp_phase_delay(b, hz, sr) {
  const w = (TWO_PI * hz) / sr;
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

// ---------------------------------------------------------------------------
// 2D mesh helpers. Cell (i, j) of an n x n grid lives at (i+1)*MESH_W + (j+1); the border
// (and any cell outside the shape) is never written, so it stays 0 = fixed edge.

function mesh_setup(s, n, shape) {
  s.mesh_n = n;
  s.mesh_shape = shape;
  const m = s.mesh_mask;
  m.fill(0);
  const cc = (n - 1) / 2;
  const rr = n / 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const inside = shape === 1 ? 1 : (i - cc) * (i - cc) + (j - cc) * (j - cc) <= rr * rr ? 1 : 0;
      m[(i + 1) * MESH_W + (j + 1)] = inside;
    }
  }
  // Lowest eigenvalue mu of -Laplacian on the shape, by power iteration on (8 - (-Lap)):
  // its largest eigenvalue is 8 - mu. Needed to tune: cos(wT) = 1 - c^2 * mu / 2.
  const x = new Float64Array(MESH_CELLS);
  const y = new Float64Array(MESH_CELLS);
  for (let c = 0; c < MESH_CELLS; c++) x[c] = m[c];
  let lambda = 0;
  for (let it = 0; it < 800; it++) {
    let norm = 0;
    for (let c = 0; c < MESH_CELLS; c++) {
      if (m[c] === 0) continue;
      y[c] = 4 * x[c] + x[c - 1] + x[c + 1] + x[c - MESH_W] + x[c + MESH_W];
      if (y[c] > norm) norm = y[c];
    }
    lambda = norm;
    for (let c = 0; c < MESH_CELLS; c++) x[c] = m[c] === 0 ? 0 : y[c] / norm;
  }
  s.mesh_mu = 8 - lambda;
  // pickup point: off-centre so most modes are heard
  s.mesh_pick = (Math.floor(n * 0.62) + 1) * MESH_W + (Math.floor(n * 0.71) + 1);
  if (m[s.mesh_pick] === 0) s.mesh_pick = (Math.floor(cc) + 1) * MESH_W + (Math.floor(cc) + 1);
}

/**
 * Split a loop delay L into an integer delay line length and a first-order all-pass whose
 * phase delay at w makes up the rest (Thiran: a = (1-d)/(1+d), refined at w).
 */
function thiran_split(v, which, L, w) {
  const n = clamp(Math.floor(L - 0.5), 2, MAX_DELAY - 2);
  const d = clamp(L - n, 0.5, 1.5);
  let dl = d;
  let a = 0;
  for (let it = 0; it < 4; it++) {
    a = (1 - dl) / (1 + dl);
    dl += d - ap1_phase_delay(a, w);
  }
  a = (1 - dl) / (1 + dl);
  if (which === 0) {
    v.delay_len = n;
    v.tune_d = d;
    v.tune_a = a;
  } else {
    v.delay_len2 = n;
    v.tune_d2 = d;
    v.tune_a2 = a;
  }
}

/** Mesh damping s for a T60 of `ms`: (1-s)/(1+s) = coef^2. */
function mesh_sigma(ms, sr) {
  const g = t60_coef(ms, sr) ** 2;
  return (1 - g) / (1 + g);
}

/** (Re)compute pitch dependent coefficients of a voice. */
function voice_tune(s, v, keep_decay) {
  const p = s.p;
  const sr = s.sr;
  const hz = v.hz * s.bend_ratio;
  const model = Math.floor(p.phys_model + 0.5);
  if (model === MODEL_STRING) {
    // total loop delay = sr/hz = delay line + phase delay of the low-pass
    const b = s.damp_b;
    v.damp_b = b;
    v.delay_len = clamp(sr / hz - lp_phase_delay(b, hz, sr), 2, MAX_DELAY - 2);
    if (!keep_decay) v.loop_gain = Math.exp(-6.907755 / (hz * Math.max(p.string_decay_ms, 1) * 0.001));
  } else if (model === MODEL_MODAL) {
    const mat = MATERIALS[clamp(Math.round(p.modal_material), 0, MATERIALS.length - 1)];
    for (let k = 0; k < MAX_MODES; k++) {
      // stretch: ratio^(1+x) bends the series away from / toward harmonic
      const ratio = Math.pow(mat.ratios[k], 1 + p.modal_inharmonicity);
      v.mode_hz[k] = hz * ratio;
      if (!keep_decay) v.mode_t60[k] = p.modal_decay_ms / (1 + p.modal_high_damping * 4 * (ratio - 1));
      const pos_w = Math.abs(Math.sin(Math.PI * (k + 1) * p.modal_strike_position));
      reson_set(v.modes[k], v.mode_hz[k], v.mode_t60[k], mat.gains[k] * (0.3 + 0.7 * pos_w), sr);
    }
  } else if (model === MODEL_BOWED) {
    // loop = bow->nut line + bow->bridge line + bridge low-pass
    const b = 0.1 + 0.75 * (1 - p.bowed_brightness);
    v.damp_b = b;
    const total = sr / hz - lp_phase_delay(b, hz, sr);
    v.delay_len = clamp(total * p.bow_position, 2, MAX_DELAY - 2); // bridge side
    v.delay_len2 = clamp(total * (1 - p.bow_position), 2, MAX_DELAY - 2); // nut side
  } else if (model === MODEL_WIND) {
    if (p.wind_type < 0.5) {
      // clarinet: inverting reflection at the reed -> period = 2 x (bore + 0.5 sample averaging filter)
      v.delay_len = clamp((0.5 * sr) / hz - 0.5, 2, MAX_DELAY - 2);
    } else {
      // flute: open-open bore tuned to the note (loop low-pass delay compensated); the jet
      // delay is a fixed fraction of it, where the jet / bore loop speaks at the bore pitch.
      // The embouchure moves the jet across the labium edge (offset) instead of changing the
      // jet length, so it shapes the tone without detuning.
      v.damp_b = 0.7 - (0.1 * 22050) / sr;
      // measured residual of the jet loop (cents sharp), x = octaves above C4 at 48 kHz
      const x = Math.max(-1, Math.log2((hz * 48000) / (sr * 261.63)));
      const sharp = -6 + 3 * x + 2 * x * x;
      const total = (sr / hz) * Math.pow(2, sharp / 1200);
      v.delay_len = clamp(total - lp_phase_delay(v.damp_b, hz, sr), 2, MAX_DELAY - 2);
      v.delay_len2 = clamp(v.delay_len * FLUTE_JET_RATIO, 2, MAX_DELAY - 2);
      v.jet_bias = -0.05 + 0.15 * p.wind_embouchure;
    }
  } else if (model === MODEL_MESH) {
    const w = (TWO_PI * hz) / sr;
    v.mesh_c2 = Math.min(0.49, (2 * (1 - Math.cos(w))) / s.mesh_mu);
    v.mesh_w = w;
  } else {
    // stiff string: two strings, detuned by +/- half the unison detune
    // the loop low-pass costs a high string far more per second (many more round trips),
    // so it is relaxed above middle C to keep the treble ringing
    const b = (0.05 + 0.6 * p.piano_damping) * clamp(Math.sqrt(262 / hz), 0.15, 1);
    v.damp_b = b;
    // dispersion all-pass coefficient (< 0 = upper partials sharp); fades out for very high notes
    const a = -0.9 * p.piano_inharmonicity * clamp(sr / (hz * 40), 0, 1);
    v.ap_a = a;
    const det = Math.pow(2, p.piano_unison_detune_cents / 2400);
    const hzA = hz * det;
    const hzB = hz / det;
    const wA = (TWO_PI * hzA) / sr;
    const wB = (TWO_PI * hzB) / sr;
    // integer delay + a tuning all-pass for the fraction (linear interpolation would damp
    // the treble strings, which make many round trips per second)
    thiran_split(v, 0, sr / hzA - lp1_phase_delay(b, wA) - N_AP * ap1_phase_delay(a, wA), wA);
    thiran_split(v, 1, sr / hzB - lp1_phase_delay(b, wB) - N_AP * ap1_phase_delay(a, wB), wB);
    if (!keep_decay) {
      // higher strings decay faster
      const t = Math.max(p.piano_decay_ms, 1) * clamp(Math.pow(220 / hz, 0.4), 0.25, 2) * 0.001;
      v.loop_gain = Math.exp(-6.907755 / (hzA * t));
      v.loop_gain2 = Math.exp(-6.907755 / (hzB * t));
    }
  }
}

function voice_allocate(s, limit) {
  let best = 0;
  let best_score = -1;
  for (let i = 0; i < limit; i++) {
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

/** Fill a delay line with a hammer pulse (raised cosine of `width`) and apply the strike comb. */
function fill_hammer(line, n, width, pos, amp) {
  for (let i = 0; i < n; i++) {
    const x = i < width ? amp * (0.5 - 0.5 * Math.cos((TWO_PI * i) / width)) : 0;
    delay_write(line, x);
  }
  const pick = Math.max(1, Math.round(pos * n));
  for (let i = n - 1; i >= pick; i--) {
    const idx_a = (line.w - n + i + line.size) % line.size;
    const idx_b = (line.w - n + i - pick + line.size) % line.size;
    line.buf[idx_a] -= line.buf[idx_b];
  }
}

export function phys_note_on(s, note, velocity) {
  if (velocity <= 0) {
    phys_note_off(s, note);
    return;
  }
  const p = s.p;
  const sr = s.sr;
  const model = Math.floor(p.phys_model + 0.5);
  const limit = model === MODEL_MESH ? MESH_MAX_VOICES : PHYS_MAX_VOICES;
  let idx = -1;
  for (let i = 0; i < limit; i++) if (s.voices[i].active && s.voices[i].note === note) idx = i;
  if (idx < 0) idx = voice_allocate(s, limit);
  const v = s.voices[idx];
  const vel = velocity / 127;
  v.vel_raw = vel;
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

  if (model === MODEL_STRING) {
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
  } else if (model === MODEL_MODAL) {
    for (let k = 0; k < MAX_MODES; k++) reson_reset(v.modes[k]);
    // Contact time as a fraction of the fundamental period (smaller bars are hit for a
    // shorter time): soft mallet 0.6 period .. hard mallet 0.04 period. Velocity hardens it.
    const hard = clamp(p.modal_hardness * (0.7 + 0.3 * vel), 0, 1);
    v.exc_len = Math.max(2, Math.round((sr / v.hz) * (0.6 - 0.56 * hard)));
    v.exc_t = 0;
  } else if (model === MODEL_BOWED) {
    const fresh = v.env.stage === 0;
    if (fresh) {
      delay_clear(v.line);
      delay_clear(v.line2);
      v.lp_z = 0;
      svf_reset(v.body1);
      svf_reset(v.body2);
      v.env.value = 0;
    }
    adsr_set(v.env, p.bow_attack_ms, 1, 1, p.phys_release_ms, sr);
    adsr_gate_on(v.env);
    v.maxv = (0.03 + 0.25 * p.bow_speed) * v.vel;
    v.slope = 5 - 4 * p.bow_pressure;
    svf_set(v.body1, 290, 0.6, sr);
    svf_set(v.body2, 1150, 0.9, sr);
  } else if (model === MODEL_WIND) {
    if (v.env.stage === 0) {
      delay_clear(v.line);
      delay_clear(v.line2);
      v.lp_z = 0;
      v.lp_z2 = 0;
      v.dc.z = 0;
      v.env.value = 0;
    }
    onepole_set(v.dc, 20, sr);
    adsr_set(v.env, p.wind_attack_ms, 1, 1, Math.min(p.phys_release_ms, 400), sr);
    adsr_gate_on(v.env);
    // Both instruments only speak inside a band of blowing pressure, so the knobs move the
    // pressure within that band (velocity sets the output level instead).
    if (p.wind_type < 0.5) {
      // reed stiffness (slope) x pressure must stay around 0.2 .. 0.26
      v.slope = -(0.2 + 0.25 * p.wind_embouchure);
      v.maxv = (0.2 + 0.06 * p.breath_pressure) / -v.slope;
    } else {
      v.maxv = 1.125 + 0.16 * (p.breath_pressure - 0.5) - v.jet_bias;
    }
  } else if (model === MODEL_MESH) {
    const n = s.mesh_n;
    const m = s.mesh_mask;
    v.mesh_u.fill(0);
    v.mesh_up.fill(0);
    v.mesh_un.fill(0);
    // mallet: raised-cosine bump of radius R around the strike point, as initial velocity
    const R = 0.75 + 2.5 * (1 - clamp(p.mesh_hardness * (0.7 + 0.3 * vel), 0, 1));
    // same momentum whatever the mallet size (a small hard mallet hits a smaller area harder)
    const amp = (v.vel * 4) / (R * R);
    const sx = p.mesh_strike_x * (n - 1);
    const sy = p.mesh_strike_y * (n - 1);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const c = (i + 1) * MESH_W + (j + 1);
        if (m[c] === 0) continue;
        const d = Math.sqrt((i - sy) * (i - sy) + (j - sx) * (j - sx));
        if (d < R) v.mesh_up[c] = (-0.5 - 0.5 * Math.cos((Math.PI * (R - d)) / R)) * amp;
      }
    }
    v.mesh_sig = mesh_sigma(p.mesh_decay_ms, sr);
  } else {
    // stiff string: hammer pulse into both strings
    delay_clear(v.line);
    delay_clear(v.line2);
    v.lp_z = 0;
    v.lp_z2 = 0;
    for (let k = 0; k < N_AP; k++) {
      ap1_init(v.apA[k]);
      ap1_init(v.apB[k]);
    }
    ap1_init(v.tuneA);
    ap1_init(v.tuneB);
    const hard = clamp(p.piano_hammer_hardness * (0.6 + 0.4 * vel), 0, 1);
    const nA = Math.ceil(v.delay_len);
    const nB = Math.ceil(v.delay_len2);
    fill_hammer(v.line, nA, Math.max(2, nA * (0.45 - 0.42 * hard)), p.piano_strike_position, 0.5);
    fill_hammer(v.line2, nB, Math.max(2, nB * (0.45 - 0.42 * hard)), p.piano_strike_position, 0.32);
    v.read_gain = 1.6 * v.vel * clamp(Math.pow(v.hz / 220, 0.3), 0.7, 2);
  }
}

export function phys_note_off(s, note) {
  const p = s.p;
  const model = Math.floor(p.phys_model + 0.5);
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active || !v.gate || v.note !== note) continue;
    v.gate = 0;
    if (model === MODEL_STRING) {
      const g_rel = Math.exp(-6.907755 / (v.hz * p.phys_release_ms * 0.001));
      v.loop_gain = Math.min(v.loop_gain, g_rel);
    } else if (model === MODEL_MODAL) {
      for (let k = 0; k < MAX_MODES; k++) {
        v.mode_t60[k] = Math.min(v.mode_t60[k], p.phys_release_ms);
        reson_set_decay(v.modes[k], v.mode_hz[k], v.mode_t60[k], s.sr);
      }
    } else if (model === MODEL_BOWED || model === MODEL_WIND) {
      adsr_gate_off(v.env);
    } else if (model === MODEL_MESH) {
      v.mesh_sig = Math.max(v.mesh_sig, mesh_sigma(Math.min(p.mesh_decay_ms, p.phys_release_ms), s.sr));
    } else {
      const g_rel = Math.exp(-6.907755 / (v.hz * p.phys_release_ms * 0.001));
      v.loop_gain = Math.min(v.loop_gain, g_rel);
      v.loop_gain2 = Math.min(v.loop_gain2, g_rel);
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

// ---------------------------------------------------------------------------
// Per-model sample renderers (return the voice's mono output)

function render_string(v, vib) {
  // read the oldest sample, damp it, feed it back
  const x = delay_read(v.line, v.delay_len / vib);
  v.lp_z = (1 - v.damp_b) * x + v.damp_b * v.lp_z;
  const fb = v.lp_z * v.loop_gain;
  delay_write(v.line, fb);
  return fb * v.read_gain;
}

function render_modal(v) {
  let exc = 0;
  if (v.exc_t < v.exc_len) {
    // unit-area pulse: low modes get the full hit, modes above ~1/pulse-length are filtered out
    exc = ((0.5 - 0.5 * Math.cos((TWO_PI * v.exc_t) / v.exc_len)) * v.vel) / (0.5 * v.exc_len);
    v.exc_t++;
  }
  let y = 0;
  for (let k = 0; k < MAX_MODES; k++) y += reson_process(v.modes[k], exc);
  return y * 1.6;
}

function render_bowed(v, vib) {
  const bow_v = adsr_process(v.env) * v.maxv;
  const bridge_out = delay_read(v.line, v.delay_len / vib);
  const nut_out = delay_read(v.line2, v.delay_len2 / vib);
  // bridge: lossy low-pass reflection; nut: rigid (inverting) reflection
  v.lp_z = (1 - v.damp_b) * bridge_out + v.damp_b * v.lp_z;
  const refl_bridge = -v.lp_z * 0.95;
  const refl_nut = -nut_out;
  const string_v = refl_bridge + refl_nut;
  const dv = bow_v - string_v;
  // friction curve (STK BowTable): ~1 when the bow and string move together (stick), small when they slide
  let t = Math.abs(dv * v.slope) + 0.75;
  t = Math.pow(t, -4);
  if (t > 1) t = 1;
  v.slip = t;
  const nv = dv * t;
  delay_write(v.line2, refl_bridge + nv);
  delay_write(v.line, refl_nut + nv);
  // crude violin body: two resonances added to the bridge signal
  svf_process(v.body1, bridge_out);
  svf_process(v.body2, bridge_out);
  return (bridge_out + 1.2 * v.body1.bp + 0.8 * v.body2.bp) * 1.6;
}

function render_wind(v, vib, flute, noise_amt) {
  let bp = adsr_process(v.env) * v.maxv;
  bp += bp * noise_amt * 0.25 * noise_white();
  if (!flute) {
    const bore = delay_read(v.line, v.delay_len / vib);
    // averaging low-pass + inverting reflection at the bell
    const f = 0.5 * (bore + v.lp_z);
    v.lp_z = bore;
    const pd = -0.95 * f - bp;
    // reed: opening = clipped straight line of the pressure difference
    let reed = 0.7 + v.slope * pd;
    if (reed > 1) reed = 1;
    if (reed < -1) reed = -1;
    v.slip = reed;
    delay_write(v.line, bp + pd * reed);
    return bore * 1.1 * v.vel;
  }
  const bore = delay_read(v.line, v.delay_len / vib);
  v.lp_z = (1 - v.damp_b) * bore + v.damp_b * v.lp_z;
  const t = onepole_hp(v.dc, v.lp_z);
  const jet_in = bp - 0.5 * t;
  const jet = delay_read(v.line2, v.delay_len2 / vib);
  delay_write(v.line2, jet_in);
  // jet deflection: cubic curve, clipped
  // the jet (and its offset) only exists while blowing
  const jx = jet + v.jet_bias * v.env.value;
  let j = jx * (jx * jx - 1);
  if (j > 1) j = 1;
  if (j < -1) j = -1;
  v.slip = j;
  delay_write(v.line, j + 0.5 * t);
  return bore * 0.55 * v.vel;
}

function render_mesh(s, v) {
  const n = s.mesh_n;
  const m = s.mesh_mask;
  const u = v.mesh_u;
  const up = v.mesh_up;
  const un = v.mesh_un;
  const c2 = v.mesh_c2;
  // velocity damping u_tt + 2s u_t: per-sample amplitude factor sqrt((1-s)/(1+s)) for every
  // mode, without detuning the low ones (scaling the whole update would)
  const a = 1 - v.mesh_sig;
  const inv = 1 / (1 + v.mesh_sig);
  // velocity-Laplacian damping: a mode with -Laplacian eigenvalue lambda loses an extra
  // d*(lambda-mu)/2 per sample, so the fundamental keeps the set decay and the highest
  // grid modes (lambda ~ 8) die within ~10 ms at 1
  const d = (s.p.mesh_high_damping * 172.5) / s.sr;
  const mu = s.mesh_mu;
  for (let i = 1; i <= n; i++) {
    let c = i * MESH_W + 1;
    for (let j = 1; j <= n; j++, c++) {
      if (m[c] === 0) continue;
      const lu = u[c - 1] + u[c + 1] + u[c - MESH_W] + u[c + MESH_W] - 4 * u[c];
      const lp = up[c - 1] + up[c + 1] + up[c - MESH_W] + up[c + MESH_W] - 4 * up[c];
      un[c] = (2 * u[c] - a * up[c] + c2 * lu + d * (lu - lp + mu * (u[c] - up[c]))) * inv;
    }
  }
  // rotate the three time levels
  v.mesh_up = u;
  v.mesh_u = un;
  v.mesh_un = up;
  const pk = s.mesh_pick;
  // displacement at the pickup (x w so the level does not depend on pitch); the
  // fundamental dominates as on a real drum head
  return un[pk] * v.mesh_w * K_MESH;
}

function render_stiff(v, vib) {
  const a = v.ap_a;
  let nA = v.delay_len;
  let nB = v.delay_len2;
  let tA = v.tune_a;
  let tB = v.tune_a2;
  if (vib !== 1) {
    // vibrato: re-split the scaled delay (low-frequency Thiran formula is close enough)
    let t = (nA + v.tune_d) / vib;
    nA = Math.floor(t - 0.5);
    t -= nA;
    tA = (1 - t) / (1 + t);
    t = (nB + v.tune_d2) / vib;
    nB = Math.floor(t - 0.5);
    t -= nB;
    tB = (1 - t) / (1 + t);
  }
  let x = ap1_process(v.tuneA, delay_read(v.line, nA), tA);
  for (let k = 0; k < N_AP; k++) x = ap1_process(v.apA[k], x, a);
  v.lp_z = (1 - v.damp_b) * x + v.damp_b * v.lp_z;
  const fa = v.lp_z * v.loop_gain;
  delay_write(v.line, fa);
  let y = ap1_process(v.tuneB, delay_read(v.line2, nB), tB);
  for (let k = 0; k < N_AP; k++) y = ap1_process(v.apB[k], y, a);
  v.lp_z2 = (1 - v.damp_b) * y + v.damp_b * v.lp_z2;
  const fb = v.lp_z2 * v.loop_gain2;
  delay_write(v.line2, fb);
  return (fa + fb) * v.read_gain;
}

export function phys_render(s) {
  const p = s.p;
  const model = Math.floor(p.phys_model + 0.5);
  // vibrato for the delay-line models (ratio = 1 exactly when off)
  let vib = 1;
  if (p.phys_vibrato_cents > 0) {
    vib = Math.pow(2, (p.phys_vibrato_cents * Math.sin(TWO_PI * s.vib_phase)) / 1200);
    s.vib_phase += s.vib_inc;
    if (s.vib_phase >= 1) s.vib_phase -= 1;
  }
  const flute = p.wind_type >= 0.5;
  let l = 0;
  let r = 0;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) continue;
    let y;
    if (model === MODEL_STRING) y = render_string(v, vib);
    else if (model === MODEL_MODAL) y = render_modal(v);
    else if (model === MODEL_BOWED) y = render_bowed(v, vib);
    else if (model === MODEL_WIND) y = render_wind(v, vib, flute, p.breath_noise);
    else if (model === MODEL_MESH) y = render_mesh(s, v);
    else y = render_stiff(v, vib);
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

/** Read a delay line oldest -> newest into `points` samples. */
function line_wave(line, len, points) {
  const n = Math.max(2, Math.floor(len));
  const wave = new Float32Array(Math.max(2, Math.min(points, n)));
  for (let i = 0; i < wave.length; i++) {
    const d = n - (i * (n - 1)) / Math.max(1, wave.length - 1);
    wave[i] = delay_read(line, d);
  }
  return wave;
}

/** Partials of the stiff-string loop: frequencies where the loop phase is 2*pi*k. */
function stiff_partials(s, v, count) {
  const sr = s.sr;
  const total = (w) =>
    w * (v.delay_len + ap1_phase_delay(v.tune_a, w) + lp1_phase_delay(v.damp_b, w) + N_AP * ap1_phase_delay(v.ap_a, w));
  const out = [];
  for (let k = 1; k <= count; k++) {
    let lo = 1e-6;
    let hi = Math.PI * 0.999;
    if (total(hi) < TWO_PI * k) break;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (total(mid) < TWO_PI * k) lo = mid;
      else hi = mid;
    }
    out.push((0.5 * (lo + hi) * sr) / TWO_PI);
  }
  return out;
}

/**
 * Visualisation snapshot of the most recently played voice (only built when the UI
 * asks for it, so it costs nothing otherwise). Not part of the JSFX port.
 */
export function phys_snapshot(s, points = 192) {
  const v = s.voices[s.last_voice];
  const model = Math.floor(s.p.phys_model + 0.5);
  const names = ['string', 'modal', 'bowed', 'wind', 'mesh', 'stiff'];
  if (!v || !v.active) return { active: false, model: names[model] };
  const base = { active: true, model: names[model], note: v.note, hz: v.hz * s.bend_ratio, gate: v.gate, sr: s.sr };
  if (model === MODEL_STRING) {
    return { ...base, wave: line_wave(v.line, v.delay_len, points), delaySamples: v.delay_len, loopGain: v.loop_gain, damping: v.damp_b };
  }
  if (model === MODEL_MODAL) {
    const mat = MATERIALS[clamp(Math.round(s.p.modal_material), 0, MATERIALS.length - 1)];
    const modes = [];
    for (let k = 0; k < MAX_MODES; k++) {
      modes.push({ ratio: v.mode_hz[k] / v.hz, hz: v.mode_hz[k], amp: v.modes[k].amp, t60: v.mode_t60[k], silent: v.modes[k].b0 === 0 });
    }
    return { ...base, material: mat.name, modes };
  }
  if (model === MODEL_BOWED) {
    // nut side is drawn reversed so the picture reads nut -> bow -> bridge
    const nut = line_wave(v.line2, v.delay_len2, Math.round(points * (1 - s.p.bow_position)));
    const bridge = line_wave(v.line, v.delay_len, Math.round(points * s.p.bow_position));
    return { ...base, nut: nut.reverse(), bridge, slip: v.slip, bow: v.env.value * v.maxv, bowPos: s.p.bow_position };
  }
  if (model === MODEL_WIND) {
    return { ...base, wave: line_wave(v.line, v.delay_len, points), flute: s.p.wind_type >= 0.5, valve: v.slip, breath: v.env.value * v.maxv };
  }
  if (model === MODEL_MESH) {
    const n = s.mesh_n;
    const grid = new Float32Array(n * n);
    const mask = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const c = (i + 1) * MESH_W + (j + 1);
        grid[i * n + j] = v.mesh_u[c];
        mask[i * n + j] = s.mesh_mask[c];
      }
    }
    return { ...base, n, grid, mask, strike: [s.p.mesh_strike_x, s.p.mesh_strike_y] };
  }
  const partials = stiff_partials(s, v, 10);
  return { ...base, wave: line_wave(v.line, v.delay_len, points), partials, f1: partials[0] || v.hz };
}
