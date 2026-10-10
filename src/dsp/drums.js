// AmiSynth drum machine core: 5 fully synthesized parts, no samples.
// Same structure as synth.js (init / update / trigger / render-one-sample).
//
//   36 Kick        sine + exponential pitch drop, click + saturation
//   38 Snare       two detuned sines (body) + band-passed noise
//   39 Clap        several short noise bursts + tail, band-passed
//   42 Closed hat  6 detuned squares + noise, band/high-passed, short decay
//   46 Open hat    same circuit, long decay, choked by the closed hat

import {
  clamp, db_to_gain, decay_env_init, decay_env_process, decay_env_trigger, noise_white,
  onepole_hp, onepole_init, onepole_set, pan_gains, sine_process, soft_clip,
  square_naive_process, svf_init, svf_process, svf_reset, svf_set, t60_coef, tau_coef,
} from './lib.js';

export const NOTE_KICK = 36;
export const NOTE_SNARE = 38;
export const NOTE_CLAP = 39;
export const NOTE_CLOSED_HAT = 42;
export const NOTE_OPEN_HAT = 46;

// Classic 808-style cymbal oscillator ratios (205.3, 304.4, 369.6, 522.7, 540, 800 Hz / 205.3)
const HAT_RATIOS = [1, 1.4827, 1.8003, 2.546, 2.6303, 3.8967];

function hat_create() {
  const h = { env: {}, hp: {}, bp: {}, oscs: [], vel: 0, choke: 0, choke_coef: 0, gl: 1, gr: 1 };
  decay_env_init(h.env);
  svf_init(h.hp);
  svf_init(h.bp);
  for (let i = 0; i < 6; i++) h.oscs.push({ phase: Math.random(), inc: 0 });
  return h;
}

export function drums_init(d, sr) {
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

  hat_update(d.closed_hat, p.closed_hat_pitch_hz, p.closed_hat_tone, p.closed_hat_level_db, p.closed_hat_pan, sr);
  hat_update(d.open_hat, p.open_hat_pitch_hz, p.open_hat_tone, p.open_hat_level_db, p.open_hat_pan, sr);
}

function hat_update(h, pitch_hz, tone, level_db, pan, sr) {
  pan_gains(h, pan);
  h.gain = db_to_gain(level_db);
  for (let i = 0; i < 6; i++) h.oscs[i].inc = clamp((pitch_hz * HAT_RATIOS[i]) / sr, 0, 0.49);
  // tone 0..1 -> high-pass 3 kHz .. 12 kHz
  svf_set(h.hp, 3000 * Math.pow(4, tone), 1.2, sr);
  svf_set(h.bp, 10000, 1.0, sr);
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

  const g = d.master_gain * 0.8;
  d.out_l = soft_clip(l * g);
  d.out_r = soft_clip(r * g);
}
