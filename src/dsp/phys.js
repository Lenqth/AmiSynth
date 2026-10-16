// AmiSynth physical-modelling instrument (8 voices; the 2D mesh uses at most 3).
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
//   Free reed (accordion, harmonica): a stiff metal tongue swings through a close-fitting slot
//   at its own pitch (the small cavity barely pulls it), so it is an oscillator whose swing
//   grows with the breath; air flows only while the tongue is clear of the slot, twice a
//   period, and the radiated sound is that pulsed flow differentiated, through a cavity resonance.
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
//
// Model 6 - Brass (lip reed, after the STK Brass / Cook's HosePlayer)
//   The lips are a mass-spring valve: a two-pole resonator tuned to the note, driven by the
//   pressure difference between the mouth and the mouthpiece. Their opening (squared, clipped)
//   lets mouth pressure into the bore, a delay line two periods long (the note is the bore's
//   2nd resonance, as on a real trumpet). Blowing harder saturates the lips more: brighter.
//
// Model 7 - Organ (tonewheel, additive)
//   Not a physical model of a pipe: nine sine partials at the drawbar footages (16' .. 1' =
//   0.5 .. 8 x the note), each drawbar 0..8 in 3 dB steps. All of them are harmonics of half
//   the note, so one phase per voice drives them (sin(k x) by recurrence). Single-trigger
//   percussion, a key-contact click, and the rotary speaker (any model) after the amp.

import {
  adsr_gate_off, adsr_gate_on, adsr_init, adsr_process, adsr_set, ap1_init, ap1_phase_delay, ap1_process,
  clamp, db_to_gain, delay_clear, delay_init, delay_read, delay_write, fdn4_init, fdn4_process, fdn4_set,
  lp1_phase_delay, noise_seed, noise_white,
  onepole_hp, onepole_init, onepole_lp, onepole_set, pan_gains, reson_init, reson_process, reson_reset,
  reson_set, reson_set_decay, soft_clip, svf_init, svf_process, svf_reset, svf_set, t60_coef, tuning_init,
  tuning_note_to_hz, tuning_set_edo, tuning_set_table, TWO_PI, sidechain_duck_gain, sidechain_init, sidechain_process, sidechain_set,
} from './lib.js';

export const PHYS_MAX_VOICES = 8;
export const MESH_MAX_VOICES = 3;
export const MAX_MODES = 8;
export const MESH_MAX = 16;
const MESH_W = MESH_MAX + 2; // padded row length (zero border = fixed edge)
const MAX_DELAY = 8192;
const K_MESH = 5.5;
const FLUTE_JET_RATIO = 1.03;
export const WIND_CLARINET = 0;
export const WIND_FLUTE = 1;
export const WIND_SAX = 2;
export const WIND_DOUBLE_REED = 3;
export const WIND_FREE_REED = 4;
/** free reed: how far the tongue overlaps the slot (it lets air through only beyond this), output gain */
const FREE_REED_OVERLAP = 0.35;
const FREE_REED_GAIN = 1.1;
/** conical bore (sax, double reed): where along the loop the reed sees the reflected wave (the missing cone tip) */
const CONE_REED_POS = [0, 0, 0.4, 0.35];
/** conical bore output gain (the double reed's second difference is much hotter) */
const CONE_GAIN = [0, 0, 0.7, 0.9];
const FLUTE_JET_GAIN = 1.6;
const N_AP = 4; // dispersion all-passes per stiff string
const EXC_MAX = 16384; // piano excitation buffer (hammer + strike comb, up to 192 kHz)
const BRASS_GAIN = 2.5;
const BRASS_STEEP = 1.5; // wave steepening per unit pressure
const BRASS_BOOST = 6; // extra lip gain right after the tongue release
const BRASS_BOOST_PERIODS = 10;
const BRASS_SEED = 0.15; // bore wave set moving by the tongue (x mouth pressure)
const STEEP_LEN = 4096; // power of two
const HAM_SUB = 4; // hammer integration sub-steps per sample
const PIANO_HP = 4; // high-pass stages on the hammer excitation
const HAM_GAIN = 63;
const SB_MODES = 16; // soundboard resonances
// hammer force history at sub-step resolution (only used inside note-on)
const ham_hist = new Float64Array(EXC_MAX * HAM_SUB);

export const MODEL_STRING = 0;
export const MODEL_MODAL = 1;
export const MODEL_BOWED = 2;
export const MODEL_WIND = 3;
export const MODEL_MESH = 4;
export const MODEL_STIFF = 5;
export const MODEL_BRASS = 6;
export const MODEL_ORGAN = 7;
// sawari: largest gain correction for the bridge contact's loss
const SAW_GMAX = 1.5;

/** drawbar footages 16' 5 1/3' 8' 4' 2 2/3' 2' 1 3/5' 1 1/3' 1' as harmonics of half the note */
export const ORGAN_K = [1, 3, 2, 4, 6, 8, 10, 12, 16];
export const ORGAN_BARS = ['organ_drawbar_16', 'organ_drawbar_5_13', 'organ_drawbar_8', 'organ_drawbar_4', 'organ_drawbar_2_23',
  'organ_drawbar_2', 'organ_drawbar_1_35', 'organ_drawbar_1_13', 'organ_drawbar_1'];
/** the top tonewheel is ~ 5.9 kHz: partials above it fold back an octave, as on the real organ */
const ORGAN_FOLD_HZ = 6000;
const ORGAN_GAIN = 0.12;
const ROTARY_LEN = 1024;

// Brass lip drive: every note needs a minimum drive to speak (measured on notes 28, 32, .. 104);
// Lip Buzz and the blowing pressure choose a multiple of it (BRASS_MULTS range).
const BRASS_NOTE0 = 28;
const BRASS_MIN_DRIVE = [0.0542, 0.0308, 0.0275, 0.0219, 0.0175, 0.0124, 0.0099, 0.0079, 0.0063, 0.005,
  0.0045, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004, 0.004];
// Brass tuning: the pitch settles between the bore and the lip resonance, so it depends on the
// note and the drive. Measured residual (cents sharp) per drive multiple x note; bore and lips
// are scaled together by it so the pitch lands on the note.
const BRASS_MULTS = [1.1, 1.6, 2.2, 3];
export const BRASS_SHARP = [
  [86.5, 70.6, 73.9, 69.7, 67.9, 62.6, 59.1, 56.9, 54.9, 47.9, 44.1, 40.2, 39.7, 38.9, 37.9, 37.3, 36.7, 37.1, 39.8, 42.5],
  [68.9, 71.7, 75.5, 75.2, 74.7, 72.6, 71.2, 69.5, 67.8, 60.7, 55.6, 50.3, 48.4, 46.3, 44.5, 43.3, 42.4, 42.7, 46.2, 49.7],
  [70.8, 74.4, 72.5, 75.9, 77, 79.5, 79.5, 78.2, 76.5, 69.5, 63.6, 57.7, 54.6, 51.6, 48.9, 47.3, 46, 46.4, 50.8, 51.1],
  [59.4, 67.1, 61.5, 62.4, 60.8, 70.2, 70.9, 71.4, 71.8, 69.2, 63.5, 62.3, 59.2, 55.4, 52.1, 50, 48.5, 49, 54.2, 43.9],
];

/**
 * Guitar amp types: [pre high-pass Hz, gain at Amp Gain 0, gain at 1, clipping bias (asymmetry),
 * gain stages, cabinet low-pass Hz at Amp Tone 0, at 1]. A higher pre high-pass gives the tighter,
 * mid-forward drive of overdrive pedals; the cabinet low-pass stands in for a 12" speaker.
 */
const AMP_TYPES = [
  [0, 1, 1, 0, 0, 0, 0],
  [60, 1, 4, 0, 1, 3000, 9000],
  [100, 3, 30, 0.15, 1, 2500, 7000],
  [200, 8, 100, 0.2, 1, 2200, 6000],
  [150, 30, 600, 0.1, 2, 1800, 5000],
];

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
  // Gongs (approximate): a large bossed gamelan gong has a strong fundamental with a near twin
  // 0.4 % above it (the slow beating, "ombak"), then roughly harmonic partials; a small kettle gong
  // is brighter with a cluster near 2.7-3x; a flat tam-tam is a dense, nearly even spread of modes.
  { name: 'Gong Ageng (gamelan)', ratios: [1, 1.004, 2.01, 2.94, 3.98, 4.62, 5.86, 7.12], gains: [1, 0.85, 0.4, 0.3, 0.18, 0.12, 0.08, 0.05] },
  { name: 'Kettle Gong (bonang)', ratios: [1, 1.005, 2.06, 2.73, 3.02, 4.17, 5.11, 6.32], gains: [1, 0.6, 0.45, 0.4, 0.35, 0.15, 0.1, 0.06] },
  { name: 'Tam-tam', ratios: [1, 1.38, 1.83, 2.27, 2.76, 3.31, 3.93, 4.62], gains: [0.7, 0.8, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5] },
  // Steel pan note area: tuned so the fundamental, octave and twelfth line up (slightly off),
  // with weaker untuned modes above.
  { name: 'Steel Drum', ratios: [1, 1.997, 2.988, 3.97, 4.62, 5.08, 6.03, 7.4], gains: [1, 0.85, 0.5, 0.28, 0.14, 0.1, 0.07, 0.04] },
  // Tubular bell (chime): free-bar modes scaled so the heard strike note (an octave below the
  // 4th mode, the virtual pitch of modes 4-6 at ~2:3:4) is the played note.
  { name: 'Tubular Bell', ratios: [0.224, 0.617, 1.208, 2, 2.985, 4.17, 5.55, 7.13], gains: [0.1, 0.3, 0.6, 1, 0.8, 0.6, 0.35, 0.2] },
];

const MESH_CELLS = MESH_W * MESH_W;

function voice_create() {
  const v = {
    active: 0, note: -1, gate: 0, sustained: 0, age: 0, vel: 0, vel_raw: 0, hz: 0, level: 0, frames: 0,
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
    mesh_c2: 0, mesh_sig: 0, mesh_omega: 0, jet_bias: 0, jet_boost: 1, flut: 0, hiss_lp: 0,
    // brass lips (two-pole resonator), dc blocker, bell low-pass
    lip_y1: 0, lip_y2: 0, lip_a1: 0, lip_a2: 0, lip_g: 0, dc_x: 0, dc_y: 0, dc_r: 0, bell_b: 0, bell_z: 0,
    refl_b: 0, refl_z: 0, rad_x: 0, rad_x2: 0, rad_k: 1, boost: 0, boost_c: 0, steep: { buf: new Float64Array(STEEP_LEN), w: 0 },
    // stiff string
    ap_a: 0, n_ap: N_AP, apA: [], apB: [], tuneA: {}, tuneB: {}, tune_a: 0, tune_a2: 0, tune_d: 1, tune_d2: 1,
    exc: new Float64Array(EXC_MAX), hp: new Float64Array(PIANO_HP),
    gl: 1, gr: 1,
    // aftertouch: this key's polyphonic aftertouch, and max(channel pressure, it) (0..1)
    poly_at: 0, press: 0,
    // organ: phase of half the note, its increment, percussion envelope, click samples left
    org_ph: 0, org_inc: 0, org_perc: 0, org_clk: 0,
    // free reed: the two musette reeds' phases and increments (the main reed uses org_ph / org_inc)
    fr_ph2: 0, fr_ph3: 0, fr_inc2: 0, fr_inc3: 0,
    // sawari: envelope of the loop, DC of the bridge contact, mean |in| / |out| and the gain correction
    saw_env: 0, saw_dc: 0, saw_mx: 0, saw_my: 0, saw_g: 1, saw_on: 0,
    bachi_t: 0, bachi_len: 1,
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
  s.sympathetic = Array.from({ length: 24 }, () => { const o = {}; reson_init(o); return o; });
  s.sympathetic_key = '';
  s.custom_scale = 0;
  s.age_counter = 0;
  s.sustain_pedal = 0;
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
  s.pressure = 0; // channel pressure 0..1
  s.press_exc = 0;
  s.press_vib = 0;
  s.press_bright = 0;
  s.mesh_mask = new Float64Array(MESH_CELLS);
  s.mesh_spans = new Int32Array(2 * MESH_MAX);
  s.mesh_rows = 0;
  s.mesh_n = 0;
  s.mesh_shape = -1;
  s.mesh_mu = 1;
  room_init(s);
  s.amp_l = amp_create();
  s.amp_r = amp_create();
  s.sb = new Float64Array(SB_MODES * 8);
  s.sb_l = 0;
  s.sb_r = 0;
  soundboard_setup(s);
  s.org_w = new Float64Array(9);
  s.org_sn = new Float64Array(17);
  s.modwheel = 0;
  s.rot_line = {};
  delay_init(s.rot_line, ROTARY_LEN);
  s.rot_xo = {};
  onepole_init(s.rot_xo);
  s.horn_ph = 0;
  s.drum_ph = 0;
  s.horn_hz = 0.8;
  s.drum_hz = 0.65;
  s.p = {};
  // sidechain input (the host writes sc_in_l / sc_in_r before each phys_render; JSFX pins 3/4)
  s.sc = {};
  sidechain_init(s.sc);
  s.sc_in_l = 0;
  s.sc_in_r = 0;
  s.out_l = 0;
  s.out_r = 0;
}

export function phys_update(s, p) {
  // Release deferred note-offs using the old voice model before changing it.
  if (p.phys_model !== s.p.phys_model || (p.phys_model === MODEL_MODAL && p.modal_material !== s.p.modal_material) || !phys_pedal_enabled(p)) phys_flush_sustain(s);
  s.p = p;
  if (!s.custom_scale) tuning_set_edo(s.tuning, p.tuning_divisions, p.tuning_period_cents);
  s.tuning.ref_note = p.tuning_ref_note;
  s.tuning.ref_hz = p.tuning_ref_hz;
  s.gain = db_to_gain(p.phys_volume_db);
  s.damp_b = 0.05 + 0.9 * p.string_damping; // one-pole coefficient in the loop
  s.vib_inc = p.phys_vibrato_rate_hz / s.sr;
  s.press_exc = p.phys_pressure_excitation || 0;
  s.press_vib = p.phys_pressure_vibrato_cents || 0;
  s.press_bright = p.phys_pressure_brightness || 0;
  s.flut_a = 1 - Math.exp((-TWO_PI * 5) / s.sr);
  room_update(s, p.phys_room_decay_ms);
  sidechain_set(s.sc, p.sc_input_gain_db, p.sc_attack_ms, p.sc_release_ms, p.sc_duck_db, s.sr);
  amp_update(s, p);
  s.hiss_a = 1 - Math.exp((-TWO_PI * 1000) / s.sr);
  s.reed_k = 1 / (2 * Math.sin((Math.PI * 1000) / s.sr));
  s.fr_bias = 0.25 + 0.3 * (p.wind_embouchure ?? 0.5);
  s.fr_det = Math.pow(2, (p.free_reed_detune_cents ?? 0) / 1200);
  s.fr_n = (p.free_reed_detune_cents ?? 0) > 0 ? 3 : 1;
  s.saw = p.string_sawari ?? 0;
  sympathetic_update(s);
  s.saw_c = 0.8 - 0.55 * s.saw;
  s.saw_env_c = Math.exp(-1 / (0.03 * s.sr));
  s.saw_dc_a = 1 - Math.exp((-TWO_PI * 5) / s.sr);
  s.saw_m_a = 1 - Math.exp(-1 / (0.02 * s.sr));
  for (let j = 0; j < 9; j++) {
    const bar = clamp(Math.round(p[ORGAN_BARS[j]] ?? 0), 0, 8);
    s.org_w[j] = bar > 0 ? ORGAN_GAIN * db_to_gain(3 * (bar - 8)) : 0;
  }
  const perc = Math.round(p.organ_percussion ?? 0);
  s.org_perc_k = perc === 1 ? 4 : perc === 2 ? 6 : 0;
  s.org_perc_coef = t60_coef(p.organ_perc_decay_ms ?? 300, s.sr);
  s.org_perc_lvl = 2 * ORGAN_GAIN * (p.organ_perc_level ?? 0);
  s.org_click_len = Math.max(1, Math.round(0.004 * s.sr));
  s.org_click = 0.4 * (p.organ_click ?? 0);
  const rot_mode = Math.round(p.rotary_mode ?? 0);
  if (rot_mode > 0 && !(s.rot_mode > 0)) {
    // the bypassed speaker kept its last sound; start it again from silence
    delay_clear(s.rot_line);
    s.rot_xo.z = 0;
  }
  s.rot_mode = rot_mode;
  s.rot_mix = p.rotary_mix ?? 1;
  onepole_set(s.rot_xo, 800, s.sr);
  s.rot_d0 = Math.max(1, 0.0002 * s.sr);
  s.rot_dd = 0.00035 * s.sr;
  s.horn_c = 1 - Math.exp(-1 / (0.5 * s.sr));
  s.drum_c = 1 - Math.exp(-1 / (3 * s.sr));
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
  // the cells inside the shape: one contiguous run per row (both shapes are convex)
  s.mesh_rows = 0;
  for (let i = 0; i < n; i++) {
    let start = -1;
    let end = -1;
    for (let j = 0; j < n; j++) {
      const c = (i + 1) * MESH_W + (j + 1);
      if (m[c] !== 0) {
        if (start < 0) start = c;
        end = c + 1;
      }
    }
    if (start >= 0) {
      s.mesh_spans[2 * s.mesh_rows] = start;
      s.mesh_spans[2 * s.mesh_rows + 1] = end;
      s.mesh_rows++;
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
  const n = clamp(Math.floor(L - 0.5), 1, MAX_DELAY - 2);
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

/**
 * Inharmonicity coefficient B of a piano string (partial n at n*f1*sqrt(1 + B n^2)).
 * Roughly the measured curve: ~1.5e-4 in the bass rising to ~1e-2 at the top; the knob
 * scales it quadratically (0.35 = a typical piano, 1 = ~8x).
 */
function stiff_b(hz, amount) {
  const k = amount / 0.35;
  return 1.5e-4 * (1 + Math.pow(hz / 262, 1.5)) * k * k;
}

/**
 * Coefficient a (-0.95..0) of the N_AP dispersion all-passes that puts partial n where a
 * string with inharmonicity B has it: n = 8, or fewer for high notes so that partial n stays
 * below half Nyquist (where one-pole all-passes still follow the stiff-string curve).
 * Bisection on the loop phase delay difference between the fundamental and partial n; the
 * all-passes must also leave room for a delay line of at least 3 samples.
 */
function dispersion_coef(hz, B, b_lp, sr) {
  const w1 = (TWO_PI * hz) / sr;
  const n = Math.min(8, Math.floor((0.5 * Math.PI) / w1));
  if (n < 2 || B <= 0) return 0;
  const wn = n * w1;
  const period = sr / hz;
  const target = period * (1 - 1 / Math.sqrt(1 + B * n * n)) - (lp1_phase_delay(b_lp, w1) - lp1_phase_delay(b_lp, wn));
  if (target <= 0) return 0;
  const room = period - lp1_phase_delay(b_lp, w1) - 3;
  let lo = -0.95;
  let hi = 0;
  for (let it = 0; it < 40; it++) {
    const mid = 0.5 * (lo + hi);
    const pd1 = N_AP * ap1_phase_delay(mid, w1);
    // too much dispersion, or no room left for the delay line -> less negative
    if (pd1 - N_AP * ap1_phase_delay(mid, wn) > target || pd1 > room) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Force pulse of a felt hammer hitting a string, as string velocity F/2Z (written to out[],
 * returns its length). Hammer: m x'' = -F, F = K d^2.5 (d = felt compression). String at
 * the strike point moves at (F(t) - F(t - beta*period)) / 2Z: the wave reflected (inverted)
 * from the near end comes back and pushes the hammer off. HAM_SUB sub-steps per sample.
 */
function hammer_force(out, hz, v0, hardness, beta, sr) {
  const m = clamp(0.0087 * Math.pow(262 / hz, 0.3), 0.004, 0.012); // hammer mass, kg
  const Z = 2 * Math.pow(262 / hz, 0.2); // string wave impedance, kg/s
  const K = 250000000 * Math.pow(100, hardness - 0.5); // felt stiffness, N/m^2.5
  const dt = 1 / (sr * HAM_SUB);
  const lag = Math.max(1, Math.round((beta * sr * HAM_SUB) / hz));
  const max_n = Math.min(EXC_MAX, Math.floor(0.03 * sr));
  let vh = v0;
  let d = 0;
  let i = 0;
  let n = 0;
  while (n < max_n) {
    let acc = 0;
    for (let j = 0; j < HAM_SUB; j++) {
      const F = d > 0 ? K * Math.pow(d, 2.5) : 0;
      ham_hist[i] = F;
      const back = i >= lag ? ham_hist[i - lag] : 0;
      vh -= (F / m) * dt;
      d += (vh - (F - back) / (2 * Z)) * dt;
      acc += F;
      i++;
    }
    out[n] = acc / (HAM_SUB * 2 * Z);
    n++;
    // the hammer has left the string
    if (d <= 0 && vh < 0 && n > 3) break;
  }
  return n;
}

// Soundboard: SB_MODES resonances (dense and long in the bass, short in the treble) fed by
// the bridge (sum of the piano strings). It is what actually radiates a piano's sound and
// colours every note the same way, like a real instrument body. 8 values per mode:
// k a1 a2 a3 ic1 ic2 gainL gainR (TPT state variable band-pass; bp * k has peak gain 1).
function soundboard_setup(s) {
  const sb = s.sb;
  for (let k = 0; k < SB_MODES; k++) {
    const f = 75 * Math.pow(2800 / 75, k / (SB_MODES - 1)) * (1 + 0.06 * Math.sin(2.3 * k + 1));
    const t60 = clamp(0.35 * Math.pow(150 / f, 0.4), 0.05, 0.6);
    const kk = 1 / clamp((Math.PI * f * t60) / 6.908, 2, 60);
    const g = Math.tan((Math.PI * Math.min(f, s.sr * 0.45)) / s.sr);
    const o = k * 8;
    sb[o] = kk;
    sb[o + 1] = 1 / (1 + g * (g + kk));
    sb[o + 2] = g * sb[o + 1];
    sb[o + 3] = g * sb[o + 2];
    sb[o + 4] = 0;
    sb[o + 5] = 0;
    const gain = ((0.7 + 0.3 * Math.cos(1.7 * k)) / (1 + f / 1500)) * 0.45;
    // alternate modes lean left / right: the board is wide, and so is its sound
    sb[o + 6] = gain * (k % 2 === 0 ? 1.3 : 0.7);
    sb[o + 7] = gain * (k % 2 === 0 ? 0.7 : 1.3);
  }
}

function soundboard_process(s, x) {
  const sb = s.sb;
  let l = 0;
  let r = 0;
  for (let k = 0; k < SB_MODES; k++) {
    const o = k * 8;
    const v3 = x - sb[o + 5];
    const v1 = sb[o + 1] * sb[o + 4] + sb[o + 2] * v3;
    const v2 = sb[o + 5] + sb[o + 2] * sb[o + 4] + sb[o + 3] * v3;
    sb[o + 4] = 2 * v1 - sb[o + 4];
    sb[o + 5] = 2 * v2 - sb[o + 5];
    const bp = v1 * sb[o];
    l += bp * sb[o + 6];
    r += bp * sb[o + 7];
  }
  s.sb_l = l;
  s.sb_r = r;
}

/**
 * mouth pressure: the knob (plus aftertouch x Pressure to Breath / Bow), scaled by the velocity
 * over up to 20 dB (Velocity Amount)
 */
function brass_pressure(s, p, v) {
  const knob = clamp(p.brass_pressure + s.press_exc * v.press, 0, 1);
  return clamp((0.2 + 0.8 * knob) * Math.pow(10, p.phys_velocity_amount * (v.vel_raw - 1)), 0.05, 1);
}

/** bow friction slope from Bow Pressure (plus aftertouch) */
function bow_slope(s, p, v) {
  return 5 - 4 * clamp(p.bow_pressure + s.press_exc * v.press, 0, 1);
}

/** Wind Type as an integer (WIND_CLARINET .. WIND_FREE_REED) */
function wind_kind(p) {
  return Math.floor(p.wind_type + 0.5);
}

/** wind: breath pressure (plus aftertouch) -> reed pressure / jet strength (needs v.slope / v.jet_boost) */
function wind_maxv(s, p, v) {
  const bp = clamp(p.breath_pressure + s.press_exc * v.press, 0, 1);
  const kind = wind_kind(p);
  // free reed: how far the tongue swings (it only sounds once it clears the slot overlap)
  if (kind === WIND_FREE_REED) return 0.3 + 0.7 * bp;
  // a conical bore needs a little more reed pressure to start
  if (kind >= WIND_SAX) return (0.24 + 0.05 * bp) / -v.slope;
  if (kind === WIND_CLARINET) return (0.2 + 0.06 * bp) / -v.slope;
  return (0.6 + 0.4 * bp) * v.jet_boost;
}

/** drive multiple 1.1 .. 3 from Lip Buzz and the (velocity scaled) pressure, half each */
function brass_mult(p, press) {
  const x = clamp(0.5 * p.brass_lip + (0.5 * (press - 0.2)) / 0.8, 0, 1);
  return BRASS_MULTS[0] + (BRASS_MULTS[BRASS_MULTS.length - 1] - BRASS_MULTS[0]) * x;
}

/** position on the BRASS_MIN_DRIVE / BRASS_SHARP note grid */
function brass_col(note) {
  return clamp((note - BRASS_NOTE0) / 4, 0, BRASS_MIN_DRIVE.length - 1.000001);
}

function brass_min_drive(note) {
  const u = brass_col(note);
  const i = Math.floor(u);
  return BRASS_MIN_DRIVE[i] + (BRASS_MIN_DRIVE[i + 1] - BRASS_MIN_DRIVE[i]) * (u - i);
}

/** bilinear lookup in BRASS_SHARP (note grid x drive multiples) */
function brass_sharp(note, mult) {
  const u = brass_col(note);
  const i = Math.floor(u);
  const fu = u - i;
  let j = 0;
  while (j < BRASS_MULTS.length - 2 && mult > BRASS_MULTS[j + 1]) j++;
  const fv = clamp((mult - BRASS_MULTS[j]) / (BRASS_MULTS[j + 1] - BRASS_MULTS[j]), 0, 1);
  const a = BRASS_SHARP[j];
  const b = BRASS_SHARP[j + 1];
  return (a[i] * (1 - fu) + a[i + 1] * fu) * (1 - fv) + (b[i] * (1 - fu) + b[i + 1] * fu) * fv;
}

/** gain of the one-pole low-pass y = (1-b)x + b*y1 at w */
function lp1_gain(b, w) {
  return (1 - b) / Math.sqrt(1 - 2 * b * Math.cos(w) + b * b);
}

/** Mesh damping s for a T60 of `ms`: (1-s)/(1+s) = coef^2. */
function mesh_sigma(ms, sr) {
  const c = t60_coef(ms, sr);
  const g = c * c;
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
      // (modes below the note ring longer; the floor keeps a sub mode's decay finite at full damping)
      if (!keep_decay) v.mode_t60[k] = p.modal_decay_ms / Math.max(0.25, 1 + p.modal_high_damping * 4 * (ratio - 1));
      const pos_w = Math.abs(Math.sin(Math.PI * (k + 1) * p.modal_strike_position));
      reson_set(v.modes[k], v.mode_hz[k], v.mode_t60[k], mat.gains[k] * (0.3 + 0.7 * pos_w), sr);
    }
  } else if (model === MODEL_BOWED) {
    // loop = bow->nut line + bow->bridge line + bridge low-pass
    const b = 0.1 + 0.75 * (1 - clamp(p.bowed_brightness + s.press_bright * v.press, 0, 1));
    v.damp_b = b;
    const total = sr / hz - lp_phase_delay(b, hz, sr);
    v.delay_len = clamp(total * p.bow_position, 2, MAX_DELAY - 2); // bridge side
    v.delay_len2 = clamp(total * (1 - p.bow_position), 2, MAX_DELAY - 2); // nut side
  } else if (model === MODEL_BRASS) {
    // drive: a multiple of what this note needs to speak, set by Lip Buzz and the pressure
    // (which also follows the velocity)
    const press = brass_pressure(s, p, v);
    const note = 69 + (12 * Math.log(hz / 440)) / Math.LN2;
    const mult = brass_mult(p, press);
    const drive = brass_min_drive(note) * mult;
    // bore and lips scaled together by the measured residual -> the pitch lands on the note
    const f = hz * Math.pow(2, -brass_sharp(note, mult) / 1200);
    v.delay_len = clamp((2 * sr) / f, 2, MAX_DELAY - 2);
    // lip bandwidth: 42 Hz, narrower (Q ~7) for low notes so they still buzz
    const r = Math.exp((-Math.PI * Math.min(42, 0.15 * f)) / sr);
    const w = (TWO_PI * f) / sr;
    v.lip_a1 = -2 * r * Math.cos(w);
    v.lip_a2 = r * r;
    // peak gain normalised (so low and high notes saturate alike), divided by the mouth pressure
    v.lip_g = (drive * hz * 2 * Math.sin(w) * (1 - r)) / (0.3 * press);
    v.maxv = press;
    v.dc_r = Math.exp((-TWO_PI * 0.05 * f) / sr);
    // high frequencies leave through the bell instead of reflecting back down the bore
    v.refl_b = Math.exp((-TWO_PI * Math.max(1500, 5 * f)) / sr);
    v.rad_k = 1 / (2 * Math.sin(w / 2));
    v.bell_b = Math.exp((-TWO_PI * (1500 + 6000 * clamp(p.brass_bell + s.press_bright * v.press, 0, 1))) / sr);
  } else if (model === MODEL_WIND) {
    const kind = wind_kind(p);
    if (kind === WIND_FREE_REED) {
      // the reed's own pitch; the musette reeds above / below; radiation = first difference
      v.org_inc = hz / sr;
      v.fr_inc2 = v.org_inc * s.fr_det;
      v.fr_inc3 = v.org_inc / s.fr_det;
      v.rad_k = 1 / (2 * Math.sin((Math.PI * hz) / sr));
    } else if (kind >= WIND_SAX) {
      // saxophone / oboe (after Scavone, STK Saxofony): a cone behaves like a cylinder open at
      // both ends, so the loop is one period long (all harmonics) instead of two. The reed sits
      // at CONE_REED_POS of the loop: it hears the wave reflected at the bell and the same wave
      // a little later, which carves the formant-like dips of a truncated cone.
      v.damp_b = Math.exp((-TWO_PI * Math.max(kind === WIND_SAX ? 2500 : 3500, 6 * hz)) / sr);
      // measured residual of the reed loop (cents flat), x = octaves above C4 at 48 kHz
      const x = Math.log((hz * 48000) / (sr * 261.63)) / Math.log(2);
      const flat = kind === WIND_SAX ? clamp(2.5 + 4 * x, 2, 7) : clamp(1.5 + 3.5 * x, 1, 9);
      const total = clamp((sr / hz) * Math.pow(2, -flat / 1200) - lp_phase_delay(v.damp_b, hz, sr), 4, 2 * MAX_DELAY - 4);
      v.delay_len2 = clamp(CONE_REED_POS[kind] * total, 2, MAX_DELAY - 2);
      v.delay_len = clamp(total - v.delay_len2, 2, MAX_DELAY - 2);
      // the bell radiates the bore pressure high-passed (~ its time derivative): a first
      // difference, normalised to unity gain at the fundamental like the brass bell
      v.rad_k = 1 / (2 * Math.sin((Math.PI * hz) / sr));
    } else if (kind === WIND_CLARINET) {
      // clarinet: inverting reflection at the bell -> period = 2 x (bore + reflection low-pass).
      // The low-pass stands in for the tone-hole lattice / bell, which lets high frequencies
      // escape instead of reflecting (~1.5 kHz), so upper harmonics do not keep building up.
      v.damp_b = Math.exp((-TWO_PI * Math.max(1500, 5 * hz)) / sr);
      v.delay_len = clamp((0.5 * sr) / hz - lp_phase_delay(v.damp_b, hz, sr), 2, MAX_DELAY - 2);
    } else {
      // flute (after Fletcher / Verge): the acoustic flow at the mouth hole deflects the air
      // jet, which reaches the labium edge a jet delay later and is split in / out of the pipe
      // by a saturating curve. The jet delay is ~ one period, where the loop speaks on the bore
      // pitch; the embouchure is the jet offset against the edge (even harmonics).
      v.damp_b = 0.7 - (0.1 * 22050) / sr;
      // measured residual of the jet loop (cents sharp), x = octaves above C5 at 48 kHz
      const x = Math.log((hz * 48000) / (sr * 523.25)) / Math.log(2);
      const sharp = 10.7 * x + 3.1 * x * x;
      const total = (sr / hz) * Math.pow(2, sharp / 1200);
      v.delay_len = clamp(total - lp_phase_delay(v.damp_b, hz, sr), 2, MAX_DELAY - 2);
      v.delay_len2 = clamp(v.delay_len * FLUTE_JET_RATIO, 2, MAX_DELAY - 2);
      v.jet_bias = 0.1 + 0.4 * p.wind_embouchure;
      // high notes need a faster (harder blown) jet
      v.jet_boost = clamp(1 + 0.5 * (Math.log((hz * 48000) / (sr * 1046.5)) / Math.log(2)), 1, 1.6);
    }
  } else if (model === MODEL_ORGAN) {
    v.org_inc = (0.5 * hz) / sr;
  } else if (model === MODEL_MESH) {
    const w = (TWO_PI * hz) / sr;
    v.mesh_c2 = Math.min(0.49, (2 * (1 - Math.cos(w))) / s.mesh_mu);
    v.mesh_omega = w;
  } else {
    // stiff string: two strings, detuned by +/- half the unison detune
    // the loop low-pass costs a high string far more per second (many more round trips),
    // so it is relaxed above middle C to keep the treble ringing
    // (and much more above C7, where even the fundamental makes thousands of trips per second)
    const b = (0.05 + 0.6 * p.piano_damping) * clamp(Math.sqrt(262 / hz), 0.15, 1) * Math.min(1, Math.pow(2093 / hz, 3));
    v.damp_b = b;
    // dispersion all-pass coefficient (< 0 = upper partials sharp) for this note's target B
    const a = dispersion_coef(hz, stiff_b(hz, p.piano_inharmonicity), b, sr);
    v.ap_a = a;
    const det = Math.pow(2, p.piano_unison_detune_cents / 2400);
    const hzA = hz * det;
    const hzB = hz / det;
    const wA = (TWO_PI * hzA) / sr;
    const wB = (TWO_PI * hzB) / sr;
    // integer delay + a tuning all-pass for the fraction (linear interpolation would damp
    // the treble strings, which make many round trips per second)
    // without dispersion (top notes) the all-passes are bypassed: each would still be a
    // one-sample delay, and the loop of a C9 string is under 6 samples
    v.n_ap = a === 0 ? 0 : N_AP;
    thiran_split(v, 0, sr / hzA - lp1_phase_delay(b, wA) - v.n_ap * ap1_phase_delay(a, wA), wA);
    thiran_split(v, 1, sr / hzB - lp1_phase_delay(b, wB) - v.n_ap * ap1_phase_delay(a, wB), wB);
    if (!keep_decay) {
      // higher strings decay faster
      const t = Math.max(p.piano_decay_ms, 1) * clamp(Math.pow(220 / hz, 0.4), 0.25, 2) * 0.001;
      // the loop low-pass also takes a little off the fundamental on every round trip, which
      // adds up in the top octaves (thousands of trips per second): divide it back out so the
      // fundamental decays in the set time (C9 used to die within ~50 ms, leaving a click)
      v.loop_gain = Math.min(0.99999, Math.exp(-6.907755 / (hzA * t)) / lp1_gain(b, wA));
      v.loop_gain2 = Math.min(0.99999, Math.exp(-6.907755 / (hzB * t)) / lp1_gain(b, wB));
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
  v.sustained = 0; // a retrigger/steal must not inherit the old note's deferred release
  v.age = ++s.age_counter;
  v.frames = 0;
  v.level = 1;
  v.poly_at = 0;
  v.press = s.pressure;
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
        if (p.string_plectrum > 0) {
          // Displacement released by a plectrum; the existing pick comb still colors it.
          const q = i / n;
          const pos = clamp(p.string_pick_position, 0.02, 0.98);
          const displacement = q < pos ? q / pos : (1 - q) / (1 - pos);
          x += 0.65 * p.string_plectrum * (displacement - 0.5 - x);
        }
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
    v.saw_env = 0;
    v.saw_dc = 0;
    v.saw_mx = 0;
    v.saw_my = 0;
    v.saw_g = 1;
    v.saw_on = 1;
    v.bachi_t = 0;
    const hard = clamp(p.string_plectrum_hardness * (0.6 + 0.4 * vel), 0, 1);
    v.bachi_len = Math.max(2, Math.round(sr * (0.0012 - 0.001 * hard)));
    for (let k = 0; k < 3; k++) {
      reson_reset(v.modes[k]);
      // Short, bright skin contact: avoid the long low mode that sounds like a wood block.
      // Hard bachi contact should snap rather than leave a small pitched drum tail.
      reson_set(v.modes[k], [950, 2300, 4800][k], [30, 18, 10][k] * (1 - 0.5 * hard), [0.08, 0.85, 0.65][k], sr);
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
    v.slope = bow_slope(s, p, v);
    svf_set(v.body1, 290, 0.6, sr);
    svf_set(v.body2, 1150, 0.9, sr);
  } else if (model === MODEL_BRASS) {
    if (v.env.stage === 0) {
      delay_clear(v.line);
      v.lip_y1 = 0;
      v.lip_y2 = 0;
      v.dc_x = 0;
      v.dc_y = 0;
      v.bell_z = 0;
      v.refl_z = 0;
      v.rad_x = 0;
      v.steep.buf.fill(0);
      v.steep.w = 0;
      v.env.value = 0;
    }
    // The tongue: lips at rest only start to buzz once a tiny disturbance has grown, which took
    // 50 - 400 ms (longer for soft and low notes). A player's tongue release sets the air in
    // the bore moving at once and the lips respond more readily for the first moments: seed
    // the bore with the wave of the note and boost the lip gain, decaying over the attack time
    // (at least BRASS_BOOST_PERIODS periods).
    v.boost = BRASS_BOOST;
    // (time constant a third of that, so it is gone by the time the note has settled)
    v.boost_c = Math.exp(-3 / Math.max(p.brass_attack_ms * 0.001 * sr, (BRASS_BOOST_PERIODS * sr) / v.hz));
    if (v.env.stage === 0) {
      const n = Math.ceil(v.delay_len);
      const w = (TWO_PI * 2) / v.delay_len;
      for (let i = 0; i < n; i++) delay_write(v.line, BRASS_SEED * 0.3 * v.maxv * Math.sin(w * i));
    }
    adsr_set(v.env, p.brass_attack_ms, 1, 1, Math.min(p.phys_release_ms, 400), sr);
    adsr_gate_on(v.env);
  } else if (model === MODEL_WIND) {
    if (v.env.stage === 0) {
      delay_clear(v.line);
      delay_clear(v.line2);
      v.lp_z = 0;
      v.lp_z2 = 0;
      v.dc.z = 0;
      v.env.value = 0;
      v.flut = 0;
      v.hiss_lp = 0;
      // At zero tongue displacement the biased slot can already pass DC flow.
      // Seed the differentiator at that rest flow, including all musette reeds;
      // zero would radiate a full-scale impulse before the attack envelope rises.
      v.rad_x = wind_kind(p) === WIND_FREE_REED ? free_reed_flow(s, 0) * (s.fr_n > 1 ? 1.8 : 1) : 0;
      v.rad_x2 = 0;
      svf_reset(v.body1);
      v.org_ph = 0;
      v.fr_ph2 = 0.33;
      v.fr_ph3 = 0.67;
    }
    onepole_set(v.dc, 20, sr);
    svf_set(v.body1, 1600, 1.2, sr);
    adsr_set(v.env, p.wind_attack_ms, 1, 1, Math.min(p.phys_release_ms, 400), sr);
    adsr_gate_on(v.env);
    // Both instruments only speak inside a band of blowing pressure, so the knobs move the
    // pressure within that band (velocity sets the output level instead).
    if (wind_kind(p) !== WIND_FLUTE) {
      // reed stiffness (slope) x pressure must stay around 0.2 .. 0.26
      v.slope = -(0.2 + 0.25 * p.wind_embouchure);
    }
    // (flute) jet strength: below ~0.5 the jet is too weak to keep the pipe going
    v.maxv = wind_maxv(s, p, v);
  } else if (model === MODEL_ORGAN) {
    // single-trigger percussion: only when no other key is down
    let others = 0;
    for (let i = 0; i < limit; i++) if (i !== idx && s.voices[i].active && s.voices[i].gate) others = 1;
    v.org_perc = others ? 0 : 1;
    v.org_clk = s.org_click > 0 ? s.org_click_len : 0;
    adsr_set(v.env, 1.5, 1, 1, p.phys_release_ms, sr);
    adsr_gate_on(v.env);
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
    // Hammer: a felt hammer (mass m, force K * compression^2.5) is thrown at the string, which
    // pushes back as a resistance 2Z plus the wave reflected from the near end. Felt gets
    // stiffer the harder it is compressed, so a faster hammer gives a shorter, sharper force
    // pulse: louder AND brighter - the main thing that makes a piano sound like a piano.
    // The force pulse (string velocity F/2Z) is the excitation, with the strike position comb
    // and a little key / action thump (low-passed noise) on top.
    const n = Math.ceil(v.delay_len);
    // hammer speed in m/s: soft and even up to mf (vel 80 ~1.5), fast only near ff (5)
    const v0 = 0.3 + 4.7 * vel * vel * vel;
    const e = v.exc;
    const len = hammer_force(e, v.hz, v0, p.piano_hammer_hardness, p.piano_strike_position, sr);
    // The loop carries what the bridge feels (string velocity / slope, not displacement), so
    // the velocity pulse goes in as it is, through the strike position comb, with the DC removed
    // (a string fixed at both ends has no DC mode, but the loop does).
    const pick = Math.max(1, Math.round(p.piano_strike_position * n));
    const total = Math.min(EXC_MAX, Math.max(len + pick + 1, Math.round(0.03 * sr)));
    for (let i = len; i < total; i++) e[i] = 0;
    for (let i = total - 1; i >= pick; i--) e[i] -= e[i - pick];
    // High-pass (PIANO_HP one-poles at 0.8 x the fundamental): in the treble the hammer stays on
    // the string for several periods, and what the pulse has below the fundamental is not a
    // string mode - it only passes through the loop and is heard as a click at the start.
    const hp_a = 1 - Math.exp((-TWO_PI * 0.8 * v.hz) / sr);
    const hp = v.hp;
    for (let k = 0; k < PIANO_HP; k++) hp[k] = 0;
    for (let i = 0; i < total; i++) {
      let x = e[i];
      for (let k = 0; k < PIANO_HP; k++) {
        hp[k] += hp_a * (x - hp[k]);
        x -= hp[k];
      }
      e[i] = x;
    }
    // Normalise at the fundamental: the level follows the velocity (Velocity Amount, as on the
    // other models) and is even across the keyboard, while the hammer physics decides how
    // strong the upper partials are (a long, soft contact in the treble barely excites them).
    // Top octaves (from sr/16, ~G7 at 48 kHz, fully from sr/10): only a few harmonics are left
    // below Nyquist and the hammer stays on for many periods, so most of the pulse is nowhere
    // near a string mode (heard as a click) and the fundamental may even sit in a notch of its
    // spectrum. Fade towards a burst at the fundamental (a sine under a raised-cosine window as
    // long as the contact) carrying the fundamental the pulse has, or 30 % of the level around it.
    const top = clamp((v.hz - sr / 16) / (sr / 10 - sr / 16), 0, 1);
    if (top > 0) {
      const w0 = (TWO_PI * v.hz) / sr;
      const at = (w) => {
        let re = 0;
        let im = 0;
        for (let i = 0; i < total; i++) {
          re += e[i] * Math.cos(w * i);
          im += e[i] * Math.sin(w * i);
        }
        return Math.sqrt(re * re + im * im);
      };
      let around = 0;
      for (let k = 0; k < 5; k++) around = Math.max(around, at(w0 * (0.8 + 0.1 * k)));
      const want = Math.max(at(w0), 0.3 * around);
      const blen = Math.min(total, Math.max(len, Math.ceil((2 * sr) / v.hz)));
      const amp = want / (blen / 4); // |burst at f0| ~ amp * blen / 4
      for (let i = 0; i < total; i++) {
        const burst = i < blen ? amp * (0.5 - 0.5 * Math.cos((TWO_PI * i) / blen)) * Math.sin(w0 * i) : 0;
        e[i] = (1 - top) * e[i] + top * burst;
      }
    }
    // (if the fundamental falls into a notch of the pulse spectrum - the contact time is close to
    // a multiple of the period - use 30 % of the level around it, or the note would blow up)
    let mag = 0;
    let around = 0;
    for (let k = 0; k < 5; k++) {
      const w = (TWO_PI * v.hz * (0.8 + 0.1 * k)) / sr;
      let re = 0;
      let im = 0;
      for (let i = 0; i < total; i++) {
        re += e[i] * Math.cos(w * i);
        im += e[i] * Math.sin(w * i);
      }
      const m = Math.sqrt(re * re + im * im);
      if (k === 2) mag = m;
      if (m > around) around = m;
    }
    mag = Math.max(mag, 0.3 * around);
    // (bass strings build up more per hit: -9 dB / octave keeps the keyboard even; a faster
    // hammer is also somewhat louder, on top of Velocity Amount, for a piano-like dynamic range)
    const scale = (HAM_GAIN * Math.pow(clamp(v.hz / 262, 0.35, 8), -1.5) * Math.pow(v0 / 2, 0.6)) / Math.max(1e-12, mag);
    // plus a little key / action thump (decaying low-passed noise)
    const decay = Math.exp(-1 / (0.004 * sr));
    const thump_a = 1 - Math.exp((-TWO_PI * 600) / sr);
    let env = 0.02 * vel;
    let lp = 0;
    for (let i = 0; i < total; i++) {
      lp += thump_a * (noise_white() - lp);
      e[i] = e[i] * scale + lp * env;
      env *= decay;
    }
    v.exc_len = total;
    v.exc_t = 0;
    v.read_gain = 0.9 * v.vel * clamp(Math.pow(v.hz / 220, 0.3), 0.7, 2);
  }
}

/** Auto is for ringing/damped instruments; continuous excitation needs explicit On. */
export function phys_pedal_enabled(p) {
  const mode = Math.round(p.phys_sustain_mode ?? 1);
  const model = Math.round(p.phys_model);
  return mode === 2 || (mode === 1 && (model === MODEL_STRING || model === MODEL_STIFF ||
    (model === MODEL_MODAL && Math.round(p.modal_material) !== 5)));
}

function phys_release_voice(s, v) {
  const p = s.p;
  const model = Math.floor(p.phys_model + 0.5);
  if (model === MODEL_STRING) {
    const g_rel = Math.exp(-6.907755 / (v.hz * p.phys_release_ms * 0.001));
    v.loop_gain = Math.min(v.loop_gain, g_rel);
    v.saw_on = 0;
    v.saw_g = 1;
  } else if (model === MODEL_MODAL) {
    for (let k = 0; k < MAX_MODES; k++) {
      v.mode_t60[k] = Math.min(v.mode_t60[k], p.phys_release_ms);
      reson_set_decay(v.modes[k], v.mode_hz[k], v.mode_t60[k], s.sr);
    }
  } else if (model === MODEL_BOWED || model === MODEL_WIND || model === MODEL_BRASS || model === MODEL_ORGAN) {
    adsr_gate_off(v.env);
  } else if (model === MODEL_MESH) {
    v.mesh_sig = Math.max(v.mesh_sig, mesh_sigma(Math.min(p.mesh_decay_ms, p.phys_release_ms), s.sr));
  } else {
    const g_rel = Math.exp(-6.907755 / (v.hz * p.phys_release_ms * 0.001));
    v.loop_gain = Math.min(v.loop_gain, g_rel);
    v.loop_gain2 = Math.min(v.loop_gain2, g_rel);
  }
}

function phys_flush_sustain(s) {
  for (const v of s.voices) {
    if (v.sustained && v.active) phys_release_voice(s, v);
    v.sustained = 0;
  }
}

export function phys_note_off(s, note) {
  for (const v of s.voices) {
    if (!v.active || !v.gate || v.note !== note) continue;
    v.gate = 0;
    if (s.sustain_pedal && phys_pedal_enabled(s.p)) v.sustained = 1;
    else phys_release_voice(s, v);
  }
}

export function phys_sustain_pedal(s, on) {
  s.sustain_pedal = on ? 1 : 0;
  if (!s.sustain_pedal) phys_flush_sustain(s);
}

export function phys_all_notes_off(s) {
  // Panic/All Notes Off must also release notes whose keys have already been lifted.
  s.sustain_pedal = 0;
  for (const v of s.voices) {
    if (v.active && (v.gate || v.sustained)) phys_release_voice(s, v);
    v.gate = 0;
    v.sustained = 0;
  }
}

/** value -1..1: retunes active voices (the delay length / resonator frequencies follow). */
export function phys_pitch_bend(s, value) {
  s.bend_ratio = Math.pow(2, (clamp(value, -1, 1) * s.p.phys_pitch_bend_range_cents) / 1200);
  for (let i = 0; i < PHYS_MAX_VOICES; i++) if (s.voices[i].active) voice_tune(s, s.voices[i], true);
}

/**
 * Aftertouch changed for a sounding voice: the continuously blown / bowed models follow it
 * (Pressure to Breath / Bow and Pressure to Brightness); vibrato depth follows in phys_render.
 */
function voice_pressure(s, v) {
  v.press = Math.max(s.pressure, v.poly_at);
  if (s.press_exc <= 0 && s.press_bright <= 0) return;
  const p = s.p;
  const model = Math.floor(p.phys_model + 0.5);
  if (model === MODEL_BOWED) {
    v.slope = bow_slope(s, p, v);
    if (s.press_bright > 0) voice_tune(s, v, true);
  } else if (model === MODEL_WIND) {
    v.maxv = wind_maxv(s, p, v);
  } else if (model === MODEL_BRASS) {
    voice_tune(s, v, true);
  }
}

/** Channel pressure (MIDI 0xD0), value 0..1. */
export function phys_channel_pressure(s, value) {
  s.pressure = clamp(value, 0, 1);
  for (let i = 0; i < PHYS_MAX_VOICES; i++) if (s.voices[i].active) voice_pressure(s, s.voices[i]);
}

/** Polyphonic aftertouch (MIDI 0xA0) of one key, value 0..1. */
export function phys_poly_pressure(s, note, value) {
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (v.active && v.note === note) {
      v.poly_at = clamp(value, 0, 1);
      voice_pressure(s, v);
    }
  }
}

/** Reset All Controllers (CC121): channel pressure and every key's aftertouch back to 0. */
export function phys_pressure_reset(s) {
  for (let i = 0; i < PHYS_MAX_VOICES; i++) s.voices[i].poly_at = 0;
  phys_channel_pressure(s, 0);
}

// ---------------------------------------------------------------------------
// Per-model sample renderers (return the voice's mono output)

function render_string(s, v, vib) {
  // read the oldest sample, damp it, feed it back
  const x = delay_read(v.line, v.delay_len / vib);
  v.lp_z = (1 - v.damp_b) * x + v.damp_b * v.lp_z;
  let fb = v.lp_z * v.loop_gain;
  if (s.saw > 0) {
    // sawari (jawari bridge): above a fraction of its own swing the string lies on the curved
    // bridge, which throws it back - a kink every cycle that regenerates the high partials.
    // The contact point scales with the envelope, so the buzz lasts as long as the note.
    const a = v.lp_z < 0 ? -v.lp_z : v.lp_z;
    v.saw_env = a > v.saw_env ? a : v.saw_env * s.saw_env_c;
    const b = s.saw_c * v.saw_env;
    let y = v.lp_z;
    if (y > b) y = b - 0.5 * (y - b);
    v.saw_dc += s.saw_dc_a * (y - v.saw_dc);
    y -= v.saw_dc;
    // the contact itself loses energy every cycle; give back what it took (mean |y| vs mean |x|)
    // so the note keeps the decay set by String Decay / Damping
    v.saw_mx += s.saw_m_a * (a - v.saw_mx);
    v.saw_my += s.saw_m_a * ((y < 0 ? -y : y) - v.saw_my);
    if (v.saw_on && v.saw_my > 1e-12) v.saw_g = Math.min(v.saw_mx / v.saw_my, SAW_GMAX);
    fb = y * v.loop_gain * v.saw_g;
  }
  delay_write(v.line, fb);
  const direct = fb * v.read_gain;
  let contact = 0;
  if (v.bachi_t < v.bachi_len) {
    // Bipolar contact/release removes the low-frequency push of the old positive pulse.
    contact = s.p.string_plectrum * v.vel * (1 + s.p.string_plectrum_hardness) * Math.sin(TWO_PI * v.bachi_t / v.bachi_len) / (0.5 * v.bachi_len);
    v.bachi_t++;
  }
  if (!(s.p.string_body_mix > 0)) return direct;
  let body = 0;
  for (let k = 0; k < 3; k++) body += reson_process(v.modes[k], 0.002 * direct + contact);
  return direct + 2 * s.p.string_body_mix * body;
}

// A shared, driven resonator bank: fixed instrument strings, not a chorus per voice.
function sympathetic_update(s) {
  const p = s.p;
  const frequencies = s.sympathetic.map((_, k) => tuning_note_to_hz(s.tuning, (p.string_sympathetic_root ?? 60) + k));
  const enabled = Math.round(p.phys_model) === MODEL_STRING && p.string_sympathetic_mix > 0;
  const key = `${enabled}:${p.string_sympathetic_decay_ms}:${frequencies.join(',')}`;
  if (key === s.sympathetic_key) return;
  s.sympathetic_key = key;
  for (let k = 0; k < 24; k++) {
    const o = s.sympathetic[k]; reson_reset(o);
    const decay = (p.string_sympathetic_decay_ms ?? 3500) * (1 - 0.012 * k);
    reson_set(o, frequencies[k], decay, 2 * (1 - t60_coef(decay, s.sr)), s.sr);
  }
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

function render_brass(v, vib) {
  const mouth = 0.3 * v.maxv * adsr_process(v.env);
  // the wave arriving at the bell: its low part reflects back down the bore, and what the
  // bell radiates is (roughly) its rate of change
  const at_bell = delay_read(v.line, v.delay_len / vib);
  // nonlinear propagation ("brassiness"): loud parts of the wave travel faster, so the wave
  // front steepens on its way out - what makes loud brass blare. A delay shortened by the
  // pressure (outside the loop, so the tuning is unaffected).
  const steep = v.steep;
  steep.buf[steep.w] = at_bell;
  steep.w = (steep.w + 1) & (STEEP_LEN - 1);
  const per = v.delay_len * 0.5;
  const d0 = Math.min(STEEP_LEN * 0.4, per * 0.5 + 2);
  const dd = clamp(d0 - BRASS_STEEP * at_bell * per, 1, 2 * d0);
  let pos = steep.w - dd;
  if (pos < 0) pos += STEEP_LEN;
  const i0 = Math.floor(pos);
  const i1 = (i0 + 1) & (STEEP_LEN - 1);
  const sv = steep.buf[i0] + (pos - i0) * (steep.buf[i1] - steep.buf[i0]);
  v.refl_z = (1 - v.refl_b) * at_bell + v.refl_b * v.refl_z;
  const bore = 0.85 * v.refl_z;
  // lips: resonator driven by the pressure difference; opening = (gain * position)^2, clipped
  const y = mouth - bore - v.lip_a1 * v.lip_y1 - v.lip_a2 * v.lip_y2;
  v.lip_y2 = v.lip_y1;
  v.lip_y1 = y;
  // the lip opening grows with the square of the lip position and saturates smoothly
  // (a hard clip at 1 held the lips wide open for a third of each period: flat tops, harsh)
  v.boost *= v.boost_c;
  const u = v.lip_g * (1 + v.boost) * y;
  const open = 1 - Math.exp(-u * u);
  v.slip = open;
  // open lips pass the mouth pressure, closed lips reflect the bore
  const x = open * mouth + (1 - open) * bore;
  const d = x - v.dc_x + v.dc_r * v.dc_y;
  v.dc_x = x;
  v.dc_y = d;
  delay_write(v.line, d);
  // radiation: first difference (normalised to keep the fundamental level), then the bell
  const rad = (sv - v.rad_x) * v.rad_k;
  v.rad_x = sv;
  v.bell_z = (1 - v.bell_b) * rad + v.bell_b * v.bell_z;
  return v.bell_z * BRASS_GAIN * v.vel;
}

function render_wind(s, v, vib, kind, noise_amt) {
  const env = adsr_process(v.env);
  const nz = noise_white();
  // a player's breath is never perfectly steady: slow (~5 Hz low-passed) pressure wobble of
  // about 1.5 %, plus the breath noise itself
  v.flut += s.flut_a * (nz - v.flut);
  let bp = env * v.maxv * (1 + 1.4 * v.flut);
  // turbulence heard as an airy hiss (noise above ~1 kHz) on top of the tone
  v.hiss_lp += s.hiss_a * (nz - v.hiss_lp);
  const hiss = (nz - v.hiss_lp) * env * noise_amt * 0.05;
  if (kind === WIND_FREE_REED) {
    // the tongue swings at its own pitch; air passes while it is clear of the slot
    // Radiation differentiates the flow and normalises by the fundamental. White pressure
    // noise would therefore grow as sr / hz, drowning low reeds. Bellows fluctuate slowly;
    // the separately added hiss below still provides the audible broadband breath component.
    bp += bp * noise_amt * 0.25 * v.flut;
    v.org_ph += v.org_inc * vib;
    if (v.org_ph >= 1) v.org_ph -= 1;
    const x = bp * Math.sin(TWO_PI * v.org_ph);
    v.slip = x;
    let u = free_reed_flow(s, x);
    if (s.fr_n > 1) {
      v.fr_ph2 += v.fr_inc2 * vib;
      if (v.fr_ph2 >= 1) v.fr_ph2 -= 1;
      v.fr_ph3 += v.fr_inc3 * vib;
      if (v.fr_ph3 >= 1) v.fr_ph3 -= 1;
      u = 0.6 * (u + free_reed_flow(s, bp * Math.sin(TWO_PI * v.fr_ph2)) + free_reed_flow(s, bp * Math.sin(TWO_PI * v.fr_ph3)));
    }
    const rad = (u - v.rad_x) * v.rad_k;
    v.rad_x = u;
    svf_process(v.body1, rad);
    return ((0.7 * rad + 0.5 * v.body1.bp) * FREE_REED_GAIN + hiss) * v.vel;
  }
  if (kind >= WIND_SAX) {
    bp += bp * noise_amt * 0.25 * nz;
    // bell side: lossy, low-passed, inverting reflection at the open end
    const bell = delay_read(v.line, v.delay_len / vib);
    v.lp_z = (1 - v.damp_b) * bell + v.damp_b * v.lp_z;
    const t = -0.95 * v.lp_z;
    // pressure at the reed: the fresh reflection minus the one that went on past the reed
    const mouth = t - delay_read(v.line2, v.delay_len2 / vib);
    const pd = bp - mouth;
    // (pd has the opposite sign of the clarinet's, so the same slope enters negated)
    let reed = 0.7 - v.slope * pd;
    if (reed > 1) reed = 1;
    if (reed < -1) reed = -1;
    v.slip = reed;
    delay_write(v.line2, t);
    delay_write(v.line, bp - pd * reed - t);
    let rad = (t - v.rad_x) * v.rad_k;
    v.rad_x = t;
    if (kind === WIND_DOUBLE_REED) {
      // narrow cone: the radiation adds a second difference with a fixed corner (~1 kHz),
      // lifting the partials above it whatever the note (the nasal oboe / bassoon formant)
      const r2 = (rad - v.rad_x2) * s.reed_k;
      v.rad_x2 = rad;
      rad = 0.4 * rad + 0.6 * r2;
    }
    return (rad * CONE_GAIN[kind] + hiss) * v.vel;
  }
  if (kind === WIND_CLARINET) {
    bp += bp * noise_amt * 0.25 * nz;
    const bore = delay_read(v.line, v.delay_len / vib);
    // lossy, low-passed, inverting reflection at the bell
    v.lp_z = (1 - v.damp_b) * bore + v.damp_b * v.lp_z;
    const pd = -0.95 * v.lp_z - bp;
    // reed: opening = clipped straight line of the pressure difference
    let reed = 0.7 + v.slope * pd;
    if (reed > 1) reed = 1;
    if (reed < -1) reed = -1;
    v.slip = reed;
    delay_write(v.line, bp + pd * reed);
    return (bore * 1.1 + hiss) * v.vel;
  }
  const bore = delay_read(v.line, v.delay_len / vib);
  v.lp_z = (1 - v.damp_b) * bore + v.damp_b * v.lp_z;
  // open end: low-passed reflection with the DC removed
  const t = onepole_hp(v.dc, v.lp_z);
  // the acoustic flow (plus turbulence) deflects the jet; it arrives at the edge later
  const jet = delay_read(v.line2, v.delay_len2 / vib);
  delay_write(v.line2, t + (0.01 + 0.08 * noise_amt) * env * nz);
  // the edge splits the jet: saturating curve around the jet offset (DC removed)
  const j = soft_clip(FLUTE_JET_GAIN * jet + v.jet_bias) - soft_clip(v.jet_bias);
  v.slip = j;
  delay_write(v.line, bp * j + 0.5 * t);
  return (bore * 0.3 + hiss) * v.vel;
}

/** air through the slot for a tongue at x (offset by the embouchure bias) */
function free_reed_flow(s, x) {
  const d = Math.abs(x - s.fr_bias) - FREE_REED_OVERLAP;
  return d > 0 ? d : 0;
}

function render_organ(s, v, vib) {
  v.org_ph += v.org_inc * vib;
  if (v.org_ph >= 1) v.org_ph -= 1;
  const th = TWO_PI * v.org_ph;
  const sn = s.org_sn;
  const c2 = 2 * Math.cos(th);
  sn[0] = 0;
  sn[1] = Math.sin(th);
  for (let k = 2; k <= 16; k++) sn[k] = c2 * sn[k - 1] - sn[k - 2];
  const half = v.org_inc * s.sr;
  const top = 0.45 * s.sr;
  let y = 0;
  for (let j = 0; j < 9; j++) {
    const w = s.org_w[j];
    if (w === 0) continue;
    let k = ORGAN_K[j];
    if (k * half > ORGAN_FOLD_HZ && k > 3) k = k / 2;
    if (k * half < top) y += w * sn[k];
  }
  if (s.org_perc_k > 0 && v.org_perc > 0.00001) {
    if (s.org_perc_k * half < top) y += s.org_perc_lvl * v.org_perc * sn[s.org_perc_k];
    v.org_perc *= s.org_perc_coef;
  }
  if (v.org_clk > 0) {
    const e = v.org_clk / s.org_click_len;
    y += s.org_click * e * e * noise_white();
    v.org_clk--;
  }
  return y * adsr_process(v.env) * v.vel;
}

function render_mesh(s, v) {
  const u = v.mesh_u;
  const up = v.mesh_up;
  const un = v.mesh_un;
  const c2 = v.mesh_c2;
  // u' = 2u - (1-s)up + c2 Lap(u) + d (Lap(u) - Lap(up) + mu (u - up)), all / (1+s):
  //  - velocity damping s: every mode decays at the set rate, without detuning the low ones
  //    (scaling the whole update would)
  //  - velocity-Laplacian damping d: a mode with -Laplacian eigenvalue lambda loses an extra
  //    d*(lambda-mu)/2 per sample, so the fundamental keeps the set decay and the highest grid
  //    modes (lambda ~ 8) die within ~10 ms at 1
  // With Lap(u) = (sum of the 4 neighbours) - 4u this collapses to 4 coefficients:
  const inv = 1 / (1 + v.mesh_sig);
  const d = (s.p.mesh_high_damping * 172.5) / s.sr;
  const mu = s.mesh_mu;
  const ku = (2 - 4 * c2 - 4 * d + d * mu) * inv;
  const kp = (4 * d - d * mu - (1 - v.mesh_sig)) * inv;
  const kn = (c2 + d) * inv;
  const kq = d * inv;
  // each row of the shape is one contiguous run of cells [start, end)
  const spans = s.mesh_spans;
  for (let r = 0; r < s.mesh_rows; r++) {
    const end = spans[2 * r + 1];
    for (let c = spans[2 * r]; c < end; c++) {
      un[c] = ku * u[c] + kp * up[c] + kn * (u[c - 1] + u[c + 1] + u[c - MESH_W] + u[c + MESH_W]) -
        kq * (up[c - 1] + up[c + 1] + up[c - MESH_W] + up[c + MESH_W]);
    }
  }
  // rotate the three time levels
  v.mesh_up = u;
  v.mesh_u = un;
  v.mesh_un = up;
  // displacement at the pickup (x w so the level does not depend on pitch); the
  // fundamental dominates as on a real drum head
  return un[s.mesh_pick] * v.mesh_omega * K_MESH;
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
  // hammer + soundboard excitation, fed into both strings (the second one less)
  let exc = 0;
  if (v.exc_t < v.exc_len) exc = v.exc[v.exc_t++];
  let x = ap1_process(v.tuneA, delay_read(v.line, nA), tA);
  for (let k = 0; k < v.n_ap; k++) x = ap1_process(v.apA[k], x, a);
  v.lp_z = (1 - v.damp_b) * x + v.damp_b * v.lp_z;
  const fa = v.lp_z * v.loop_gain + 0.5 * exc;
  delay_write(v.line, fa);
  let y = ap1_process(v.tuneB, delay_read(v.line2, nB), tB);
  for (let k = 0; k < v.n_ap; k++) y = ap1_process(v.apB[k], y, a);
  v.lp_z2 = (1 - v.damp_b) * y + v.damp_b * v.lp_z2;
  const fb = v.lp_z2 * v.loop_gain2 + 0.32 * exc;
  delay_write(v.line2, fb);
  return (fa + fb) * v.read_gain;
}

export function phys_render(s) {
  const p = s.p;
  const model = Math.floor(p.phys_model + 0.5);
  // vibrato for the delay-line models (ratio = 1 exactly when off); aftertouch can deepen it per note
  let vib = 1;
  let vsin = 0;
  const pvib = s.press_vib;
  if (p.phys_vibrato_cents > 0 || pvib > 0) {
    vsin = Math.sin(TWO_PI * s.vib_phase);
    vib = Math.pow(2, (p.phys_vibrato_cents * vsin) / 1200);
    s.vib_phase += s.vib_inc;
    if (s.vib_phase >= 1) s.vib_phase -= 1;
  }
  const wkind = wind_kind(p);
  let l = 0;
  let r = 0;
  let bridge = 0;
  for (let i = 0; i < PHYS_MAX_VOICES; i++) {
    const v = s.voices[i];
    if (!v.active) continue;
    const vv = pvib > 0 && v.press > 0 ? Math.pow(2, ((p.phys_vibrato_cents + pvib * v.press) * vsin) / 1200) : vib;
    let y;
    if (model === MODEL_STRING) y = render_string(s, v, vv);
    else if (model === MODEL_MODAL) y = render_modal(v);
    else if (model === MODEL_BOWED) y = render_bowed(v, vv);
    else if (model === MODEL_WIND) y = render_wind(s, v, vv, wkind, p.breath_noise);
    else if (model === MODEL_BRASS) y = render_brass(v, vv);
    else if (model === MODEL_MESH) y = render_mesh(s, v);
    else if (model === MODEL_ORGAN) y = render_organ(s, v, vv);
    else y = render_stiff(v, vv);
    l += y * v.gl;
    r += y * v.gr;
    bridge += y;
    // voice ends once it has been quiet for a while
    const a = y < 0 ? -y : y;
    v.level = a > v.level ? a : v.level * s.level_coef;
    v.frames++;
    if (v.frames > 2000 && v.level < 0.00005) {
      v.active = 0;
      v.note = -1;
    }
  }
  if (model === MODEL_STIFF && p.piano_soundboard > 0) {
    // what you hear of a piano is mostly its soundboard; the strings themselves barely radiate
    soundboard_process(s, bridge);
    const dry = 1 - 0.7 * p.piano_soundboard;
    l = l * dry + p.piano_soundboard * s.sb_l;
    r = r * dry + p.piano_soundboard * s.sb_r;
  }
  if (model === MODEL_STRING && p.string_sympathetic_mix > 0) {
    for (let k = 0; k < 24; k++) {
      // The previous 0.3 gain buried the slow-building resonances beneath the direct string.
      const y = reson_process(s.sympathetic[k], bridge) * p.string_sympathetic_mix * 2.4;
      const pan = k % 2 ? 0.85 : 0.15;
      l += y * pan;
      r += y * (1 - pan);
    }
  }
  if (s.amp_type > 0) {
    l = amp_process(s, s.amp_l, l);
    r = amp_process(s, s.amp_r, r);
  }
  if (s.rot_mode > 0) rotary_process(s, l, r);
  if (s.rot_mode > 0 && s.rot_mix > 0) {
    l += s.rot_mix * (s.rot_l - l);
    r += s.rot_mix * (s.rot_r - r);
  }
  if (p.phys_room_mix > 0) {
    room_process(s, l, r);
    l += p.phys_room_mix * s.room_l;
    r += p.phys_room_mix * s.room_r;
  }
  let g = s.gain * 0.5;
  if (s.sc.duck_db > 0) g *= sidechain_duck_gain(s.sc, sidechain_process(s.sc, s.sc_in_l, s.sc_in_r));
  s.out_l = soft_clip(onepole_hp(s.dc, l) * g);
  s.out_r = soft_clip(onepole_hp(s.dc_r, r) * g);
}

// ---------------------------------------------------------------------------
// Guitar amp: pre high-pass -> asymmetric soft clipping (1 or 2 stages, low-pass in between)
// -> cabinet (resonant low-pass + 80 Hz high-pass, which also removes the DC of the bias).

function amp_create() {
  const a = { pre: {}, inter: {}, cab: {}, cab_hp: {} };
  onepole_init(a.pre);
  onepole_init(a.inter);
  svf_init(a.cab);
  svf_init(a.cab_hp);
  return a;
}

function amp_update(s, p) {
  s.amp_type = clamp(Math.round(p.amp_type), 0, AMP_TYPES.length - 1);
  const t = AMP_TYPES[s.amp_type];
  if (s.amp_type === 0) return;
  s.amp_drive = t[1] * Math.pow(t[2] / t[1], p.amp_gain);
  s.amp_bias = t[3];
  s.amp_bias_out = soft_clip(t[3]);
  s.amp_stages = t[4];
  s.amp_out = db_to_gain(p.amp_level_db) * (p.amp_auto_level >= 0.5 ? amp_makeup(s) : 1);
  const cab = t[5] * Math.pow(t[6] / t[5], p.amp_tone);
  for (const a of [s.amp_l, s.amp_r]) {
    onepole_set(a.pre, t[0], s.sr);
    onepole_set(a.inter, 5000, s.sr);
    svf_set(a.cab, cab, 1.1, s.sr);
    svf_set(a.cab_hp, 80, 1.4, s.sr);
  }
}

/**
 * Amp Auto Level: the gain that brings a reference sine (AMP_REF_LEVEL peak, a typical instrument
 * level) back to its own RMS after the clipping stages, so more Amp Gain adds distortion but not
 * loudness. The filters are left out (they do not change with the gain).
 */
const AMP_REF_LEVEL = 0.3;
const AMP_REF_POINTS = 64;
function amp_makeup(s) {
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < AMP_REF_POINTS; i++) {
    const x = AMP_REF_LEVEL * Math.sin((TWO_PI * (i + 0.5)) / AMP_REF_POINTS);
    let y = soft_clip(x * s.amp_drive + s.amp_bias) - s.amp_bias_out;
    if (s.amp_stages > 1) y = soft_clip(y * 4);
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / AMP_REF_POINTS;
  const rms = Math.sqrt(Math.max(sum2 / AMP_REF_POINTS - mean * mean, 1e-12));
  return AMP_REF_LEVEL / Math.SQRT2 / rms;
}

function amp_process(s, a, x) {
  let y = soft_clip(onepole_hp(a.pre, x) * s.amp_drive + s.amp_bias) - s.amp_bias_out;
  if (s.amp_stages > 1) y = soft_clip(onepole_lp(a.inter, y) * 4);
  svf_process(a.cab, y);
  svf_process(a.cab_hp, a.cab.lp);
  return a.cab_hp.hp * s.amp_out;
}

// ---------------------------------------------------------------------------
// Rotary speaker: an 800 Hz crossover; the highs go to a spinning horn (a delay swept by the
// horn's distance to each microphone = Doppler, plus its loudness as it points towards / away),
// the lows to a spinning drum (loudness only). The two mics are 90 degrees apart (stereo). The
// rotors speed up and slow down gradually, the light horn much faster than the heavy drum.

function rotary_process(s, l, r) {
  const fast = s.rot_mode === 2 || s.modwheel >= 0.5;
  s.horn_hz += s.horn_c * ((fast ? 6.8 : 0.8) - s.horn_hz);
  s.drum_hz += s.drum_c * ((fast ? 5.9 : 0.65) - s.drum_hz);
  s.horn_ph += s.horn_hz / s.sr;
  if (s.horn_ph >= 1) s.horn_ph -= 1;
  s.drum_ph += s.drum_hz / s.sr;
  if (s.drum_ph >= 1) s.drum_ph -= 1;
  const x = (l + r) * 0.5;
  const lo = onepole_lp(s.rot_xo, x);
  delay_write(s.rot_line, x - lo);
  const hc = Math.cos(TWO_PI * s.horn_ph);
  const hs = Math.sin(TWO_PI * s.horn_ph);
  const dc = Math.cos(TWO_PI * s.drum_ph);
  const ds = Math.sin(TWO_PI * s.drum_ph);
  const hl = delay_read(s.rot_line, s.rot_d0 + s.rot_dd * (1 - hc)) * (0.65 + 0.35 * hc);
  const hr = delay_read(s.rot_line, s.rot_d0 + s.rot_dd * (1 - hs)) * (0.65 + 0.35 * hs);
  s.rot_l = 1.2 * (hl + lo * (0.8 + 0.2 * dc));
  s.rot_r = 1.2 * (hr + lo * (0.8 + 0.2 * ds));
}

/** Mod wheel 0..1 (CC1): above half switches the rotary speaker from Slow to Fast. */
export function phys_mod_wheel(s, value) {
  s.modwheel = clamp(value, 0, 1);
}

// ---------------------------------------------------------------------------
// Room: the shared 4-line feedback delay network (lib.js fdn4_*) at its natural size.
// Acoustic instruments sound dry and synthetic without at least a small room.

function room_init(s) {
  s.room = {};
  fdn4_init(s.room, 8192);
  s.room_l = 0;
  s.room_r = 0;
}

function room_update(s, decay_ms) {
  fdn4_set(s.room, 1, decay_ms, 0.55, s.sr);
}

function room_process(s, l, r) {
  fdn4_process(s.room, (l + r) * 0.5);
  s.room_l = 2.5 * s.room.l;
  s.room_r = 2.5 * s.room.r;
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
    w * (v.delay_len + ap1_phase_delay(v.tune_a, w) + lp1_phase_delay(v.damp_b, w) + v.n_ap * ap1_phase_delay(v.ap_a, w));
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
  const names = ['string', 'modal', 'bowed', 'wind', 'mesh', 'stiff', 'brass', 'organ'];
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
    return { ...base, wave: line_wave(v.line, v.delay_len, points), flute: wind_kind(s.p) === WIND_FLUTE, valve: v.slip, breath: v.env.value * v.maxv };
  }
  if (model === MODEL_BRASS) {
    return { ...base, wave: line_wave(v.line, v.delay_len, points), valve: v.slip, breath: v.env.value * v.maxv };
  }
  if (model === MODEL_ORGAN) {
    return { ...base, drawbars: ORGAN_BARS.map((id) => clamp(Math.round(s.p[id] ?? 0), 0, 8)), perc: v.org_perc, env: v.env.value };
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
