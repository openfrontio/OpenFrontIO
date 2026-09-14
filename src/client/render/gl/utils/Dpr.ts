/**
 * Device-pixel-ratio used by the WebGL renderer for its backing store and all
 * screen↔world math. Capped at 2 to avoid rendering at 3x on very high-DPI
 * (mobile) displays, which costs ~9x the fragment work of 1x for a marginal
 * visual gain over 2x.
 *
 * Every renderer call site that previously read `window.devicePixelRatio`
 * must go through this so the canvas size, camera math, and text scaling stay
 * on the same coordinate system.
 */
export function renderDpr(): number {
  return Math.min(window.devicePixelRatio || 2, 2);
}
