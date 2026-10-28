/**
 * MapLayerController — loads map-layer images (off the critical path) and
 * applies initial visibility from user settings.
 *
 * The renderer tolerates missing layers (warn + skip) until images arrive,
 * so the game starts without blocking on layer images.
 */

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import { MapLayer } from "@openfront/engine-api/game/MapFiles";
import { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import { GameMapLoader } from "@openfront/shared/GameMapLoader";
import { Controller } from "../Controller";
import { pushMapLayerState } from "../MapLayerSettings";
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
          pushMapLayerState(
            this.userSettings,
            this.gameMap.layers!,
            (id, visible) => this.view.setLayerVisible(id, visible),
            (id, alpha) => this.view.setLayerAlpha(id, alpha),
          );
        }
      })
      .catch((e) =>
        console.warn("[MapLayerController] Failed to load layer images:", e),
      );
  }
}

/**
 * Load the layer images for a map that already has layer definitions.
 * Compact games load the map4x-sized variant, matching the grid they draw on.
 */
export async function loadLayerImages(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
  layers: MapLayer[],
): Promise<Map<string, ImageBitmap>> {
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const compact = mapSize === GameMapSize.Compact;
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    layers.map(async (layer) => {
      try {
        images.set(layer.id, await mapFiles.layerImage(layer.id, compact));
      } catch (e) {
        console.warn(
          `[MapLoader] Failed to load layer "${layer.id}" for map ${map}: ${e}`,
        );
      }
    }),
  );
  return images;
}
