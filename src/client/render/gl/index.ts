export type { AttackRingInput } from "../types";
// createDebugGui is intentionally not re-exported here — it pulls lil-gui and
// the debug GUI into the main bundle; dynamically import "./debug/index".

export type { GraphicsOverrides, GraphicsPresets } from "./GraphicsOverrides";
export { GLUnavailableError, showGLGate, trackGLInit } from "./initGL";
export { MapRenderer } from "./MapRenderer";
export { preloadAtlasData } from "./passes/name-pass/AtlasData";
export type { SpawnCenter } from "./passes/SpawnOverlayPass";
export { applyGraphicsOverrides } from "./RenderOverrides";
export { createRenderSettings } from "./RenderSettings";
export type { RenderSettings } from "./RenderSettings";
export { deepAssign } from "./SettingsUtils";

export { renderDpr } from "./utils/Dpr";
export { buildNukeTrajectory } from "./utils/NukeTrajectory";
export type { SAMInfo } from "./utils/NukeTrajectory";

// Re-export shared types used in the public API
export type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  RendererConfig,
  UnitState,
} from "../types";
