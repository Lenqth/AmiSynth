/**
 * Svelte action for playable surfaces (keys, pads, wheels, knobs, piano roll).
 * Cancelling touchstart/touchmove (non-passive) stops the browser from treating
 * multi-finger touches as scroll/zoom/system gestures (e.g. three-finger gestures on
 * tablets), which would otherwise send pointercancel and cut held notes.
 * Pointer events still fire, so the components keep using onpointer* handlers.
 */
export function playable(node) {
  const block = (e) => {
    if (e.cancelable) e.preventDefault();
  };
  node.addEventListener('touchstart', block, { passive: false });
  node.addEventListener('touchmove', block, { passive: false });
  return {
    destroy() {
      node.removeEventListener('touchstart', block);
      node.removeEventListener('touchmove', block);
    },
  };
}
