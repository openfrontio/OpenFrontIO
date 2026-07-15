export type { AttackRingInput } from "../types";
// createDebugGui is intentionally not re-exported here — it pulls lil-gui and
// the debug GUI into the main bundle; dynamically import "./debug/index".
export { GraphicsOverridesSchema } from "./GraphicsOverrides";
export type { GraphicsOverrides } from "./GraphicsOverrides";
export { GLUnavailableError, showGLGate, trackGLInit } from "./initGL";
export { MapRenderer } from "./MapRenderer";
export { preloadAtlasData } from "./passes/name-pass/AtlasData";
export type { SpawnCenter } from "./passes/SpawnOverlayPass";
export { applyGraphicsOverrides } from "./RenderOverrides";
export { createRenderSettings, dumpSettings } from "./RenderSettings";
export type { RenderSettings } from "./RenderSettings";
export { deepAssign, deepDiff } from "./SettingsUtils";
export {
  MAX_TRAIL_COLORS,
  buildTerrainRGBA,
  getPaletteSize,
} from "./utils/ColorUtils";
export { renderDpr } from "./utils/Dpr";
export { buildNukeTrajectory, samRange } from "./utils/NukeTrajectory";
export type { SAMInfo } from "./utils/NukeTrajectory";

// Re-export shared types used in the public API
export type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  RendererConfig,
  UnitState,
} from "../types";
