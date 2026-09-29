import type { CosmeticPreviewConfig } from "./CosmeticPreviewRenderer";

// How a new preview config is applied to a renderer already showing `prev`:
//  - "reframe": a different scene (mode, unit or structure level) — restart
//    the animation and re-frame the camera, as for a new preview.
//  - "replay": the same scene, but the animation itself changed (an
//    explosion's shape, the salvo) — restart it, keep the camera.
//  - "inPlace": only colours or timings changed — apply them to what is
//    already playing, and keep the camera.
// The store opens a fresh renderer per preview, so it only ever sees
// "reframe". Hosts that reuse one renderer (the cosmetic-preview package:
// the dashboard's effects editor and review pages) get live edits instead of
// a restart on every change.
export type PreviewUpdateKind = "inPlace" | "replay" | "reframe";

export function previewUpdateKind(
  prev: CosmeticPreviewConfig | null,
  next: CosmeticPreviewConfig,
): PreviewUpdateKind {
  if (
    !prev ||
    prev.mode !== next.mode ||
    prev.cosmeticUnitType !== next.cosmeticUnitType ||
    prev.structureLevel !== next.structureLevel
  ) {
    return "reframe";
  }
  if (
    Boolean(prev.salvoMode) !== Boolean(next.salvoMode) ||
    JSON.stringify(prev.explosionParams ?? null) !==
      JSON.stringify(next.explosionParams ?? null)
  ) {
    return "replay";
  }
  return "inPlace";
}
