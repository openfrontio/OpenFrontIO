import {
  CustomGameMap,
  GameMapSize,
  GameMapType,
} from "@openfront/engine-api/game/GameTypes";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { FetchGameMapLoader } from "@openfront/shared/FetchGameMapLoader";
import { describe, expect, test, vi } from "vitest";

describe("FetchGameMapLoader", () => {
  test("resolves each map file through the provided path resolver", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.BritanniaClassic);

    expect(mapData.webpPath).toBe(
      "/_assets/maps/britanniaclassic/thumbnail.webp.hashed",
    );

    await mapData.manifest();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/britanniaclassic/manifest.json.hashed",
    );
  });

  test("loads the WebP layer, and the 4x variant for compact games", async () => {
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      blob: async () => new Blob(),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const bitmap = {} as ImageBitmap;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );

    const loader = new FetchGameMapLoader("/maps");
    const mapData = loader.getMapData(GameMapType.China);

    await expect(mapData.layerImage("label", false)).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenLastCalledWith("/maps/china/label.webp");

    await expect(mapData.layerImage("label", true)).resolves.toBe(bitmap);
    expect(fetchMock).toHaveBeenLastCalledWith("/maps/china/label.4x.webp");
  });

  test("never fetches a Custom map: it has none until a scenario is set", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader("/maps");

    expect(() => loader.getMapData(CustomGameMap)).toThrow(
      "no scenario is loaded",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("answers for the Custom map from a scenario's files, a copy each load", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const meta = { width: 4, height: 4, num_land_tiles: 0 };
    const files: MapFiles = {
      map: CustomGameMap,
      mapSize: GameMapSize.Normal,
      manifest: {
        id: "Scenario",
        name: "Scenario",
        translation_key: "map.scenario",
        categories: ["fictional"],
        nations: [],
        map: meta,
        map4x: meta,
        map16x: meta,
      },
      mapBin: new Uint8Array([1, 2, 3]),
      map4xBin: new Uint8Array([4]),
    };

    const loader = new FetchGameMapLoader("/maps");
    loader.setCustomMap(files, "blob:thumbnail");
    const mapData = loader.getMapData(CustomGameMap);

    expect(mapData.webpPath).toBe("blob:thumbnail");
    const mapBin = await mapData.mapBin();
    expect(mapBin).toEqual(files.mapBin);
    expect(mapBin.buffer).not.toBe(files.mapBin!.buffer);
    expect(await mapData.manifest()).toEqual(files.manifest);
    expect(await mapData.manifest()).not.toBe(files.manifest);
    await expect(mapData.map16xBin()).rejects.toThrow(
      "the scenario lacks a map file",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
