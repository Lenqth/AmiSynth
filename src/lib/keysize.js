// On-screen key sizing.
//
// Browsers do not expose the physical screen size, but CSS pixels are defined
// (and calibrated by OS/browser zoom) to be roughly constant in physical size.
// Touch guidelines (Apple 44pt, Material 48dp) put a comfortable finger target
// at ~44 CSS px (~9 mm); with a mouse ~34 px still reads as a real keyboard. We pick the minimum key
// width from the primary pointer type, multiply by the user's size setting, and
// show only as many keys as fit at that width.

export const TOUCH_MIN_KEY_PX = 44;
export const MOUSE_MIN_KEY_PX = 34;
/** Upper bound so wide screens get bigger keys instead of 7 tiny octaves. */
export const MAX_WIDE_KEYS = 29;

export function coarsePointerQuery() {
  return typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;
}

/** Minimum white-key (or step button) width in CSS px. */
export function minKeyWidth(coarse, scale) {
  return (coarse ? TOUCH_MIN_KEY_PX : MOUSE_MIN_KEY_PX) * scale;
}

/**
 * Notes to display starting at baseNote so that keys are at least minWidth wide.
 * @param {(n:number)=>boolean} isBlack  piano layout: black keys do not take width
 */
export function fitNotes(baseNote, width, minWidth, isBlack, minKeys = 5, maxKeys = MAX_WIDE_KEYS) {
  const slots = Math.min(maxKeys, Math.max(minKeys, Math.floor(width / minWidth)));
  const notes = [];
  let wide = 0;
  for (let n = baseNote; n <= 127; n++) {
    const black = isBlack(n);
    if (!black && wide === slots) break;
    notes.push(n);
    if (!black) wide++;
  }
  // never end on a black key that would hang off the right edge
  while (notes.length > 1 && isBlack(notes[notes.length - 1])) notes.pop();
  return notes;
}
