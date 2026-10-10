// On-screen keyboard layouts.
//
// Isomorphic ("等音配列") layouts place notes on a 2D lattice where moving one
// cell in a given direction always adds the same number of scale steps, so every
// chord/scale has the same shape in every key. Intervals are given in cents and
// converted to steps of the current tuning, so the same preset works in 12-EDO,
// 19-EDO, 31-EDO, custom scales, ...

export const LAYOUTS = [
  { id: 'auto', label: '自動 (12音はピアノ)' },
  { id: 'piano', label: 'ピアノ' },
  { id: 'linear', label: '1 列 (長方形)' },
  { id: 'grid', label: '格子 (長方形・等音)' },
  { id: 'hex', label: '六角形 (等音)' },
];

const M2 = 203.91;
const m2 = 111.73;
const M3 = 386.31;
const m3 = 315.64;
const P4 = 498.04;
const P5 = 701.96;

/** Nearest number of scale steps for an interval (at least 1). */
export function stepsFor(t, cents) {
  return Math.max(1, Math.round((t.size * cents) / t.period_cents));
}

/**
 * Presets per layout. right = steps per cell to the right; up = steps per row
 * (for hex: to the upper-right neighbour; the upper-left neighbour is up - right).
 */
export const ISO_PRESETS = {
  grid: [
    { id: 'fourths', label: '4 度積み (LinnStrument / ギター風)', right: () => 1, up: (t) => stepsFor(t, P4) },
    { id: 'fifths', label: '5 度積み (バイオリン風)', right: () => 1, up: (t) => stepsFor(t, P5) },
    { id: 'thirds', label: '長 3 度積み', right: () => 1, up: (t) => stepsFor(t, M3) },
  ],
  hex: [
    { id: 'wicki', label: 'Wicki-Hayden (→全音 / ↗5度)', right: (t) => stepsFor(t, M2), up: (t) => stepsFor(t, P5) },
    { id: 'harmonic', label: 'Harmonic Table (↗長3度 / ↖短3度)', right: (t) => Math.max(1, stepsFor(t, M3) - stepsFor(t, m3)), up: (t) => stepsFor(t, M3) },
    { id: 'janko', label: 'Jankó 風 (→全音 / ↗半音)', right: (t) => stepsFor(t, M2), up: (t) => stepsFor(t, m2) },
  ],
};

/** Resolve {right, up} steps for a layout/preset (or the custom numbers). */
export function isoSteps(layout, presetId, t, custom) {
  const p = (ISO_PRESETS[layout] || []).find((x) => x.id === presetId);
  if (!p) return { right: Math.round(custom.right) || 1, up: Math.round(custom.up) || 1 };
  return { right: p.right(t), up: p.up(t) };
}

/**
 * Cells of an isomorphic layout, row 0 at the bottom, base note at bottom-left.
 * Hex uses "odd-r" offset rows (odd rows shifted right by half a cell).
 * @returns {{c:number, r:number, note:number}[]}
 */
export function isoCells({ cols, rows, base, right, up, hex }) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const q = hex ? c - (r - (r & 1)) / 2 : c; // axial column
      cells.push({ c, r, note: base + q * right + r * up });
    }
  }
  return cells;
}

/** Points of a pointy-top hexagon centred at (cx, cy) with width w. */
export function hexPoints(cx, cy, w) {
  const h = w / Math.sqrt(3); // circumradius
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(`${(cx + h * Math.cos(a)).toFixed(1)},${(cy + h * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
