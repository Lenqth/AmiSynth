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

import {
  clamp, db_to_gain, decay_env_init, decay_env_process, decay_env_trigger, noise_seed, noise_white, random_unit,
  onepole_hp, onepole_init, onepole_set, pan_gains, sine_process, soft_clip,
  square_naive_process, svf_init, svf_process, svf_reset, svf_set, t60_coef, tau_coef,
} from './lib.js';

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

function tom_create() {
  const t = { osc: { phase: 0, inc: 0 }, env: {}, noise_env: {}, pitch_env: 0, pitch_coef: 0, hp: {}, vel: 0, gain: 1, gl: 1, gr: 1 };
  decay_env_init(t.env);
  decay_env_init(t.noise_env);
  onepole_init(t.hp);
  return t;
}

function hat_create() {
  const h = { env: {}, hp: {}, bp: {}, oscs: [], vel: 0, choke: 0, choke_coef: 0, gl: 1, gr: 1 };
  decay_env_init(h.env);
  svf_init(h.hp);
  svf_init(h.bp);
  for (let i = 0; i < 6; i++) h.oscs.push({ phase: random_unit(), inc: 0 });
  return h;
}

export function drums_init(d, sr) {
  noise_seed(12345);
  d.sr = sr;
  d.p = {};
  d.out_l = 0;
  d.out_r = 0;

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
}

/** JSFX @slider equivalent. */
export function drums_update(d, p) {
  d.p = p;
  const sr = d.sr;
  d.master_gain = db_to_gain(p.drum_master_volume_db);

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
}

/** bp_hz: band-pass centre; hp_base_hz: high-pass at tone 0 (x4 at tone 1). */
function hat_update(h, pitch_hz, tone, level_db, pan, bp_hz, hp_base_hz, sr) {
  pan_gains(h, pan);
  h.gain = db_to_gain(level_db);
  for (let i = 0; i < 6; i++) h.oscs[i].inc = clamp((pitch_hz * HAT_RATIOS[i]) / sr, 0, 0.49);
  svf_set(h.hp, hp_base_hz * Math.pow(4, tone), 1.2, sr);
  svf_set(h.bp, bp_hz, 1.0, sr);
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
  t.osc.inc = (pitch_hz * Math.pow(2, tone * t.pitch_env)) / sr;
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
  const vgain = 0.2 + 0.8 * vel * vel;

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
    hat_trigger(d.closed_hat, vgain, p.closed_hat_decay_ms, sr);
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
  }
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
  let l = 0;
  let r = 0;

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
    l += y * k.gl;
    r += y * k.gr;
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
    l += y * s.gl;
    r += y * s.gr;
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
    l += y * c.gl;
    r += y * c.gr;
  }

  const ch = hat_render(d.closed_hat, p.closed_hat_metal_mix);
  l += ch * d.closed_hat.gl;
  r += ch * d.closed_hat.gr;
  const oh = hat_render(d.open_hat, p.open_hat_metal_mix);
  l += oh * d.open_hat.gl;
  r += oh * d.open_hat.gr;

  const cr = hat_render(d.crash, p.crash_metal_mix);
  l += cr * d.crash.gl;
  r += cr * d.crash.gr;
  const rd = hat_render(d.ride, p.ride_metal_mix);
  l += rd * d.ride.gl;
  r += rd * d.ride.gr;

  const lt = tom_render(d.low_tom, p.low_tom_pitch_hz, p.low_tom_tone, sr);
  const mt = tom_render(d.mid_tom, p.mid_tom_pitch_hz, p.mid_tom_tone, sr);
  const ht = tom_render(d.high_tom, p.high_tom_pitch_hz, p.high_tom_tone, sr);
  l += lt * d.low_tom.gl + mt * d.mid_tom.gl + ht * d.high_tom.gl;
  r += lt * d.low_tom.gr + mt * d.mid_tom.gr + ht * d.high_tom.gr;

  // Rimshot
  const rs = d.rimshot;
  if (rs.env.value > 0) {
    const env = decay_env_process(rs.env);
    const body = (sine_process(rs.osc1) * 0.7 + sine_process(rs.osc2) * 0.5) * env;
    const click = onepole_hp(rs.hp, noise_white()) * decay_env_process(rs.click) * 0.5;
    const drive = 1 + 4 * p.rimshot_tone;
    const y = (soft_clip((body + click) * drive) / soft_clip(drive)) * rs.vel * rs.gain;
    l += y * rs.gl;
    r += y * rs.gr;
  }

  // Cowbell
  const cb = d.cowbell;
  if (cb.slow.value > 0) {
    const env = 0.6 * decay_env_process(cb.fast) + 0.4 * decay_env_process(cb.slow);
    svf_process(cb.bp, (square_naive_process(cb.osc1) + square_naive_process(cb.osc2)) * 0.5);
    const y = cb.bp.bp * env * cb.vel * cb.gain * 2;
    l += y * cb.gl;
    r += y * cb.gr;
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
    l += y * sh.gl;
    r += y * sh.gr;
  }

  const g = d.master_gain * 0.8;
  d.out_l = soft_clip(l * g);
  d.out_r = soft_clip(r * g);
}
