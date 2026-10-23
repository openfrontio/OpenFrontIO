import { beforeEach, describe, expect, it } from "vitest";

import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { MapLayer } from "@openfront/engine-api/game/MapFiles";
import type { TerrainMapData } from "@openfront/engine-lib/game/TerrainMapLoader";
import type { GameMapLoader } from "@openfront/shared/GameMapLoader";
import { MapLayerController } from "../../src/client/controllers/MapLayerController";
import type { MapRenderer } from "../../src/client/render/gl";
import { MAP_LAYERS_KEY, UserSettings } from "../../src/client/UserSettings";

const LAYERS: MapLayer[] = [
  { id: "forest", placement: "land", nukeable: true, alpha: 0.8 },
  { id: "reef", placement: "water" },
];

/** Start the controller on a map with LAYERS and record what it tells the renderer. */
async function startGame() {
  const visibility: [string, boolean][] = [];
  const alphas: [string, number][] = [];
  const view = {
    setMapLayers: () => {},
    setLayerVisible: (id: string, visible: boolean) =>
      visibility.push([id, visible]),
    setLayerAlpha: (id: string, alpha: number) => alphas.push([id, alpha]),
  } as unknown as MapRenderer;
  const loader = {
    getMapData: () => ({ layerImage: async () => ({}) as ImageBitmap }),
  } as unknown as GameMapLoader;
  new MapLayerController(
    view,
    { layers: LAYERS } as TerrainMapData,
    new UserSettings(),
    GameMapType.Ommatrypta,
    GameMapSize.Normal,
    loader,
    new AbortController().signal,
  ).init();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { visibility, alphas };
}

describe("MapLayerController", () => {
  beforeEach(() => {
    localStorage.clear();
    const settings = new UserSettings();
    settings.setGraphicsOverrides({});
    settings.removeCached(MAP_LAYERS_KEY);
  });

  it("applies each layer's stored state once the images load", async () => {
    new UserSettings().setGraphicsOverrides({
      mapLayerVisibility: { forest: false },
      mapLayerAlpha: { reef: 0.3 },
    });

    const { visibility, alphas } = await startGame();

    expect(visibility).toEqual([
      ["forest", false],
      ["reef", true],
    ]);
    expect(alphas).toEqual([
      ["forest", 0.8],
      ["reef", 0.3],
    ]);
  });

  it("starts with every layer hidden when the Map Layers switch is off", async () => {
    new UserSettings().toggleMapLayers();

    const { visibility } = await startGame();

    expect(visibility).toEqual([
      ["forest", false],
      ["reef", false],
    ]);
  });
});
