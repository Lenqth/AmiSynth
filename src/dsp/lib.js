// AmiSynth shared DSP library.
//
// Porting rules (JS -> JSFX/EEL2 .jsfx-inc):
//   * Every "object" is a plain JS object holding only numbers.
//     JS  `foo_process(o, x)` with `o.state`  ->  EEL2 `function foo_process(x) instance(state) (...)`
//     called as `voice.filt.foo_process(x)` (EEL2 namespaces).
//   * Only scalar math (Math.sin/exp/tan/pow/...) and if/else. No closures, no allocation in
//     the audio loop, no Web Audio nodes.
//   * Sample rate is passed explicitly (`sr`), mirroring JSFX `srate`.
//   * Random numbers come from noise_white(): a Park-Miller LCG done in plain double
//     arithmetic, so JS and EEL2 produce the *same* sequence (lets tests compare the JSFX
//     port with this code sample by sample). Instruments reseed it in their init.

export const PI = Math.PI;
export const TWO_PI = 2 * Math.PI;

// ----------------------------------------------------------------------------
// Utilities

export function db_to_gain(db) {
  return db <= -60 ? 0 : Math.pow(10, db / 20);
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Coefficient for an exponential decay reaching -60 dB after `ms`. */
export function t60_coef(ms, sr) {
  return Math.exp(-6.907755 / (Math.max(ms, 0.01) * 0.001 * sr));
}

/** Coefficient for a one-pole smoother with time constant `ms`. */
export function tau_coef(ms, sr) {
  return Math.exp(-1 / (Math.max(ms, 0.001) * 0.001 * sr));
}

/** Smooth, symmetric soft clipper (tanh approximation, exact +/-1 beyond |x|>=3). */
export function soft_clip(x) {
  if (x > 3) return 1;
  if (x < -3) return -1;
  const x2 = x * x;
  return (x * (27 + x2)) / (27 + 9 * x2);
}

let noise_state = 22222;

export function noise_seed(seed) {
  noise_state = Math.max(1, Math.floor(seed) % 2147483646);
}

/** White noise in [-1, 1). Deterministic (see header); EEL2 port uses the same formula. */
export function noise_white() {
  noise_state *= 16807;
  noise_state -= Math.floor(noise_state / 2147483647) * 2147483647;
  return noise_state / 1073741823.5 - 1;
}

/** Uniform random in [0, 1) from the same generator. */
export function random_unit() {
  return (noise_white() + 1) * 0.5;
}

/** Equal power pan. Writes gains into o.gl / o.gr. pan in [-1, 1]. */
export function pan_gains(o, pan) {
  const a = (clamp(pan, -1, 1) + 1) * 0.25 * PI;
  o.gl = Math.cos(a) * 1.41421356;
  o.gr = Math.sin(a) * 1.41421356;
}

// ----------------------------------------------------------------------------
// Tuning (not tied to 12-TET)
//
// A scale is a table of `scale_size` degrees in cents (degree 0 = 0 cents) plus a
// period (normally 1200 cents). Note n is mapped as:
//   steps   = n - ref_note
//   period  = floor(steps / scale_size)
//   degree  = steps - period * scale_size
//   cents   = period * period_cents + table[degree]
//   freq    = ref_hz * 2^(cents / 1200)
// An EDO is just table[i] = i * period_cents / divisions.
// In JSFX the table lives in a memory block (e.g. `scale_table = 1024;`).

export function tuning_init(o) {
  o.size = 12;
  o.period_cents = 1200;
  o.ref_note = 69;
  o.ref_hz = 440;
  o.table = new Float64Array(256);
  tuning_set_edo(o, 12, 1200);
}

export function tuning_set_edo(o, divisions, period_cents) {
  divisions = Math.max(1, Math.min(255, Math.round(divisions)));
  o.size = divisions;
  o.period_cents = period_cents;
  for (let i = 0; i < divisions; i++) o.table[i] = (i * period_cents) / divisions;
}

/** cents_list: degrees 1..N in cents, last element = period (Scala convention). */
export function tuning_set_table(o, cents_list, count) {
  count = Math.max(1, Math.min(255, count));
  o.size = count;
  o.table[0] = 0;
  for (let i = 1; i < count; i++) o.table[i] = cents_list[i - 1];
  o.period_cents = cents_list[count - 1];
}

/** Fractional notes are interpolated linearly in cents. */
export function tuning_note_to_hz(o, note) {
  const base = Math.floor(note);
  const frac = note - base;
  let c = tuning_note_cents(o, base);
  if (frac > 0) c += frac * (tuning_note_cents(o, base + 1) - c);
  return o.ref_hz * Math.pow(2, c / 1200);
}

export function tuning_note_cents(o, note) {
  const steps = note - o.ref_note;
  const period = Math.floor(steps / o.size);
  const degree = steps - period * o.size;
  return period * o.period_cents + o.table[degree];
}

// ----------------------------------------------------------------------------
// Oscillator: phase accumulator with PolyBLEP anti-aliasing.
// waveform: 0 = saw, 1 = pulse (pw = duty cycle, 0.5 = square), 2 = triangle, 3 = sine
// pm: phase modulation in cycles (used for FM; 0 = none)
// After osc_process(), o.wrapped is 1 on the sample where the phase wrapped (for hard sync).

export function osc_init(o) {
  o.phase = 0;
  o.inc = 0;
  o.wrapped = 0;
}

export function osc_reset(o, phase) {
  o.phase = phase;
  o.wrapped = 0;
}

export function osc_set_freq(o, hz, sr) {
  o.inc = clamp(hz / sr, 0, 0.49);
}

/** PolyBLEP residual. t = phase in [0,1), dt = phase increment. */
export function poly_blep(t, dt) {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  } else if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
}

export function osc_process(o, waveform, pw, pm) {
  let t = o.phase + pm;
  t -= Math.floor(t);
  const dt = o.inc;
  let y;
  if (waveform < 0.5) {
    y = 2 * t - 1 - poly_blep(t, dt);
  } else if (waveform < 1.5) {
    let t2 = t - pw;
    if (t2 < 0) t2 += 1;
    // rising edge at t=0, falling edge at t=pw; subtract DC so PWM does not thump
    y = (t < pw ? 1 : -1) + poly_blep(t, dt) - poly_blep(t2, dt) - (2 * pw - 1);
  } else if (waveform < 2.5) {
    // Naive triangle: harmonics fall at 12 dB/oct so aliasing is negligible.
    y = 1 - 4 * Math.abs(t - 0.5);
  } else {
    y = Math.sin(TWO_PI * t);
  }
  o.phase += dt;
  o.wrapped = 0;
  if (o.phase >= 1) {
    o.phase -= 1;
    o.wrapped = 1;
  }
  return y;
}

/** Hard sync: restart slave at the master's sub-sample wrap position. Call right after the master wrapped. */
export function osc_sync_to(slave, master) {
  slave.phase = master.inc > 0 ? (master.phase / master.inc) * slave.inc : 0;
}

/** Plain sine oscillator (used by drums / LFO). Returns sin(2*pi*phase). */
export function sine_process(o) {
  const y = Math.sin(TWO_PI * o.phase);
  o.phase += o.inc;
  if (o.phase >= 1) o.phase -= 1;
  return y;
}

/** Naive square (intentionally aliasing; used for metallic hats). */
export function square_naive_process(o) {
  const y = o.phase < 0.5 ? 1 : -1;
  o.phase += o.inc;
  if (o.phase >= 1) o.phase -= 1;
  return y;
}

// ----------------------------------------------------------------------------
// LFO: 0 sine, 1 triangle, 2 saw down, 3 square, 4 sample & hold, 5 duck. Output -1..1.
// Duck is a sidechain-style pump: it falls from +1 to -1 at the start of each cycle (in the
// first 3 %, so the gain change does not click) and recovers along a curve. Used as a tremolo
// it makes the sound "breathe" with the beat when the LFO is tempo synced.

export function lfo_init(o) {
  o.phase = 0;
  o.inc = 0;
  o.held = 0;
}

/** Shape of the LFO at phase t (0..1). held = current sample & hold value. */
export function lfo_wave(waveform, t, held) {
  if (waveform < 0.5) return Math.sin(TWO_PI * t);
  if (waveform < 1.5) return 1 - 4 * Math.abs(t - 0.5);
  if (waveform < 2.5) return 1 - 2 * t;
  if (waveform < 3.5) return t < 0.5 ? 1 : -1;
  if (waveform < 4.5) return held;
  if (t < 0.03) return 1 - t * 66.66666666666667;
  const u = (1 - t) * 1.0309278350515465; // 1 / 0.97
  const u2 = u * u;
  return 1 - 2 * u2 * u2;
}

/** Free-running LFO: returns the value at the current phase, then advances by o.inc. */
export function lfo_process(o, waveform) {
  const y = lfo_wave(waveform, o.phase, o.held);
  o.phase += o.inc;
  if (o.phase >= 1) {
    o.phase -= 1;
    o.held = noise_white();
  }
  return y;
}

/** Tempo-synced LFO: the phase comes from the host beat position; a new S&H value at each wrap. */
export function lfo_process_at(o, waveform, phase) {
  if (phase < o.phase) o.held = noise_white();
  o.phase = phase;
  return lfo_wave(waveform, phase, o.held);
}

// ----------------------------------------------------------------------------
// State variable filter (TPT / Zavalishin). Stable under fast modulation.
// Outputs are left in o.lp / o.bp / o.hp after svf_process().

export function svf_init(o) {
  o.ic1 = 0;
  o.ic2 = 0;
  o.g = 0;
  o.k = 1.414;
  o.a1 = 0;
  o.a2 = 0;
  o.a3 = 0;
  o.lp = 0;
  o.bp = 0;
  o.hp = 0;
}

/** k = 1/Q (2 = no resonance, ~0 = self oscillation). */
export function svf_set(o, cutoff_hz, k, sr) {
  const fc = clamp(cutoff_hz, 5, sr * 0.49);
  o.g = Math.tan((PI * fc) / sr);
  o.k = k;
  o.a1 = 1 / (1 + o.g * (o.g + k));
  o.a2 = o.g * o.a1;
  o.a3 = o.g * o.a2;
}

export function svf_process(o, x) {
  const v3 = x - o.ic2;
  const v1 = o.a1 * o.ic1 + o.a2 * v3;
  const v2 = o.ic2 + o.a2 * o.ic1 + o.a3 * v3;
  o.ic1 = 2 * v1 - o.ic1;
  o.ic2 = 2 * v2 - o.ic2;
  o.lp = v2;
  o.bp = v1;
  o.hp = x - o.k * v1 - v2;
  return v2;
}

/** Copy coefficients (not state) so a second channel can reuse one tan() per sample. */
export function svf_copy_coefs(dst, src) {
  dst.g = src.g;
  dst.k = src.k;
  dst.a1 = src.a1;
  dst.a2 = src.a2;
  dst.a3 = src.a3;
}

/** Pick an output of the last svf_process(): 0 low-pass, 1 high-pass, 2 band-pass, 3 notch. */
export function svf_output(o, mode) {
  if (mode < 0.5) return o.lp;
  if (mode < 1.5) return o.hp;
  if (mode < 2.5) return o.bp;
  return o.lp + o.hp;
}

export function svf_reset(o) {
  o.ic1 = 0;
  o.ic2 = 0;
}

// ----------------------------------------------------------------------------
// One-pole filters

export function onepole_init(o) {
  o.z = 0;
  o.a = 0;
}

export function onepole_set(o, cutoff_hz, sr) {
  o.a = 1 - Math.exp((-TWO_PI * clamp(cutoff_hz, 1, sr * 0.49)) / sr);
}

export function onepole_lp(o, x) {
  o.z += o.a * (x - o.z);
  return o.z;
}

export function onepole_hp(o, x) {
  o.z += o.a * (x - o.z);
  return x - o.z;
}

/** Parameter smoother: o.z glides to target with the coefficient set by smoother_set(). */
export function smoother_init(o, value) {
  o.z = value;
  o.c = 0;
}

export function smoother_set(o, ms, sr) {
  o.c = tau_coef(ms, sr);
}

export function smoother_process(o, target) {
  o.z = target + o.c * (o.z - target);
  return o.z;
}

// ----------------------------------------------------------------------------
// Sidechain envelope follower (JSFX input pins 3/4): the louder of the two channels times the
// input gain, a one-pole attack / release, read as 0..1 (capped). duck = how many dB the output
// drops at 1.

export function sidechain_init(o) {
  o.env = 0;
  o.gain = 1;
  o.att = 0;
  o.rel = 0;
  o.duck_db = 0;
}

export function sidechain_set(o, gain_db, attack_ms, release_ms, duck_db, sr) {
  o.gain = Math.pow(10, gain_db / 20);
  o.att = tau_coef(attack_ms, sr);
  o.rel = tau_coef(release_ms, sr);
  o.duck_db = duck_db;
}

export function sidechain_process(o, l, r) {
  const x = Math.max(Math.abs(l), Math.abs(r)) * o.gain;
  o.env = x + (x > o.env ? o.att : o.rel) * (o.env - x);
  return Math.min(o.env, 1);
}

/** Output gain for follower value e (1 when ducking is off). */
export function sidechain_duck_gain(o, e) {
  return o.duck_db > 0 ? Math.pow(10, (-o.duck_db * e) / 20) : 1;
}

// ----------------------------------------------------------------------------
// MIDI channel mixer: CC7 Volume, CC11 Expression and CC10 Pan on the instrument's output.
// Volume and expression follow the GM curve (gain = (value / 127)^2, i.e. 40 log10); pan is a
// balance (centre = both sides at full level, the far side fades with a quarter cosine). Both
// start at full level / centre, so nothing changes until a CC arrives. on = 0 ignores the CCs.
// g / bl / br glide to their targets (20 ms) so a CC does not click.

export function midi_mix_init(o, sr) {
  o.on = 1;
  o.vol = 1;
  o.expr = 1;
  o.pan = 0;
  o.g = 1;
  o.bl = 1;
  o.br = 1;
  o.g_t = 1;
  o.bl_t = 1;
  o.br_t = 1;
  o.c = tau_coef(20, sr);
}

function midi_mix_targets(o) {
  const a = o.on ? o.pan : 0;
  o.g_t = o.on ? o.vol * o.expr : 1;
  o.bl_t = a > 0 ? Math.cos(a * 0.5 * PI) : 1;
  o.br_t = a < 0 ? Math.cos(-a * 0.5 * PI) : 1;
}

/** CC7 / CC10 / CC11 (other numbers are ignored). */
export function midi_mix_cc(o, number, value) {
  const x = clamp(value / 127, 0, 1);
  if (number === 7) o.vol = x * x;
  else if (number === 11) o.expr = x * x;
  else if (number === 10) o.pan = clamp((value - 64) / 63, -1, 1);
  else return;
  midi_mix_targets(o);
}

/** The instrument's "MIDI Volume / Pan" switch. */
export function midi_mix_enable(o, on) {
  o.on = on ? 1 : 0;
  midi_mix_targets(o);
}

/** Reset All Controllers (CC121): expression back to full; volume and pan stay (GM RP-015). */
export function midi_mix_reset(o) {
  o.expr = 1;
  midi_mix_targets(o);
}

/** Once per sample: advances o.g (volume x expression) and the balance gains o.bl / o.br. */
export function midi_mix_tick(o) {
  o.g = o.g_t + o.c * (o.g - o.g_t);
  o.bl = o.bl_t + o.c * (o.bl - o.bl_t);
  o.br = o.br_t + o.c * (o.br - o.br_t);
}

// ----------------------------------------------------------------------------
// ADSR envelope
// stage: 0 idle, 1 attack, 2 decay/sustain, 3 release
// Attack is linear, decay & release are exponential (time = to -60 dB).

export function adsr_init(o) {
  o.stage = 0;
  o.value = 0;
  o.attack_inc = 0;
  o.decay_coef = 0;
  o.release_coef = 0;
  o.sustain = 0;
}

export function adsr_set(o, attack_ms, decay_ms, sustain, release_ms, sr) {
  o.attack_inc = 1 / (Math.max(attack_ms, 0.01) * 0.001 * sr);
  o.decay_coef = t60_coef(decay_ms, sr);
  o.release_coef = t60_coef(release_ms, sr);
  o.sustain = sustain;
}

/** Legato-friendly: restarts attack from the current value (no click). */
export function adsr_gate_on(o) {
  o.stage = 1;
}

/** Legato: an envelope in its release goes back to decay / sustain (no new attack). */
export function adsr_resume(o) {
  if (o.stage === 3) o.stage = 2;
  else if (o.stage === 0) o.stage = 1;
}

export function adsr_gate_off(o) {
  if (o.stage !== 0) o.stage = 3;
}

export function adsr_process(o) {
  if (o.stage === 1) {
    o.value += o.attack_inc;
    if (o.value >= 1) {
      o.value = 1;
      o.stage = 2;
    }
  } else if (o.stage === 2) {
    o.value = o.sustain + o.decay_coef * (o.value - o.sustain);
  } else if (o.stage === 3) {
    o.value *= o.release_coef;
    if (o.value < 0.00001) {
      o.value = 0;
      o.stage = 0;
    }
  }
  return o.value;
}

// ----------------------------------------------------------------------------
// One-shot exponential decay envelope (drums)

export function decay_env_init(o) {
  o.value = 0;
  o.coef = 0;
}

export function decay_env_trigger(o, level, ms, sr) {
  o.value = level;
  o.coef = t60_coef(ms, sr);
}

export function decay_env_process(o) {
  const v = o.value;
  o.value *= o.coef;
  if (o.value < 0.000001) o.value = 0;
  return v;
}

// ----------------------------------------------------------------------------
// Fractional delay line (circular buffer). JSFX: a memory block + write index.

export function delay_init(o, size) {
  o.buf = new Float64Array(size);
  o.size = size;
  o.w = 0;
}

export function delay_write(o, x) {
  o.buf[o.w] = x;
  o.w += 1;
  if (o.w >= o.size) o.w = 0;
}

/** Read `d` samples behind the most recent write (1 <= d < size), linear interpolation. */
export function delay_read(o, d) {
  let pos = o.w - d;
  while (pos < 0) pos += o.size;
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  const i1 = i0 + 1 >= o.size ? 0 : i0 + 1;
  return o.buf[i0] + frac * (o.buf[i1] - o.buf[i0]);
}

export function delay_clear(o) {
  o.buf.fill(0);
  o.w = 0;
}

// ----------------------------------------------------------------------------
// Two-pole resonator: rings at `hz` and decays to -60 dB in `t60_ms`.
// The input gain is normalised so a unit impulse gives a sine of amplitude `gain`.
//   y[n] = a1*y[n-1] - a2*y[n-2] + b0*x[n]

export function reson_init(o) {
  o.y1 = 0;
  o.y2 = 0;
  o.a1 = 0;
  o.a2 = 0;
  o.b0 = 0;
  o.amp = 0; // peak follower (for visualisation)
}

export function reson_set(o, hz, t60_ms, gain, sr) {
  if (hz <= 0 || hz >= sr * 0.45) {
    o.a1 = 0;
    o.a2 = 0;
    o.b0 = 0;
    return;
  }
  const w = (TWO_PI * hz) / sr;
  const r = t60_coef(t60_ms, sr);
  o.a1 = 2 * r * Math.cos(w);
  o.a2 = r * r;
  o.b0 = Math.sin(w) * gain;
}

/** Change only the decay (keeps frequency): used for note-off damping. */
export function reson_set_decay(o, hz, t60_ms, sr) {
  if (o.b0 === 0) return;
  const w = (TWO_PI * hz) / sr;
  const r = t60_coef(t60_ms, sr);
  o.a1 = 2 * r * Math.cos(w);
  o.a2 = r * r;
}

export function reson_process(o, x) {
  const y = o.a1 * o.y1 - o.a2 * o.y2 + o.b0 * x;
  o.y2 = o.y1;
  o.y1 = y;
  const a = y < 0 ? -y : y;
  o.amp = a > o.amp ? a : o.amp * 0.9995;
  return y;
}

export function reson_reset(o) {
  o.y1 = 0;
  o.y2 = 0;
  o.amp = 0;
}

// ----------------------------------------------------------------------------
// First-order all-pass  H(z) = (a + z^-1) / (1 + a z^-1)
// Used in a string loop to make the delay frequency dependent (dispersion): with a < 0
// high frequencies travel faster, so upper partials go sharp like on a stiff (piano) string.

export function ap1_init(o) {
  o.x1 = 0;
  o.y1 = 0;
}

export function ap1_process(o, x, a) {
  const y = a * x + o.x1 - a * o.y1;
  o.x1 = x;
  o.y1 = y;
  return y;
}

/** Phase delay in samples of the all-pass at normalised angular frequency w (0 < w < pi). */
export function ap1_phase_delay(a, w) {
  const ph = Math.atan2(-Math.sin(w), a + Math.cos(w)) - Math.atan2(-a * Math.sin(w), 1 + a * Math.cos(w));
  return -ph / w;
}

/** Phase delay in samples of the one-pole low-pass y = (1-b)x + b*y1 at w. */
export function lp1_phase_delay(b, w) {
  return Math.atan2(b * Math.sin(w), 1 - b * Math.cos(w)) / w;
}

// ----------------------------------------------------------------------------
// Effects building blocks (chorus, echo, reverb). Each owns its delay memory, allocated once in
// its init (JSFX: in @init, sized from srate). The effect writes its wet output into o.l / o.r.

/** Schroeder all-pass on a delay line `o` (from delay_init): flat magnitude, smears the phase. */
export function allpass_process(o, x, d, g) {
  const y0 = delay_read(o, d);
  const v = x + g * y0;
  delay_write(o, v);
  return y0 - g * v;
}

// ---- 4-line feedback delay network (Hadamard mixing, one-pole damping in each line).
// Used for the Physical "Room" and, behind two all-pass diffusers, for the synth reverb.

/** Line lengths in samples at 48 kHz (mutually prime), scaled by sample rate and size. */
export const FDN_LENS = [1171, 1429, 1663, 1951];

/** size = samples per line (must hold the longest scaled line + 2). */
export function fdn4_init(o, size) {
  o.d0 = {};
  o.d1 = {};
  o.d2 = {};
  o.d3 = {};
  delay_init(o.d0, size);
  delay_init(o.d1, size);
  delay_init(o.d2, size);
  delay_init(o.d3, size);
  o.maxlen = size - 2;
  o.len0 = o.len1 = o.len2 = o.len3 = 2;
  o.g0 = o.g1 = o.g2 = o.g3 = 0;
  o.z0 = o.z1 = o.z2 = o.z3 = 0;
  o.damp = 0.55;
  o.l = 0;
  o.r = 0;
}

/**
 * scale: line length multiplier (room size). decay_ms: time to -60 dB.
 * damp: one-pole coefficient in each line (1 = no damping, smaller = high frequencies die sooner).
 */
export function fdn4_set(o, scale, decay_ms, damp, sr) {
  o.len0 = clamp(Math.round((FDN_LENS[0] * scale * sr) / 48000), 2, o.maxlen);
  o.len1 = clamp(Math.round((FDN_LENS[1] * scale * sr) / 48000), 2, o.maxlen);
  o.len2 = clamp(Math.round((FDN_LENS[2] * scale * sr) / 48000), 2, o.maxlen);
  o.len3 = clamp(Math.round((FDN_LENS[3] * scale * sr) / 48000), 2, o.maxlen);
  // -60 dB after decay_ms: each pass through a line of len samples loses 60*len/(T*sr) dB
  o.g0 = Math.pow(10, (-3 * o.len0) / (decay_ms * 0.001 * sr));
  o.g1 = Math.pow(10, (-3 * o.len1) / (decay_ms * 0.001 * sr));
  o.g2 = Math.pow(10, (-3 * o.len2) / (decay_ms * 0.001 * sr));
  o.g3 = Math.pow(10, (-3 * o.len3) / (decay_ms * 0.001 * sr));
  o.damp = damp;
}

/** Mono in; o.l = lines 0 + 2, o.r = lines 1 + 3. */
export function fdn4_process(o, x) {
  // read, damp (high frequencies die first) and scale by each line's decay gain
  o.z0 += o.damp * (delay_read(o.d0, o.len0) - o.z0);
  o.z1 += o.damp * (delay_read(o.d1, o.len1) - o.z1);
  o.z2 += o.damp * (delay_read(o.d2, o.len2) - o.z2);
  o.z3 += o.damp * (delay_read(o.d3, o.len3) - o.z3);
  const a = o.z0 * o.g0;
  const b = o.z1 * o.g1;
  const c = o.z2 * o.g2;
  const d = o.z3 * o.g3;
  // orthogonal (energy preserving) Hadamard mix back into the lines
  delay_write(o.d0, x + 0.5 * (a + b + c + d));
  delay_write(o.d1, x + 0.5 * (a - b + c - d));
  delay_write(o.d2, x + 0.5 * (a + b - c - d));
  delay_write(o.d3, x + 0.5 * (a - b - c + d));
  o.l = a + c;
  o.r = b + d;
}

export function fdn4_clear(o) {
  delay_clear(o.d0);
  delay_clear(o.d1);
  delay_clear(o.d2);
  delay_clear(o.d3);
  o.z0 = o.z1 = o.z2 = o.z3 = 0;
  o.l = 0;
  o.r = 0;
}

// ---- Stereo chorus: one modulated delay per channel, the two LFOs a quarter cycle apart
// (so even a mono source comes out wide).

/** Shortest chorus delay; the LFO sweeps from here up to base + depth. */
export const CHORUS_BASE_MS = 7;
/** Longest chorus depth (the delay memory holds base + depth). */
export const CHORUS_MAX_DEPTH_MS = 8;

export function chorus_init(o, sr) {
  const n = Math.ceil((CHORUS_BASE_MS + CHORUS_MAX_DEPTH_MS + 5) * 0.001 * sr) + 4;
  o.bl = {};
  o.br = {};
  delay_init(o.bl, n);
  delay_init(o.br, n);
  o.phase = 0;
  o.l = 0;
  o.r = 0;
}

export function chorus_clear(o) {
  delay_clear(o.bl);
  delay_clear(o.br);
  o.l = 0;
  o.r = 0;
}

/** base / depth in samples, inc = LFO cycles per sample. */
export function chorus_process(o, in_l, in_r, base, depth, inc) {
  delay_write(o.bl, in_l);
  delay_write(o.br, in_r);
  o.l = delay_read(o.bl, base + depth * (0.5 + 0.5 * Math.sin(TWO_PI * o.phase)));
  o.r = delay_read(o.br, base + depth * (0.5 + 0.5 * Math.cos(TWO_PI * o.phase)));
  o.phase += inc;
  if (o.phase >= 1) o.phase -= 1;
}

// ---- Stereo echo with a one-pole high cut in the feedback loop (each repeat gets darker).
// Ping-pong: the (mono summed) input enters the left line and the repeats bounce L -> R -> L.

export function echo_init(o, size) {
  o.bl = {};
  o.br = {};
  delay_init(o.bl, size);
  delay_init(o.br, size);
  o.zl = 0;
  o.zr = 0;
  o.l = 0;
  o.r = 0;
}

export function echo_clear(o) {
  delay_clear(o.bl);
  delay_clear(o.br);
  o.zl = 0;
  o.zr = 0;
  o.l = 0;
  o.r = 0;
}

/** d = delay in samples (1 <= d < size - 1), fb = feedback, a = one-pole coefficient of the high cut. */
export function echo_process(o, in_l, in_r, d, fb, a, pingpong) {
  o.zl += a * (delay_read(o.bl, d) - o.zl);
  o.zr += a * (delay_read(o.br, d) - o.zr);
  if (pingpong) {
    delay_write(o.bl, (in_l + in_r) * 0.5 + fb * o.zr);
    delay_write(o.br, fb * o.zl);
  } else {
    delay_write(o.bl, in_l + fb * o.zl);
    delay_write(o.br, in_r + fb * o.zr);
  }
  o.l = o.zl;
  o.r = o.zr;
}

// ---- Reverb: two all-pass diffusers (smear the attack into a dense wash) into the 4-line FDN.

/** All-pass diffuser lengths in samples at 48 kHz (scaled by sample rate and size). */
export const REVERB_AP_LENS = [241, 373];
/** Largest size multiplier the reverb memory is allocated for. */
export const REVERB_MAX_SCALE = 2;
/** Wet output gain (brings the reverb roughly to the level of the dry sound). */
const REVERB_GAIN = 0.7;

export function reverb_init(o, sr) {
  o.ap1 = {};
  o.ap2 = {};
  delay_init(o.ap1, Math.ceil((REVERB_AP_LENS[0] * REVERB_MAX_SCALE * sr) / 48000) + 4);
  delay_init(o.ap2, Math.ceil((REVERB_AP_LENS[1] * REVERB_MAX_SCALE * sr) / 48000) + 4);
  o.fdn = {};
  fdn4_init(o.fdn, Math.ceil((FDN_LENS[3] * REVERB_MAX_SCALE * sr) / 48000) + 4);
  o.ap_len1 = 1;
  o.ap_len2 = 1;
  o.gain = 0;
  o.l = 0;
  o.r = 0;
}

/** scale 0.5..REVERB_MAX_SCALE (size), decay_ms to -60 dB, damp as in fdn4_set. */
export function reverb_set(o, scale, decay_ms, damp, sr) {
  o.ap_len1 = Math.max(1, Math.round((REVERB_AP_LENS[0] * scale * sr) / 48000));
  o.ap_len2 = Math.max(1, Math.round((REVERB_AP_LENS[1] * scale * sr) / 48000));
  fdn4_set(o.fdn, scale, decay_ms, damp, sr);
  // a long tail piles up more energy (~ 1 / (1 - g^2) per line): keep the wet level steady
  const f = o.fdn;
  const g2 = (f.g0 * f.g0 + f.g1 * f.g1 + f.g2 * f.g2 + f.g3 * f.g3) * 0.25;
  o.gain = REVERB_GAIN * Math.sqrt(1 - g2);
}

export function reverb_clear(o) {
  delay_clear(o.ap1);
  delay_clear(o.ap2);
  fdn4_clear(o.fdn);
  o.l = 0;
  o.r = 0;
}

export function reverb_process(o, in_l, in_r) {
  let x = (in_l + in_r) * 0.5;
  x = allpass_process(o.ap1, x, o.ap_len1, 0.6);
  x = allpass_process(o.ap2, x, o.ap_len2, 0.6);
  fdn4_process(o.fdn, x);
  o.l = o.fdn.l * o.gain;
  o.r = o.fdn.r * o.gain;
}
