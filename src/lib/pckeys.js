// PC keyboard -> step offset (physical key codes, so JIS/US layouts both work).
// Lower row starts at the base note, upper row one period higher.
const LOWER = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM', 'Comma', 'KeyL', 'Period', 'Semicolon', 'Slash'];
const UPPER = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI', 'Digit9', 'KeyO', 'Digit0', 'KeyP'];

/** @returns {number | null} step offset from the base note */
export function codeToOffset(code, periodSize) {
  let i = LOWER.indexOf(code);
  if (i >= 0) return i;
  i = UPPER.indexOf(code);
  if (i >= 0) return periodSize + i;
  return null;
}

/** Inverse mapping for key labels. */
export function offsetToKeyLabel(offset, periodSize) {
  const short = (c) => c.replace(/^Key|^Digit/, '').replace('Comma', ',').replace('Period', '.').replace('Semicolon', ';').replace('Slash', '/');
  const upper = offset - periodSize;
  if (upper >= 0 && upper < UPPER.length) return short(UPPER[upper]);
  if (offset >= 0 && offset < LOWER.length) return short(LOWER[offset]);
  return '';
}

/** Drum pads in DRUM_PARTS order (Drums tab only). */
export const DRUM_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'KeyZ', 'KeyX', 'KeyC', 'KeyV',
  'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash', 'KeyQ', 'KeyW', 'KeyE', 'KeyR'];

// Fallback for environments that leave KeyboardEvent.code empty (some remote desktops,
// VMs, IMEs): map the produced character back to the physical key of a US/JIS layout.
const KEY_TO_CODE = {
  ',': 'Comma', '.': 'Period', ';': 'Semicolon', '/': 'Slash', '[': 'BracketLeft', ']': 'BracketRight', ' ': 'Space',
  '<': 'Comma', '>': 'Period', '+': 'Semicolon', '?': 'Slash',
  '"': 'Digit2', '#': 'Digit3', '%': 'Digit5', '&': 'Digit6', "'": 'Digit7', ')': 'Digit9',
};

/** Physical key code of a keyboard event, or null if it cannot be determined. */
export function eventCode(e) {
  if (e.code && e.code !== 'Unidentified') return e.code;
  const k = typeof e.key === 'string' ? e.key : '';
  if (/^[a-z]$/i.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return KEY_TO_CODE[k] ?? null;
}

/** True when an IME (e.g. Japanese hiragana mode) swallowed the key. */
export function isImeEvent(e) {
  return e.isComposing || e.key === 'Process' || e.keyCode === 229;
}

export function isTypingTarget(el) {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

// ---------------------------------------------------------------------------
// Isomorphic (grid / hex) layouts: the PC keyboard's own staggered rows are used as
// the lattice. Physical key centres in key widths, relative to Z (US/JIS share them):
//   digits row starts 1.25 left of Z's row, Q row 0.75 left, A row 0.5 left.
// [ and ] stay reserved for period shifting.
const ISO_ROWS = [
  { r: 0, x0: 0, codes: ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'] },
  { r: 1, x0: -0.5, codes: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'] },
  { r: 2, x0: -0.75, codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'] },
  { r: 3, x0: -1.25, codes: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'] },
];

/**
 * Lattice position of a key: q = column along the row direction, r = row (Z row = 0).
 * hex: rows are sheared by half a key per row (axial coordinates of the on-screen hex grid);
 * grid: straight columns.
 * @returns {{q:number, r:number} | null}
 */
export function isoKeyCell(code, hex) {
  for (const row of ISO_ROWS) {
    const i = row.codes.indexOf(code);
    if (i < 0) continue;
    const x = row.x0 + i;
    return { q: Math.floor((hex ? x - 0.5 * row.r : x) + 0.5), r: row.r };
  }
  return null;
}

/** label for the key at lattice position (q, r), or '' */
export function isoKeyLabel(q, r, hex) {
  for (const row of ISO_ROWS) {
    if (row.r !== r) continue;
    for (const code of row.codes) {
      const cell = isoKeyCell(code, hex);
      if (cell.q === q) return code.replace(/^Key|^Digit/, '').replace('Comma', ',').replace('Period', '.').replace('Semicolon', ';').replace('Slash', '/').replace('Quote', "'").replace('Minus', '-').replace('Equal', '=');
    }
  }
  return '';
}
