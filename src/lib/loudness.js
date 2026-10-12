// Integrated loudness (LUFS) after ITU-R BS.1770-4: K-weighting, 400 ms blocks with 75 % overlap,
// absolute gate at -70 LUFS and relative gate at -10 LU. Used for the export summary and to keep
// the built-in presets at a common level.

/** K-weighting biquads for a sample rate (pre-filter shelf + RLB high-pass), bilinear transform. */
function kWeighting(sr) {
  // high shelf: +4 dB above ~1.5 kHz
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // high-pass at ~38 Hz
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sr);
  a0 = 1 + K / Q + K * K;
  const hp = { b: [1, -2, 1], a: [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0] };
  return [shelf, hp];
}

function filter(x, { b, a }) {
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * @param {ArrayLike<number>} left @param {ArrayLike<number>} right @param {number} sr
 * @returns {number} integrated loudness in LUFS (-Infinity for silence)
 */
export function integratedLoudness(left, right, sr) {
  const [shelf, hp] = kWeighting(sr);
  const chans = [left, right].map((c) => filter(filter(c, shelf), hp));
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const powers = [];
  for (let start = 0; start + block <= left.length; start += hop) {
    let sum = 0;
    for (const c of chans) {
      let e = 0;
      for (let i = start; i < start + block; i++) e += c[i] * c[i];
      sum += e / block;
    }
    powers.push(sum);
  }
  const lufs = (p) => -0.691 + 10 * Math.log10(p);
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const abs = powers.filter((p) => lufs(p) > -70);
  if (abs.length === 0) return -Infinity;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(mean(gated));
}
