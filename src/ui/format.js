/** Human readable value for a param definition. */
export function formatValue(def, v) {
  if (def.options) return def.options[Math.round(v)] ?? String(v);
  const u = def.unit;
  if (u === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz`;
  if (u === 'ms' && v >= 1000) return `${(v / 1000).toFixed(2)} s`;
  if (u === 'dB') return v <= -60 ? '-inf dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  if (def.id.endsWith('_pan')) return Math.abs(v) < 0.005 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
  let digits = def.step >= 1 ? 0 : Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  if (u === 'cents' && def.step < 1 && Math.abs(v) >= 100) digits = Math.abs(v - Math.round(v)) > 1e-6 ? 2 : 0;
  const s = v.toFixed(digits);
  return u && u !== 'note' ? `${s} ${u}` : s;
}

export function toNorm(def, v) {
  if (def.scale === 'log') return Math.log(v / def.min) / Math.log(def.max / def.min);
  return (v - def.min) / (def.max - def.min);
}

export function fromNorm(def, n) {
  n = Math.min(1, Math.max(0, n));
  let v = def.scale === 'log' ? def.min * Math.pow(def.max / def.min, n) : def.min + n * (def.max - def.min);
  if (def.step >= 1) v = Math.round(v);
  else {
    const dec = Math.max(0, Math.ceil(-Math.log10(def.step)));
    v = Number(v.toFixed(dec));
  }
  return Math.min(def.max, Math.max(def.min, v));
}
