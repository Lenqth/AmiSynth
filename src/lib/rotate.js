// The full-screen overlay can be rotated by CSS (data-rot = 90 / -90) so a phone held in
// portrait can be played in landscape without asking the OS to rotate. Hit testing
// (elementFromPoint) follows CSS transforms, but positions measured from
// getBoundingClientRect() are in screen axes; this maps them back to the element's own axes.

/**
 * Position of a pointer inside `el` as fractions of its own (unrotated) width / height.
 * @param {Element} el
 * @returns {{ fx: number, fy: number }}
 */
export function localFraction(el, clientX, clientY) {
  const r = el.getBoundingClientRect();
  const rot = Number(el.closest('[data-rot]')?.getAttribute('data-rot') || 0);
  if (rot === 90) {
    // element top edge is on the right of the screen, its x axis points down
    return { fx: (clientY - r.top) / r.height, fy: (r.right - clientX) / r.width };
  }
  if (rot === -90) {
    // element top edge is on the left of the screen, its x axis points up
    return { fx: (r.bottom - clientY) / r.height, fy: (clientX - r.left) / r.width };
  }
  return { fx: (clientX - r.left) / r.width, fy: (clientY - r.top) / r.height };
}
