// Cap the effective devicePixelRatio used for the WebGL drawing buffer and
// any pixel-aware HUD math. Above 1.5×, low-end integrated GPU compositors
// (notably older Chromebooks) can't swap the drawing buffer within a vsync
// interval and frame pacing collapses. All callers must agree on this value
// or camera ↔ screen coordinate math will desync.
const MAX_RENDER_DPR = 1.5;

// BISECT: sub-native render scale to test whether fill rate is the bottleneck
// on low-end Chromebooks. 0.5 = 1/4 the pixels. Visibly softer.
const RENDER_SCALE = 0.5;

export function getEffectiveDpr(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_RENDER_DPR) * RENDER_SCALE;
}
