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

export const DRUM_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG'];

export function isTypingTarget(el) {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
