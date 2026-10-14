// AmiSynth drum machine core: 13 fully synthesized parts, no samples.
// Same structure as synth.js (init / update / trigger / render-one-sample).
//
//   36 Kick        sine + exponential pitch drop, click + saturation
//   38 Snare       two detuned sines (body) + band-passed noise
//   39 Clap        several short noise bursts + tail, band-passed
//   42 Closed hat  6 detuned squares + noise, band/high-passed, short decay
//   46 Open hat    same circuit, long decay, choked by the closed hat
//   37 Rimshot     two sines (high + ~0.27x) + click, driven
//   45/47/50 Toms  sine with a short downward bend + stick noise
//   49 Crash       hat circuit, noisier, long decay, lower band-pass
//   51 Ride        hat circuit, more metallic, long decay
//   56 Cowbell     two squares (808 ratio 1:1.48), band-passed, two-stage decay
//   70 Shaker      band-passed noise with an attack swell
//   54 Tambourine  hat circuit, high band-pass
//   63 Conga       sine + (1,1) membrane mode with a slap bend + slap noise (also 60-64: bongos, congas)
//   65 Timbale     same hand-drum circuit, brighter shell mode and stick (66 low timbale)
//   67 Agogo       two band-passed squares (68 low agogo)
//   75 Claves      sine + wood bar mode (2.76x) + click (76/77 wood blocks)
//   81 Triangle    five near-harmonic sines (80 mute triangle, chokes the open one)
// GM_DRUM_VARIANTS (params.js) lists the other GM notes played as variants of these parts.

import {
  clamp, db_to_gain, decay_env_init, decay_env_process, decay_env_trigger, noise_seed, noise_white, random_unit,
  onepole_hp, onepole_init, onepole_set, pan_gains, sine_process, soft_clip,
  square_naive_process, svf_init, svf_process, svf_reset, svf_set, t60_coef, tau_coef,
} from './lib.js';
import { GM_DRUM_VARIANTS } from './params.js';

export const NOTE_KICK = 36;
export const NOTE_SNARE = 38;
export const NOTE_CLAP = 39;
export const NOTE_CLOSED_HAT = 42;
export const NOTE_OPEN_HAT = 46;
export const NOTE_RIMSHOT = 37;
export const NOTE_LOW_TOM = 45;
export const NOTE_MID_TOM = 47;
export const NOTE_HIGH_TOM = 50;
export const NOTE_CRASH = 49;
export const NOTE_RIDE = 51;
export const NOTE_COWBELL = 56;
export const NOTE_SHAKER = 70;

// Classic 808-style cymbal oscillator ratios (205.3, 304.4, 369.6, 522.7, 540, 800 Hz / 205.3)
const HAT_RATIOS = [1, 1.4827, 1.8003, 2.546, 2.6303, 3.8967];
/** triangle partials (ratio, level) */
const TRI_RATIOS = [1, 2.05, 3.13, 4.27, 5.4];
const TRI_LEVELS = [1, 0.7, 0.55, 0.45, 0.35];
/** hand drums: second (membrane / shell) mode ratio, its decay share, slap noise high-pass */
const CONGA_MODE = { ratio: 1.59, decay: 0.35, hp_hz: 1200 };
const TIMBALE_MODE = { ratio: 2.32, decay: 0.8, hp_hz: 3000 };

function tom_create() {
  const t = { osc: { phase: 0, inc: 0 }, env: {}, noise_env: {}, pitch_env: 0, pitch_coef: 0, hp: {}, vel: 0, gain: 1, mul: 1, gl: 1, gr: 1 };
  decay_env_init(t.env);
  decay_env_init(t.noise_env);
  onepole_init(t.hp);
  return t;
}

function hat_create() {
  const h = { env: {}, hp: {}, bp: {}, oscs: [], vel: 0, choke: 0, choke_coef: 0, mul: 1, gl: 1, gr: 1 };
  decay_env_init(h.env);
  svf_init(h.hp);
  svf_init(h.bp);
  for (let i = 0; i < 6; i++) h.oscs.push({ phase: random_unit(), inc: 0 });
  return h;
}

/** a GM variant voice: the part key it follows and its pitch / decay / level multipliers */
function variant(v, part, note) {
  const g = GM_DRUM_VARIANTS.find((x) => x.note === note);
  v.part = part;
  v.mul = g ? g.pitch : 1;
  v.dmul = g ? g.decay : 1;
  v.lmul = g ? g.level : 1;
  return v;
}

function hand_create(part, note) {
  const v = { osc: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, env: {}, env2: {}, noise_env: {}, pitch_env: 0, hp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(v.env);
  decay_env_init(v.env2);
  decay_env_init(v.noise_env);
  onepole_init(v.hp);
  return variant(v, part, note);
}

function bell_create(part, note) {
  const v = { osc1: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, fast: {}, slow: {}, bp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(v.fast);
  decay_env_init(v.slow);
  svf_init(v.bp);
  return variant(v, part, note);
}

function knock_create(part, note) {
  const v = { osc: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, env: {}, env2: {}, click: {}, hp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(v.env);
  decay_env_init(v.env2);
  decay_env_init(v.click);
  onepole_init(v.hp);
  return variant(v, part, note);
}

export function drums_init(d, sr) {
  noise_seed(12345);
  d.sr = sr;
  d.p = {};
  d.out_l = 0;
  d.out_r = 0;
  d.bus_l = [0, 0, 0, 0];
  d.bus_r = [0, 0, 0, 0];
  d.bus_main = [1, 1, 1, 1];

  d.kick = { osc: { phase: 0, inc: 0 }, env: {}, pitch_env: 0, pitch_coef: 0, click: {}, click_hp: {}, vel: 0, gl: 1, gr: 1 };
  decay_env_init(d.kick.env);
  decay_env_init(d.kick.click);
  onepole_init(d.kick.click_hp);

  d.snare = { osc1: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, body_env: {}, noise_env: {}, bp: {}, hp: {}, pitch_env: 0, pitch_coef: 0, vel: 0, gl: 1, gr: 1 };
  decay_env_init(d.snare.body_env);
  decay_env_init(d.snare.noise_env);
  svf_init(d.snare.bp);
  onepole_init(d.snare.hp);

  d.clap = { t: -1, burst_coef: 0, tail_coef: 0, tail: 0, bp: {}, vel: 0, gl: 1, gr: 1 };
  svf_init(d.clap.bp);

  d.closed_hat = hat_create();
  d.open_hat = hat_create();
  d.crash = hat_create();
  d.ride = hat_create();

  d.low_tom = tom_create();
  d.mid_tom = tom_create();
  d.high_tom = tom_create();

  d.rimshot = { osc1: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, env: {}, click: {}, hp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(d.rimshot.env);
  decay_env_init(d.rimshot.click);
  onepole_init(d.rimshot.hp);

  d.cowbell = { osc1: { phase: 0, inc: 0 }, osc2: { phase: 0, inc: 0 }, fast: {}, slow: {}, bp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(d.cowbell.fast);
  decay_env_init(d.cowbell.slow);
  svf_init(d.cowbell.bp);

  d.shaker = { env: {}, attack: 0, attack_inc: 0, bp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(d.shaker.env);
  svf_init(d.shaker.bp);

  // GM percussion: parts and their variant voices (render order = JSFX order)
  d.tambourine = hat_create();
  d.floor_tom_low = variant(tom_create(), 'low_tom', 41);
  d.floor_tom_high = variant(tom_create(), 'low_tom', 43);
  d.hi_mid_tom = variant(tom_create(), 'mid_tom', 48);
  d.crash2 = variant(hat_create(), 'crash', 57);
  d.ride2 = variant(hat_create(), 'ride', 59);
  d.hands = [hand_create('conga', 60), hand_create('conga', 61), hand_create('conga', 62), hand_create('conga', 63),
    hand_create('conga', 64), hand_create('timbale', 65), hand_create('timbale', 66)];
  d.bells = [bell_create('agogo', 67), bell_create('agogo', 68)];
  d.knocks = [knock_create('claves', 75), knock_create('claves', 76), knock_create('claves', 77)];
  d.triangle = { oscs: TRI_RATIOS.map(() => ({ phase: 0, inc: 0 })), env: {}, env2: {}, click: {}, hp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(d.triangle.env);
  decay_env_init(d.triangle.env2);
  decay_env_init(d.triangle.click);
  onepole_init(d.triangle.hp);
}

/** JSFX @slider equivalent. */
export function drums_update(d, p) {
  d.p = p;
  const sr = d.sr;
  d.master_gain = db_to_gain(p.drum_master_volume_db);
  d.bus_main[0] = p.kick_bus_in_main >= 0.5 ? 1 : 0;
  d.bus_main[1] = p.snare_bus_in_main >= 0.5 ? 1 : 0;
  d.bus_main[2] = p.hats_bus_in_main >= 0.5 ? 1 : 0;
  d.bus_main[3] = p.perc_bus_in_main >= 0.5 ? 1 : 0;

  // Kick
  pan_gains(d.kick, p.kick_pan);
  d.kick.gain = db_to_gain(p.kick_level_db);
  d.kick.pitch_coef = tau_coef(p.kick_sweep_ms, sr);
  onepole_set(d.kick.click_hp, 2000 + 8000 * p.kick_tone, sr);

  // Snare
  pan_gains(d.snare, p.snare_pan);
  d.snare.gain = db_to_gain(p.snare_level_db);
  // tone 0..1 -> noise band centre 1.5 kHz .. 9 kHz
  svf_set(d.snare.bp, 1500 * Math.pow(6, p.snare_tone), 1.2, sr);
  onepole_set(d.snare.hp, 400, sr);

  // Clap
  pan_gains(d.clap, p.clap_pan);
  d.clap.gain = db_to_gain(p.clap_level_db);
  // tone 0..1 -> k 2.0 (wide) .. 0.25 (narrow)
  svf_set(d.clap.bp, p.clap_pitch_hz, 2 - 1.75 * p.clap_tone, sr);
  d.clap.spread = Math.max(1, Math.round(p.clap_spread_ms * 0.001 * sr));
  d.clap.burst_coef = t60_coef(p.clap_spread_ms * 0.9, sr);
  d.clap.tail_coef = t60_coef(p.clap_decay_ms, sr);

  hat_update(d.closed_hat, p.closed_hat_pitch_hz, p.closed_hat_tone, p.closed_hat_level_db, p.closed_hat_pan, 10000, 3000, sr);
  hat_update(d.open_hat, p.open_hat_pitch_hz, p.open_hat_tone, p.open_hat_level_db, p.open_hat_pan, 10000, 3000, sr);
  hat_update(d.crash, p.crash_pitch_hz, p.crash_tone, p.crash_level_db, p.crash_pan, 6500, 1500, sr);
  hat_update(d.ride, p.ride_pitch_hz, p.ride_tone, p.ride_level_db, p.ride_pan, 8000, 2000, sr);

  tom_update(d.low_tom, p.low_tom_level_db, p.low_tom_pan, sr);
  tom_update(d.mid_tom, p.mid_tom_level_db, p.mid_tom_pan, sr);
  tom_update(d.high_tom, p.high_tom_level_db, p.high_tom_pan, sr);

  // Rimshot
  pan_gains(d.rimshot, p.rimshot_pan);
  d.rimshot.gain = db_to_gain(p.rimshot_level_db);
  d.rimshot.osc1.inc = clamp(p.rimshot_pitch_hz / sr, 0, 0.49);
  d.rimshot.osc2.inc = clamp((p.rimshot_pitch_hz * 0.27) / sr, 0, 0.49);
  onepole_set(d.rimshot.hp, 3000, sr);

  // Cowbell: 540 Hz : 800 Hz on the 808
  pan_gains(d.cowbell, p.cowbell_pan);
  d.cowbell.gain = db_to_gain(p.cowbell_level_db);
  d.cowbell.osc1.inc = clamp(p.cowbell_pitch_hz / sr, 0, 0.49);
  d.cowbell.osc2.inc = clamp((p.cowbell_pitch_hz * 1.4815) / sr, 0, 0.49);
  svf_set(d.cowbell.bp, p.cowbell_pitch_hz * 1.6 * Math.pow(3, p.cowbell_tone), 1.0, sr);

  // Shaker
  pan_gains(d.shaker, p.shaker_pan);
  d.shaker.gain = db_to_gain(p.shaker_level_db);
  svf_set(d.shaker.bp, p.shaker_pitch_hz, 1.0, sr);
  d.shaker.attack_inc = 1 / ((1 + 40 * p.shaker_tone) * 0.001 * sr);

  // GM percussion
  hat_update(d.tambourine, p.tambourine_pitch_hz, p.tambourine_tone, p.tambourine_level_db, p.tambourine_pan, 9000, 4000, sr);
  tom_update(d.floor_tom_low, p.low_tom_level_db, p.low_tom_pan, sr);
  tom_update(d.floor_tom_high, p.low_tom_level_db, p.low_tom_pan, sr);
  tom_update(d.hi_mid_tom, p.mid_tom_level_db, p.mid_tom_pan, sr);
  hat_update(d.crash2, p.crash_pitch_hz, p.crash_tone, p.crash_level_db, p.crash_pan, 6500, 1500, sr);
  hat_update(d.ride2, p.ride_pitch_hz, p.ride_tone, p.ride_level_db, p.ride_pan, 8000, 2000, sr);
  d.hand_pitch_coef = tau_coef(25, sr);
  for (const v of d.hands) {
    pan_gains(v, p[`${v.part}_pan`]);
    v.gain = db_to_gain(p[`${v.part}_level_db`]) * v.lmul;
    v.mode = v.part === 'conga' ? CONGA_MODE : TIMBALE_MODE;
    v.hz = p[`${v.part}_pitch_hz`] * v.mul;
    v.tone = p[`${v.part}_tone`];
    v.decay_ms = p[`${v.part}_decay_ms`] * v.dmul;
    onepole_set(v.hp, v.mode.hp_hz, sr);
  }
  for (const v of d.bells) {
    pan_gains(v, p.agogo_pan);
    v.gain = db_to_gain(p.agogo_level_db) * v.lmul;
    const hz = p.agogo_pitch_hz * v.mul;
    v.osc1.inc = clamp(hz / sr, 0, 0.49);
    v.osc2.inc = clamp((hz * 1.6) / sr, 0, 0.49);
    svf_set(v.bp, hz * 1.3 * Math.pow(3, p.agogo_tone), 0.8, sr);
  }
  for (const v of d.knocks) {
    pan_gains(v, p.claves_pan);
    v.gain = db_to_gain(p.claves_level_db) * v.lmul;
    const hz = p.claves_pitch_hz * v.mul;
    v.osc.inc = clamp(hz / sr, 0, 0.49);
    v.osc2.inc = clamp((hz * 2.76) / sr, 0, 0.49);
    onepole_set(v.hp, 3000, sr);
  }
  const tri = d.triangle;
  pan_gains(tri, p.triangle_pan);
  tri.gain = db_to_gain(p.triangle_level_db);
  for (let i = 0; i < TRI_RATIOS.length; i++) tri.oscs[i].inc = clamp((p.triangle_pitch_hz * TRI_RATIOS[i]) / sr, 0, 0.49);
  onepole_set(tri.hp, 4000, sr);
}

/** bp_hz: band-pass centre; hp_base_hz: high-pass at tone 0 (x4 at tone 1). */
function hat_update(h, pitch_hz, tone, level_db, pan, bp_hz, hp_base_hz, sr) {
  pan_gains(h, pan);
  h.gain = db_to_gain(level_db);
  h.pitch_hz = pitch_hz;
  hat_tune(h, sr);
  svf_set(h.hp, hp_base_hz * Math.pow(4, tone), 1.2, sr);
  svf_set(h.bp, bp_hz, 1.0, sr);
}

/** square cluster at the hat's pitch times its variant multiplier */
function hat_tune(h, sr) {
  for (let i = 0; i < 6; i++) h.oscs[i].inc = clamp((h.pitch_hz * h.mul * HAT_RATIOS[i]) / sr, 0, 0.49);
}

function tom_update(t, level_db, pan, sr) {
  pan_gains(t, pan);
  t.gain = db_to_gain(level_db);
  t.pitch_coef = tau_coef(40, sr);
  onepole_set(t.hp, 1500, sr);
}

function tom_trigger(t, vgain, decay_ms, sr) {
  t.osc.phase = 0;
  t.pitch_env = 1;
  t.vel = vgain;
  decay_env_trigger(t.env, 1, decay_ms, sr);
  decay_env_trigger(t.noise_env, 1, 25, sr);
}

function tom_render(t, pitch_hz, tone, sr) {
  if (t.env.value === 0) return 0;
  // tone bends the attack up to +1 octave and adds stick noise
  t.osc.inc = (pitch_hz * t.mul * Math.pow(2, tone * t.pitch_env)) / sr;
  t.pitch_env *= t.pitch_coef;
  const body = sine_process(t.osc) * decay_env_process(t.env);
  const stick = onepole_hp(t.hp, noise_white()) * decay_env_process(t.noise_env) * tone * 0.4;
  return (body + stick) * t.vel * t.gain;
}

/** velocity 1..127 */
export function drums_note_on(d, note, velocity) {
  const p = d.p;
  const sr = d.sr;
  const vel = clamp(velocity / 127, 0, 1);
  let vgain = 0.2 + 0.8 * vel * vel;
  let dmul = 1;
  // variants that retrigger the part itself
  if (note === 35) note = NOTE_KICK;
  else if (note === 40) note = NOTE_SNARE;
  else if (note === 69) note = NOTE_SHAKER;
  else if (note === 44) {
    note = NOTE_CLOSED_HAT;
    vgain *= 0.6;
    dmul = 0.8;
  }

  if (note === NOTE_KICK) {
    const k = d.kick;
    k.osc.phase = 0;
    k.pitch_env = 1;
    k.vel = vgain;
    decay_env_trigger(k.env, 1, p.kick_decay_ms, sr);
    decay_env_trigger(k.click, 1, 4, sr);
  } else if (note === NOTE_SNARE) {
    const s = d.snare;
    s.osc1.phase = 0;
    s.osc2.phase = 0;
    s.pitch_env = 1;
    s.pitch_coef = tau_coef(15, sr);
    s.vel = vgain;
    decay_env_trigger(s.body_env, 1, Math.min(p.snare_decay_ms, 180), sr);
    decay_env_trigger(s.noise_env, 1, p.snare_decay_ms, sr);
  } else if (note === NOTE_CLAP) {
    const c = d.clap;
    c.t = 0;
    c.tail = 0;
    c.vel = vgain;
    svf_reset(c.bp);
  } else if (note === NOTE_CLOSED_HAT) {
    // Choke: the closed hat fades the open hat out within ~5 ms.
    d.open_hat.choke = 1;
    d.open_hat.choke_coef = t60_coef(8, sr);
    hat_trigger(d.closed_hat, vgain, p.closed_hat_decay_ms * dmul, sr);
  } else if (note === NOTE_OPEN_HAT) {
    hat_trigger(d.open_hat, vgain, p.open_hat_decay_ms, sr);
  } else if (note === NOTE_CRASH) {
    hat_trigger(d.crash, vgain, p.crash_decay_ms, sr);
  } else if (note === NOTE_RIDE) {
    hat_trigger(d.ride, vgain, p.ride_decay_ms, sr);
  } else if (note === NOTE_LOW_TOM) {
    tom_trigger(d.low_tom, vgain, p.low_tom_decay_ms, sr);
  } else if (note === NOTE_MID_TOM) {
    tom_trigger(d.mid_tom, vgain, p.mid_tom_decay_ms, sr);
  } else if (note === NOTE_HIGH_TOM) {
    tom_trigger(d.high_tom, vgain, p.high_tom_decay_ms, sr);
  } else if (note === NOTE_RIMSHOT) {
    const r = d.rimshot;
    r.osc1.phase = 0;
    r.osc2.phase = 0;
    r.vel = vgain;
    decay_env_trigger(r.env, 1, p.rimshot_decay_ms, sr);
    decay_env_trigger(r.click, 1, 3, sr);
  } else if (note === NOTE_COWBELL) {
    const c = d.cowbell;
    c.vel = vgain;
    decay_env_trigger(c.fast, 1, 40, sr);
    decay_env_trigger(c.slow, 1, p.cowbell_decay_ms, sr);
  } else if (note === NOTE_SHAKER) {
    const sh = d.shaker;
    sh.vel = vgain;
    sh.attack = 0;
    decay_env_trigger(sh.env, 1, p.shaker_decay_ms, sr);
  } else if (note === 41 || note === 43 || note === 48) {
    const t = note === 41 ? d.floor_tom_low : note === 43 ? d.floor_tom_high : d.hi_mid_tom;
    tom_trigger(t, vgain, p[`${t.part}_decay_ms`] * t.dmul, sr);
  } else if (note === 52 || note === 55 || note === 57) {
    // china / splash / crash 2 share one voice, retuned per note
    const h = d.crash2;
    const g = GM_DRUM_VARIANTS.find((x) => x.note === note);
    h.mul = g.pitch;
    hat_tune(h, sr);
    hat_trigger(h, vgain * g.level, p.crash_decay_ms * g.decay, sr);
  } else if (note === 53 || note === 59) {
    const h = d.ride2;
    const g = GM_DRUM_VARIANTS.find((x) => x.note === note);
    h.mul = g.pitch;
    hat_tune(h, sr);
    hat_trigger(h, vgain * g.level, p.ride_decay_ms * g.decay, sr);
  } else if (note === 54) {
    hat_trigger(d.tambourine, vgain, p.tambourine_decay_ms, sr);
  } else if (note >= 60 && note <= 66) {
    const v = d.hands[note - 60];
    v.osc.phase = 0;
    v.osc2.phase = 0;
    v.pitch_env = 1;
    v.vel = vgain;
    decay_env_trigger(v.env, 1, v.decay_ms, sr);
    decay_env_trigger(v.env2, 1, v.decay_ms * v.mode.decay, sr);
    decay_env_trigger(v.noise_env, 1, 15, sr);
  } else if (note === 67 || note === 68) {
    const v = d.bells[note - 67];
    v.vel = vgain;
    decay_env_trigger(v.fast, 1, 25, sr);
    decay_env_trigger(v.slow, 1, p.agogo_decay_ms * v.dmul, sr);
  } else if (note >= 75 && note <= 77) {
    const v = d.knocks[note - 75];
    v.osc.phase = 0;
    v.osc2.phase = 0;
    v.vel = vgain;
    const ms = p.claves_decay_ms * v.dmul;
    decay_env_trigger(v.env, 1, ms, sr);
    decay_env_trigger(v.env2, 1, ms * 0.4, sr);
    decay_env_trigger(v.click, 1, 2, sr);
  } else if (note === 80 || note === 81) {
    // one voice: the mute triangle (80) cuts the open one short
    const t = d.triangle;
    for (const o of t.oscs) o.phase = 0;
    t.vel = vgain;
    const ms = Math.max(30, p.triangle_decay_ms * (note === 80 ? 0.05 : 1));
    decay_env_trigger(t.env, 1, ms, sr);
    decay_env_trigger(t.env2, 1, ms * 0.5, sr);
    decay_env_trigger(t.click, 1, 3, sr);
  }
}

/** conga / bongo / timbale: sine + second mode, both bent up at the slap, plus slap noise */
function hand_render(d, v, sr) {
  if (v.env.value === 0) return 0;
  const tone = v.tone;
  const hz = v.hz * Math.pow(2, 0.5 * tone * v.pitch_env);
  v.pitch_env *= d.hand_pitch_coef;
  v.osc.inc = clamp(hz / sr, 0, 0.49);
  v.osc2.inc = clamp((hz * v.mode.ratio) / sr, 0, 0.49);
  const body = sine_process(v.osc) * decay_env_process(v.env) + 0.35 * sine_process(v.osc2) * decay_env_process(v.env2);
  const slap = onepole_hp(v.hp, noise_white()) * decay_env_process(v.noise_env) * tone * 0.5;
  return (body + slap) * v.vel * v.gain;
}

function hat_trigger(h, vgain, decay_ms, sr) {
  h.vel = vgain;
  h.choke = 0;
  decay_env_trigger(h.env, 1, decay_ms, sr);
}

function hat_render(h, metal_mix) {
  if (h.env.value === 0) return 0;
  if (h.choke) h.env.value *= h.choke_coef;
  let metal = 0;
  for (let i = 0; i < 6; i++) metal += square_naive_process(h.oscs[i]);
  const x = metal * (1 / 6) * metal_mix + noise_white() * (1 - metal_mix);
  svf_process(h.bp, x);
  svf_process(h.hp, h.bp.bp);
  return h.hp.hp * decay_env_process(h.env) * h.vel * h.gain * 3;
}

export function drums_render(d) {
  const p = d.p;
  const sr = d.sr;
  // one stereo bus per output group (see DRUM_BUSES in params.js)
  let kick_l = 0;
  let kick_r = 0;
  let sn_l = 0;
  let sn_r = 0;
  let hat_l = 0;
  let hat_r = 0;
  let perc_l = 0;
  let perc_r = 0;

  // Kick
  const k = d.kick;
  if (k.env.value > 0) {
    const hz = p.kick_pitch_hz * Math.pow(2, p.kick_sweep_oct * k.pitch_env);
    k.pitch_env *= k.pitch_coef;
    k.osc.inc = hz / sr;
    let y = sine_process(k.osc) * decay_env_process(k.env);
    y += onepole_hp(k.click_hp, noise_white()) * decay_env_process(k.click) * p.kick_tone * 0.6;
    const drive = 1 + 3 * p.kick_tone;
    y = soft_clip(y * drive) / soft_clip(drive) * k.vel * k.gain;
    kick_l += y * k.gl;
    kick_r += y * k.gr;
  }

  // Snare
  const s = d.snare;
  if (s.noise_env.value > 0 || s.body_env.value > 0) {
    const bend = 1 + 0.5 * s.pitch_env;
    s.pitch_env *= s.pitch_coef;
    s.osc1.inc = (p.snare_pitch_hz * bend) / sr;
    s.osc2.inc = (p.snare_pitch_hz * 1.63 * bend) / sr;
    const body = (sine_process(s.osc1) + 0.6 * sine_process(s.osc2)) * 0.6 * decay_env_process(s.body_env);
    svf_process(s.bp, noise_white());
    const noise = onepole_hp(s.hp, s.bp.bp + 0.3 * s.bp.hp) * decay_env_process(s.noise_env) * 2.5;
    const y = (body * (1 - p.snare_snappy) + noise * p.snare_snappy) * s.vel * s.gain;
    sn_l += y * s.gl;
    sn_r += y * s.gr;
  }

  // Clap: 3 short bursts, then a 4th burst that becomes the long tail
  const c = d.clap;
  if (c.t >= 0) {
    let env;
    if (c.t < 3 * c.spread) {
      const phase = c.t % c.spread;
      env = Math.pow(c.burst_coef, phase);
      c.t += 1;
    } else {
      if (c.t === 3 * c.spread) c.tail = 1;
      env = c.tail;
      c.tail *= c.tail_coef;
      if (c.tail < 0.000001) c.t = -1; // finished
      else c.t += 1;
    }
    svf_process(c.bp, noise_white());
    const y = c.bp.bp * env * c.vel * c.gain * 3.5;
    sn_l += y * c.gl;
    sn_r += y * c.gr;
  }

  const ch = hat_render(d.closed_hat, p.closed_hat_metal_mix);
  hat_l += ch * d.closed_hat.gl;
  hat_r += ch * d.closed_hat.gr;
  const oh = hat_render(d.open_hat, p.open_hat_metal_mix);
  hat_l += oh * d.open_hat.gl;
  hat_r += oh * d.open_hat.gr;

  const cr = hat_render(d.crash, p.crash_metal_mix);
  hat_l += cr * d.crash.gl;
  hat_r += cr * d.crash.gr;
  const rd = hat_render(d.ride, p.ride_metal_mix);
  hat_l += rd * d.ride.gl;
  hat_r += rd * d.ride.gr;

  const lt = tom_render(d.low_tom, p.low_tom_pitch_hz, p.low_tom_tone, sr);
  const mt = tom_render(d.mid_tom, p.mid_tom_pitch_hz, p.mid_tom_tone, sr);
  const ht = tom_render(d.high_tom, p.high_tom_pitch_hz, p.high_tom_tone, sr);
  perc_l += lt * d.low_tom.gl + mt * d.mid_tom.gl + ht * d.high_tom.gl;
  perc_r += lt * d.low_tom.gr + mt * d.mid_tom.gr + ht * d.high_tom.gr;

  // Rimshot
  const rs = d.rimshot;
  if (rs.env.value > 0) {
    const env = decay_env_process(rs.env);
    const body = (sine_process(rs.osc1) * 0.7 + sine_process(rs.osc2) * 0.5) * env;
    const click = onepole_hp(rs.hp, noise_white()) * decay_env_process(rs.click) * 0.5;
    const drive = 1 + 4 * p.rimshot_tone;
    const y = (soft_clip((body + click) * drive) / soft_clip(drive)) * rs.vel * rs.gain;
    sn_l += y * rs.gl;
    sn_r += y * rs.gr;
  }

  // Cowbell
  const cb = d.cowbell;
  if (cb.slow.value > 0) {
    const env = 0.6 * decay_env_process(cb.fast) + 0.4 * decay_env_process(cb.slow);
    svf_process(cb.bp, (square_naive_process(cb.osc1) + square_naive_process(cb.osc2)) * 0.5);
    const y = cb.bp.bp * env * cb.vel * cb.gain * 2;
    perc_l += y * cb.gl;
    perc_r += y * cb.gr;
  }

  // Shaker
  const sh = d.shaker;
  if (sh.env.value > 0) {
    let env;
    if (sh.attack < 1) {
      sh.attack = Math.min(1, sh.attack + sh.attack_inc);
      env = sh.attack * sh.attack;
    } else {
      env = decay_env_process(sh.env);
    }
    svf_process(sh.bp, noise_white());
    const y = sh.bp.bp * env * sh.vel * sh.gain * 2.5;
    perc_l += y * sh.gl;
    perc_r += y * sh.gr;
  }

  // ---- GM percussion (all on the perc bus, except the cymbal variants on the hats bus)
  const tb = hat_render(d.tambourine, 0.7);
  perc_l += tb * d.tambourine.gl;
  perc_r += tb * d.tambourine.gr;
  const ft1 = tom_render(d.floor_tom_low, p.low_tom_pitch_hz, p.low_tom_tone, sr);
  const ft2 = tom_render(d.floor_tom_high, p.low_tom_pitch_hz, p.low_tom_tone, sr);
  const hmt = tom_render(d.hi_mid_tom, p.mid_tom_pitch_hz, p.mid_tom_tone, sr);
  perc_l += ft1 * d.floor_tom_low.gl + ft2 * d.floor_tom_high.gl + hmt * d.hi_mid_tom.gl;
  perc_r += ft1 * d.floor_tom_low.gr + ft2 * d.floor_tom_high.gr + hmt * d.hi_mid_tom.gr;
  const c2 = hat_render(d.crash2, p.crash_metal_mix);
  hat_l += c2 * d.crash2.gl;
  hat_r += c2 * d.crash2.gr;
  // ride bell: the square cluster alone (no noise)
  const r2 = hat_render(d.ride2, d.ride2.mul > 1 ? 1 : p.ride_metal_mix);
  hat_l += r2 * d.ride2.gl;
  hat_r += r2 * d.ride2.gr;
  for (const v of d.hands) {
    const y = hand_render(d, v, sr);
    perc_l += y * v.gl;
    perc_r += y * v.gr;
  }
  for (const v of d.bells) {
    if (v.slow.value === 0) continue;
    const env = 0.5 * decay_env_process(v.fast) + 0.5 * decay_env_process(v.slow);
    svf_process(v.bp, (square_naive_process(v.osc1) + square_naive_process(v.osc2)) * 0.5);
    const y = v.bp.bp * env * v.vel * v.gain * 2;
    perc_l += y * v.gl;
    perc_r += y * v.gr;
  }
  for (const v of d.knocks) {
    if (v.env.value === 0) continue;
    const body = sine_process(v.osc) * decay_env_process(v.env) + 0.4 * p.claves_tone * sine_process(v.osc2) * decay_env_process(v.env2);
    const click = onepole_hp(v.hp, noise_white()) * decay_env_process(v.click) * p.claves_tone * 0.6;
    const y = (body + click) * v.vel * v.gain * 1.2;
    perc_l += y * v.gl;
    perc_r += y * v.gr;
  }
  const tri = d.triangle;
  if (tri.env.value > 0) {
    const e1 = decay_env_process(tri.env);
    const e2 = decay_env_process(tri.env2);
    let x = 0;
    for (let i = 0; i < TRI_RATIOS.length; i++) {
      const lv = TRI_LEVELS[i] * (i === 0 ? 1 - 0.5 * p.triangle_tone : 1.5 * p.triangle_tone);
      x += sine_process(tri.oscs[i]) * lv * (i < 3 ? e1 : e2);
    }
    x += onepole_hp(tri.hp, noise_white()) * decay_env_process(tri.click) * 0.5;
    const y = x * 0.35 * tri.vel * tri.gain;
    perc_l += y * tri.gl;
    perc_r += y * tri.gr;
  }

  const g = d.master_gain * 0.8;
  const l = kick_l * d.bus_main[0] + sn_l * d.bus_main[1] + hat_l * d.bus_main[2] + perc_l * d.bus_main[3];
  const r = kick_r * d.bus_main[0] + sn_r * d.bus_main[1] + hat_r * d.bus_main[2] + perc_r * d.bus_main[3];
  d.out_l = soft_clip(l * g);
  d.out_r = soft_clip(r * g);
  // separate outputs (JSFX pins 3..10); the web player only uses the main mix
  d.bus_l[0] = soft_clip(kick_l * g);
  d.bus_r[0] = soft_clip(kick_r * g);
  d.bus_l[1] = soft_clip(sn_l * g);
  d.bus_r[1] = soft_clip(sn_r * g);
  d.bus_l[2] = soft_clip(hat_l * g);
  d.bus_r[2] = soft_clip(hat_r * g);
  d.bus_l[3] = soft_clip(perc_l * g);
  d.bus_r[3] = soft_clip(perc_r * g);
}
