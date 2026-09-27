import type { MapLayer } from "../core/game/TerrainMapLoader";
import type { GraphicsOverrides } from "./render/gl";

/**
 * Map-layer visibility and opacity, read out of the stored graphics overrides.
 *
 * These two are the only graphics settings the renderer does not re-read from
 * the settings object on a change: `ClientGameRunner` re-resolves everything
 * else onto the live render settings, but layer state is pushed imperatively
 * through `setLayerVisible` / `setLayerAlpha`. So whoever writes them has to
 * push them, and that includes a wholesale write — a preset or an import —
 * that the player never aimed at a layer at all.
 */

/** Layers are visible unless an override says otherwise. */
export function isLayerVisible(
  overrides: GraphicsOverrides,
  layerId: string,
): boolean {
  return overrides.mapLayerVisibility?.[layerId] ?? true;
}

/** The player's opacity for a layer, else the map manifest's, else opaque. */
export function layerAlpha(
  overrides: GraphicsOverrides,
  layerId: string,
  manifestDefault?: number,
): number {
  return overrides.mapLayerAlpha?.[layerId] ?? manifestDefault ?? 1;
}

/**
 * Push every layer's stored state to the renderer.
 *
 * Idempotent and cheap — both callbacks just set a flag on a pass — so it is
 * safe to run on any graphics change rather than trying to work out which
 * changes could have touched a layer.
 */
export function pushMapLayerState(
  overrides: GraphicsOverrides,
  mapLayers: readonly MapLayer[],
  onVisibility: ((layerId: string, visible: boolean) => void) | null,
  onAlpha: ((layerId: string, alpha: number) => void) | null,
): void {
  for (const layer of mapLayers) {
    onVisibility?.(layer.id, isLayerVisible(overrides, layer.id));
  }
  for (const layer of mapLayers) {
    onAlpha?.(layer.id, layerAlpha(overrides, layer.id, layer.alpha));
  }
}
