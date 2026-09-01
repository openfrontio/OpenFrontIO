/**
 * MapLayerController — loads map-layer images (off the critical path) and
 * applies initial visibility from user settings.
 *
 * The renderer tolerates missing layers (warn + skip) until images arrive,
 * so the game starts without blocking on layer PNGs.
 */

import { GameMapSize, GameMapType } from "../../core/game/Game";
import { GameMapLoader } from "../../core/game/GameMapLoader";
import {
  loadLayerImages,
  TerrainMapData,
} from "../../core/game/TerrainMapLoader";
import { UserSettings } from "../../core/game/UserSettings";
import { Controller } from "../Controller";
import { MapRenderer } from "../render/gl";

export class MapLayerController implements Controller {
  constructor(
    private readonly view: MapRenderer,
    private readonly gameMap: TerrainMapData,
    private readonly userSettings: UserSettings,
    private readonly gameMapType: GameMapType,
    private readonly gameMapSize: GameMapSize,
    private readonly mapLoader: GameMapLoader,
    private readonly abortSignal: AbortSignal,
  ) {}

  init() {
    if (!this.gameMap.layers?.length) return;

    if (this.gameMap.layerImages) {
      // Images already loaded (e.g. from cache) — set up immediately.
      this.view.setMapLayers(this.gameMap.layers, this.gameMap.layerImages);
      this.applyVisibility();
      this.applyAlpha();
    } else {
      // Layer images loaded off the critical path. Start fetching now;
      // the renderer tolerates missing layers (warn + skip) until they
      // arrive.
      loadLayerImages(
        this.gameMapType,
        this.gameMapSize,
        this.mapLoader,
        this.gameMap.layers,
      )
        .then((images) => {
          if (!this.abortSignal.aborted) {
            this.view.setMapLayers(this.gameMap.layers!, images);
            this.applyVisibility();
            this.applyAlpha();
          }
        })
        .catch((e) =>
          console.warn("[MapLayerController] Failed to load layer images:", e),
        );
    }
  }

  private applyVisibility() {
    const overrides = this.userSettings.graphicsOverrides();
    if (!overrides.mapLayerVisibility || !this.gameMap.layers) return;
    for (const layer of this.gameMap.layers) {
      const vis = overrides.mapLayerVisibility[layer.id];
      if (vis !== undefined) {
        this.view.setLayerVisible(layer.id, vis);
      }
    }
  }

  private applyAlpha() {
    const overrides = this.userSettings.graphicsOverrides();
    if (!this.gameMap.layers) return;
    for (const layer of this.gameMap.layers) {
      const alpha = overrides.mapLayerAlpha?.[layer.id];
      if (alpha !== undefined) {
        this.view.setLayerAlpha(layer.id, alpha);
      } else if (layer.alpha !== undefined) {
        // Apply manifest default when no user override exists.
        this.view.setLayerAlpha(layer.id, layer.alpha);
      }
    }
  }
}
