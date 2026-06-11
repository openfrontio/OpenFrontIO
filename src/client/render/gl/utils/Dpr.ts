import type { RenderSettings } from "../RenderSettings";

/**
 * Effective device pixel ratio: the native devicePixelRatio scaled by the
 * `display.dprScale` render setting (lower = cheaper rendering, higher =
 * supersampling). Everything that converts between CSS pixels and canvas
 * pixels must use this so the camera, hit-testing, and screen-anchored
 * sprites stay consistent.
 */
export function getDpr(settings: RenderSettings): number {
  return (window.devicePixelRatio || 1) * (settings.display?.dprScale ?? 1);
}
