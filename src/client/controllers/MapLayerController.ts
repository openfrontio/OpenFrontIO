/**
 * MapLayerController — loads map-layer images (off the critical path) and
 * applies initial visibility from user settings.
 *
 * The renderer tolerates missing layers (warn + skip) until images arrive,
 * so the game starts without blocking on layer PNGs.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import { GameMapLoader } from "@openfront/shared/GameMapLoader";
import { Controller } from "../Controller";
import { MapRenderer } from "../render/gl";
import { UserSettings } from "../UserSettings";

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

/**
 * Load layer PNG images for a map that already has layer definitions.
 * For Compact maps, downsample to map4x dimensions to match the game map.
 */
async function loadLayerImages(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
  layers: MapLayer[],
): Promise<Map<string, ImageBitmap>> {
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();
  const images = new Map<string, ImageBitmap>();
  const compactW =
    mapSize === GameMapSize.Compact ? manifest.map4x.width : undefined;
  const compactH =
    mapSize === GameMapSize.Compact ? manifest.map4x.height : undefined;
  await Promise.all(
    layers.map(async (layer) => {
      try {
        let img = await mapFiles.layerPng(layer.id);
        if (compactW !== undefined && compactH !== undefined) {
          img = await createImageBitmap(img, {
            resizeWidth: compactW,
            resizeHeight: compactH,
            resizeQuality: "high",
          });
        }
        images.set(layer.id, img);
      } catch (e) {
        console.warn(
          `[MapLoader] Failed to load layer "${layer.id}" for map ${map}: ${e}`,
        );
      }
    }),
  );
  return images;
}
