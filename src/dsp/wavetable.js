// AmiSynth wavetable oscillator: procedurally generated, band-limited wavetables.
//
// No sample files: every table is computed from a formula (harmonic spectra, or a short integer
// waveform for the Digital bank), so the JSFX port can build *the same* tables in @slider.
//
// Layout (identical to the fixed memory region of the JSFX, see "AmiSynth Synth.jsfx"):
//   WT_BANKS banks x WT_FRAMES frames x WT_MIPS mip levels x WT_SIZE samples, one flat array.
//   table(bank, frame, mip) starts at ((bank * WT_FRAMES + frame) * WT_MIPS + mip) * WT_SIZE.
// Mip level m holds only harmonics 1 .. WT_MAX_HARM / 2^m (512, 256, ... 1). The oscillator picks the
// lowest level m whose top harmonic stays below Nyquist, so nothing aliases. Over the top half-octave
// of m's range it crossfades towards level m + 1 (half the harmonics, so also band-safe), reaching
// m + 1 alone exactly at the boundary: the waveform never jumps when a bend / glide crosses a level. Each table is made by one
// inverse FFT of the frame's spectrum truncated to the level's harmonics (plain radix-2 loops,
// written the same way in EEL2). Every frame is scaled so its full-band (mip 0) table peaks at 1,
// and all its mip levels share that gain (no level jump when the pitch crosses a mip boundary).
//
// Playback: linear interpolation inside a table and linearly between the two nearest frames.
// Banks are built lazily (the first time an oscillator selects them), and only once per process:
// the tables do not depend on the sample rate.

import { PI, TWO_PI } from './lib.js';

export const WT_SIZE = 2048;
export const WT_FRAMES = 8;
export const WT_MIPS = 10;
export const WT_MAX_HARM = 512;
export const WT_BANKS = 5;
/** Bank names (the order is the value of osc1_wt_bank / osc2_wt_bank). */
export const WT_BANK_NAMES = ['Basic Shapes', 'PWM Sweep', 'Vocal Formants', 'Harmonic Sweep', 'Digital'];

const BANK_LEN = WT_FRAMES * WT_MIPS * WT_SIZE;
const FRAME_LEN = WT_MIPS * WT_SIZE;

let wt_data = null; // Float64Array(WT_BANKS * BANK_LEN), allocated on the first build
const wt_ready = new Array(WT_BANKS).fill(0);

// scratch for the FFT and the spectrum of one frame
const fft_re = new Float64Array(WT_SIZE);
const fft_im = new Float64Array(WT_SIZE);
const tw_cos = new Float64Array(WT_SIZE / 2);
const tw_sin = new Float64Array(WT_SIZE / 2);
const spec_a = new Float64Array(WT_MAX_HARM + 1); // sine coefficient of harmonic k
const spec_b = new Float64Array(WT_MAX_HARM + 1); // cosine coefficient of harmonic k
let tw_ready = 0;

// Vowel formants (Hz) for the Vocal bank: a, e, i, o, u (Peterson & Barney, male voice).
const VOWELS = [
  [730, 1090, 2440],
  [530, 1840, 2480],
  [270, 2290, 3010],
  [570, 840, 2410],
  [300, 870, 2240],
];
const FORMANT_GAIN = [1, 0.6, 0.3];
const FORMANT_BW = [80, 100, 140];

/**
 * In-place radix-2 FFT of fft_re / fft_im (length WT_SIZE). sign = +1: inverse (no 1/N scaling),
 * -1: forward. Bit reversal and loops use plain arithmetic only (same code in EEL2).
 */
function wt_fft(sign) {
  const n = WT_SIZE;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let t = fft_re[i];
      fft_re[i] = fft_re[j];
      fft_re[j] = t;
      t = fft_im[i];
      fft_im[i] = fft_im[j];
      fft_im[j] = t;
    }
    let m = n / 2;
    while (m >= 1 && j >= m) {
      j -= m;
      m /= 2;
    }
    j += m;
  }
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = tw_cos[k * step];
        const wi = sign * tw_sin[k * step];
        const a = i + k;
        const b = a + half;
        const tr = fft_re[b] * wr - fft_im[b] * wi;
        const ti = fft_re[b] * wi + fft_im[b] * wr;
        fft_re[b] = fft_re[a] - tr;
        fft_im[b] = fft_im[a] - ti;
        fft_re[a] += tr;
        fft_im[a] += ti;
      }
    }
  }
}

/** Sine coefficient of harmonic k of the Basic Shapes anchors: 0 sine, 1 triangle, 2 saw, 3 square. */
function wt_basic(shape, k) {
  const odd = k - 2 * Math.floor(k / 2);
  if (shape === 0) return k === 1 ? 1 : 0;
  if (shape === 1) {
    if (!odd) return 0;
    const h = (k - 1) / 2;
    return ((h - 2 * Math.floor(h / 2) ? -8 : 8) / (PI * PI)) / (k * k);
  }
  if (shape === 2) return (odd ? 2 : -2) / (PI * k);
  return odd ? 4 / (PI * k) : 0;
}

/** Spectrum (spec_a / spec_b, harmonics 1..WT_MAX_HARM) of a frame of the analytic banks 0..3. */
function wt_spectrum(bank, frame) {
  const x = frame / (WT_FRAMES - 1); // 0..1 across the bank
  spec_a[0] = 0;
  spec_b[0] = 0;
  if (bank === 0) {
    // sine -> triangle -> saw -> square
    const p = x * 3;
    const seg = Math.min(Math.floor(p), 2);
    const w = p - seg;
    for (let k = 1; k <= WT_MAX_HARM; k++) {
      spec_a[k] = (1 - w) * wt_basic(seg, k) + w * wt_basic(seg + 1, k);
      spec_b[k] = 0;
    }
  } else if (bank === 1) {
    // pulse, duty cycle 50 % -> 5 % (DC removed)
    const duty = 0.5 - 0.45 * x;
    for (let k = 1; k <= WT_MAX_HARM; k++) {
      const g = 2 / (PI * k);
      spec_a[k] = g * (1 - Math.cos(TWO_PI * k * duty));
      spec_b[k] = g * Math.sin(TWO_PI * k * duty);
    }
  } else if (bank === 2) {
    // buzz through three formants gliding a -> e -> i -> o -> u (formants fixed for a 110 Hz voice,
    // so they follow the pitch like any wavetable); Schroeder phases keep the crest factor low
    const p = x * 4;
    const seg = Math.min(Math.floor(p), 3);
    const w = p - seg;
    for (let k = 1; k <= WT_MAX_HARM; k++) {
      const hz = k * 110;
      let g = 0.03;
      for (let i = 0; i < 3; i++) {
        const f = VOWELS[seg][i] + w * (VOWELS[seg + 1][i] - VOWELS[seg][i]);
        const d = (hz - f) / FORMANT_BW[i];
        g += FORMANT_GAIN[i] / (1 + d * d);
      }
      const amp = g / Math.pow(k, 0.7);
      const ph = (PI * k * (k - 1)) / 48;
      spec_a[k] = amp * Math.cos(ph);
      spec_b[k] = amp * Math.sin(ph);
    }
  } else {
    // a hump of harmonics sweeping up 5 octaves over the fundamental (additive scan), Schroeder phases
    const centre = 5 * x;
    for (let k = 1; k <= WT_MAX_HARM; k++) {
      const d = Math.log(k) / Math.log(2) - centre;
      const amp = (k === 1 ? 0.5 : 0) + Math.exp(-2 * d * d) / Math.sqrt(k);
      const ph = (PI * k * (k - 1)) / 48;
      spec_a[k] = amp * Math.cos(ph);
      spec_b[k] = amp * Math.sin(ph);
    }
  }
}

/** Digital bank: 8-bit integer waveforms (v = u XOR (u * mul mod 256)), as a spectrum via forward FFT. */
const DIGITAL_MUL = [0, 2, 3, 4, 5, 7, 9, 13];
function wt_digital_spectrum(frame) {
  const mul = DIGITAL_MUL[frame];
  for (let n = 0; n < WT_SIZE; n++) {
    const u = Math.floor(n / 8); // 0..255
    const um = u * mul - 256 * Math.floor((u * mul) / 256);
    fft_re[n] = ((u ^ um) / 127.5) - 1;
    fft_im[n] = 0;
  }
  wt_fft(-1);
  // x[n] = sum_k Re(Z[k] e^{+i 2 pi k n / N}) with Z[k] = 2 X[k] / N = b_k - i a_k
  spec_a[0] = 0;
  spec_b[0] = 0;
  for (let k = 1; k <= WT_MAX_HARM; k++) {
    spec_b[k] = (2 * fft_re[k]) / WT_SIZE;
    spec_a[k] = (-2 * fft_im[k]) / WT_SIZE;
  }
}

/** Render the current spectrum truncated to `harm` harmonics into wt_data at `dst`, times `gain`. */
function wt_render_table(dst, harm, gain) {
  for (let i = 0; i < WT_SIZE; i++) {
    fft_re[i] = 0;
    fft_im[i] = 0;
  }
  for (let k = 1; k <= harm; k++) {
    fft_re[k] = spec_b[k];
    fft_im[k] = -spec_a[k];
  }
  wt_fft(1);
  for (let i = 0; i < WT_SIZE; i++) wt_data[dst + i] = fft_re[i] * gain;
}

/** Build every frame and mip level of a bank (no-op when it is already built). */
export function wt_build(bank) {
  if (wt_ready[bank]) return;
  if (!wt_data) wt_data = new Float64Array(WT_BANKS * BANK_LEN);
  if (!tw_ready) {
    for (let i = 0; i < WT_SIZE / 2; i++) {
      tw_cos[i] = Math.cos((TWO_PI * i) / WT_SIZE);
      tw_sin[i] = Math.sin((TWO_PI * i) / WT_SIZE);
    }
    tw_ready = 1;
  }
  for (let f = 0; f < WT_FRAMES; f++) {
    if (bank === 4) wt_digital_spectrum(f);
    else wt_spectrum(bank, f);
    const base = bank * BANK_LEN + f * FRAME_LEN;
    // mip 0 first: its peak sets the gain of the whole frame
    wt_render_table(base, WT_MAX_HARM, 1);
    let peak = 0;
    for (let i = 0; i < WT_SIZE; i++) {
      const a = Math.abs(wt_data[base + i]);
      if (a > peak) peak = a;
    }
    const gain = peak > 0 ? 1 / peak : 0;
    for (let i = 0; i < WT_SIZE; i++) wt_data[base + i] *= gain;
    let harm = WT_MAX_HARM;
    for (let m = 1; m < WT_MIPS; m++) {
      harm /= 2;
      wt_render_table(base + m * WT_SIZE, harm, gain);
    }
  }
  wt_ready[bank] = 1;
}

/** Raw access for tests / tools: one sample of table (bank, frame, mip). */
export function wt_table_value(bank, frame, mip, i) {
  wt_build(bank);
  return wt_data[bank * BANK_LEN + frame * FRAME_LEN + mip * WT_SIZE + i];
}

/** Lowest mip level whose top harmonic (WT_MAX_HARM / 2^m) times inc (cycles per sample) stays <= 0.5. */
export function wt_mip(inc) {
  let m = 0;
  let th = 0.5 / WT_MAX_HARM;
  while (inc > th && m < WT_MIPS - 1) {
    th *= 2;
    m++;
  }
  return m;
}

/**
 * Crossfade start, as a fraction of the boundary inc of a level: the top half-octave (1 / sqrt(2)).
 * Written as a literal so the JSFX uses the bit-identical constant.
 */
export const WT_FADE = 0.7071067811865476;

/**
 * Weight (0..1) of mip level m + 1 when level m = wt_mip(inc) is playing: 0 below WT_FADE * th (th = the
 * boundary inc of level m, where wt_mip switches to m + 1), rising linearly in inc to exactly 1 at th.
 * Level m + 1 has fewer harmonics than m, so giving it weight never aliases. The last level does not fade.
 */
export function wt_mip_fade(inc, m) {
  if (m >= WT_MIPS - 1) return 0;
  let th = 0.5 / WT_MAX_HARM;
  for (let i = 0; i < m; i++) th *= 2;
  const lo = th * WT_FADE;
  return inc > lo ? (inc - lo) / (th - lo) : 0;
}

/**
 * One sample of a wavetable oscillator. o is an osc_init() object (phase / inc / wrapped, like
 * osc_process, so hard sync and FM work the same). bank 0..WT_BANKS-1 (built), pos 0..1, pm in cycles.
 */
export function wt_process(o, bank, pos, pm) {
  let t = o.phase + pm;
  t -= Math.floor(t);
  const dt = o.inc;
  const m = wt_mip(dt);
  const fp = pos * (WT_FRAMES - 1);
  let f0 = Math.floor(fp);
  if (f0 > WT_FRAMES - 2) f0 = WT_FRAMES - 2;
  const ff = fp - f0;
  const x = t * WT_SIZE;
  const i0 = Math.floor(x);
  const fr = x - i0;
  const i1 = i0 + 1 >= WT_SIZE ? 0 : i0 + 1;
  const b0 = bank * BANK_LEN + f0 * FRAME_LEN + m * WT_SIZE;
  const b1 = b0 + FRAME_LEN;
  let a = wt_data[b0 + i0] + fr * (wt_data[b0 + i1] - wt_data[b0 + i0]);
  let b = wt_data[b1 + i0] + fr * (wt_data[b1 + i1] - wt_data[b1 + i0]);
  // top half-octave of the level: blend towards the next (band-poorer) level, read only when needed
  const w = wt_mip_fade(dt, m);
  if (w > 0) {
    const c0 = b0 + WT_SIZE;
    const c1 = b1 + WT_SIZE;
    const a2 = wt_data[c0 + i0] + fr * (wt_data[c0 + i1] - wt_data[c0 + i0]);
    const b2 = wt_data[c1 + i0] + fr * (wt_data[c1 + i1] - wt_data[c1 + i0]);
    a += w * (a2 - a);
    b += w * (b2 - b);
  }
  o.phase += dt;
  o.wrapped = 0;
  if (o.phase >= 1) {
    o.phase -= 1;
    o.wrapped = 1;
  }
  return a + ff * (b - a);
}
