import { GameMapSize, GameMapType } from "@openfront/engine-api/game/GameTypes";
import type { MapFiles, MapLayer } from "@openfront/engine-api/game/MapFiles";
import { MapInfoSchema } from "@openfront/engine-api/game/MapManifest";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import type { GameMapLoader, MapData } from "@openfront/shared/GameMapLoader";
import { describe, expect, test, vi } from "vitest";
import { loadLayerImages } from "../src/client/controllers/MapLayerController";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";

describe("Map layer feature", () => {
  describe("GraphicsOverridesSchema", () => {
    test("accepts mapLayerVisibility overrides", () => {
      const cases = [
        { mapLayerVisibility: {} },
        { mapLayerVisibility: { forests: true } },
        { mapLayerVisibility: { forests: false } },
        { mapLayerVisibility: { forests: true, deserts: false } },
      ];
      for (const c of cases) {
        expect(GraphicsOverridesSchema.safeParse(c).success).toBe(true);
      }
    });

    test("rejects invalid mapLayerVisibility value types", () => {
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerVisibility: { forests: "yes" },
        }).success,
      ).toBe(false);
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerVisibility: { forests: 1 },
        }).success,
      ).toBe(false);
    });

    test("accepts mapLayerAlpha overrides", () => {
      const cases = [
        { mapLayerAlpha: {} },
        { mapLayerAlpha: { forests: 0.7 } },
        { mapLayerAlpha: { forests: 0, deserts: 1 } },
        { mapLayerAlpha: { rivers: 0.5, coasts: 0.3 } },
      ];
      for (const c of cases) {
        expect(GraphicsOverridesSchema.safeParse(c).success).toBe(true);
      }
    });

    test("rejects out-of-range mapLayerAlpha values", () => {
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerAlpha: { forests: -0.1 },
        }).success,
      ).toBe(false);
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerAlpha: { forests: 1.1 },
        }).success,
      ).toBe(false);
    });

    test("rejects invalid mapLayerAlpha value types", () => {
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerAlpha: { forests: "0.7" },
        }).success,
      ).toBe(false);
      expect(
        GraphicsOverridesSchema.safeParse({
          mapLayerAlpha: { forests: true },
        }).success,
      ).toBe(false);
    });
  });

  describe("MapLayer type", () => {
    test("layer with all fields", () => {
      const layer: MapLayer = {
        id: "forests",
        placement: "land",
        nukeable: true,
      };
      expect(layer.id).toBe("forests");
      expect(layer.placement).toBe("land");
      expect(layer.nukeable).toBe(true);
    });

    test("layer without nukeable defaults to undefined", () => {
      const layer: MapLayer = {
        id: "deserts",
        placement: "water",
      };
      expect(layer.nukeable).toBeUndefined();
    });

    test("layer with alpha stores the value", () => {
      const layer: MapLayer = {
        id: "rivers",
        placement: "water",
        alpha: 0.6,
      };
      expect(layer.alpha).toBe(0.6);
    });

    test("layer without alpha defaults to undefined", () => {
      const layer: MapLayer = {
        id: "deserts",
        placement: "water",
      };
      expect(layer.alpha).toBeUndefined();
    });

    test("placement must be land or water", () => {
      const landLayer: MapLayer = { id: "a", placement: "land" };
      const waterLayer: MapLayer = { id: "b", placement: "water" };
      expect(landLayer.placement).toBe("land");
      expect(waterLayer.placement).toBe("water");
    });
  });

  describe("Layer validation rules", () => {
    const layers = (...entries: unknown[]) =>
      MapInfoSchema.safeParse({
        id: "Test",
        name: "Test",
        translation_key: "map.test",
        categories: ["arcade"],
        nations: [],
        layers: entries,
      });
    const errorsOf = (...entries: unknown[]) =>
      layers(...entries).error?.issues.map((i) => i.message) ?? [];

    test.each([
      { id: "forests", placement: "land" },
      { id: "dense-forests", placement: "land" },
      { id: "123", placement: "water" },
      { id: "a", placement: "land", alpha: 0.5 },
      { id: "a", placement: "land", alpha: 0 },
      { id: "a", placement: "land", alpha: 1 },
    ])("accepts %j", (layer) => {
      expect(errorsOf(layer)).toEqual([]);
    });

    test.each([
      [{ id: "my layer", placement: "land" }, "Invalid string"],
      [{ id: "layer_id", placement: "land" }, "Invalid string"],
      [{ id: "layer.id", placement: "land" }, "Invalid string"],
      [{ id: "", placement: "land" }, "Invalid string"],
      [{ id: "image", placement: "land" }, "reserved"],
      [{ id: "clouds", placement: "air" }, "Invalid option"],
      [{ id: "a", placement: "land", alpha: -0.1 }, "Too small"],
      [{ id: "a", placement: "land", alpha: 1.5 }, "Too big"],
      [{ id: "a", placement: "land", alpha: "0.5" }, "Invalid input"],
      [{ id: "a", placement: "land", alpha: NaN }, "Invalid input"],
      [{ id: "a", placement: "land", nukeable: "yes" }, "Invalid input"],
      [{ id: "a", placement: "land", opacity: 1 }, "Unrecognized key"],
    ])("rejects %j", (layer, message) => {
      expect(errorsOf(layer).join("\n")).toContain(message);
    });

    test("rejects duplicate ids", () => {
      expect(
        errorsOf(
          { id: "forests", placement: "land" },
          { id: "forests", placement: "water" },
        ),
      ).toContain("layer ids must be unique");
    });
  });

  describe("loadLayerImages", () => {
    const layers: MapLayer[] = [
      { id: "forests", placement: "land" },
      { id: "rivers", placement: "water" },
    ];

    function stubLoader(
      layerImage: MapData["layerImage"],
    ): GameMapLoader & { layerImage: typeof layerImage } {
      return {
        layerImage,
        getMapData: () => ({ layerImage }) as unknown as MapData,
      };
    }

    test("Normal games load the full-size variant", async () => {
      const loader = stubLoader(
        vi.fn(async (id: string) => ({ id }) as unknown as ImageBitmap),
      );
      const images = await loadLayerImages(
        GameMapType.China,
        GameMapSize.Normal,
        loader,
        layers,
      );
      expect(loader.layerImage).toHaveBeenCalledWith("forests", false);
      expect(loader.layerImage).toHaveBeenCalledWith("rivers", false);
      expect([...images.keys()]).toEqual(["forests", "rivers"]);
    });

    test("Compact games load the map4x variant instead of resizing", async () => {
      const loader = stubLoader(
        vi.fn(async (id: string) => ({ id }) as unknown as ImageBitmap),
      );
      const images = await loadLayerImages(
        GameMapType.China,
        GameMapSize.Compact,
        loader,
        layers,
      );
      expect(loader.layerImage).toHaveBeenCalledWith("forests", true);
      expect(loader.layerImage).toHaveBeenCalledWith("rivers", true);
      expect(images.size).toBe(2);
    });

    test("a layer that fails to load is skipped, the rest still load", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const loader = stubLoader(async (id: string) => {
        if (id === "forests") throw new Error("404");
        return { id } as unknown as ImageBitmap;
      });
      const images = await loadLayerImages(
        GameMapType.China,
        GameMapSize.Normal,
        loader,
        layers,
      );
      expect([...images.keys()]).toEqual(["rivers"]);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load layer "forests"'),
      );
      warn.mockRestore();
    });
  });

  describe("loadTerrainMap alpha validation", () => {
    function makeFiles(
      layers: MapLayer[],
      map = GameMapType.World,
      width = 2,
      height = 2,
    ): MapFiles {
      const bin = new Uint8Array(width * height);
      // Set one tile as land (bit 7 = 1).
      bin[0] = 0x80;
      const manifest = {
        name: "test",
        map: { width, height, num_land_tiles: 1 },
        map4x: { width, height, num_land_tiles: 1 },
        map16x: { width, height, num_land_tiles: 1 },
        nations: [],
        layers,
      };
      return {
        map,
        mapSize: GameMapSize.Normal,
        manifest: manifest as never,
        mapBin: bin,
        map4xBin: bin.slice(),
      };
    }

    test("throws on alpha below 0", async () => {
      const files = makeFiles([{ id: "bad", placement: "land", alpha: -0.5 }]);
      await expect(loadTerrainMap(files)).rejects.toThrow("invalid alpha");
    });

    test("throws on alpha above 1", async () => {
      const files = makeFiles([{ id: "bad", placement: "land", alpha: 1.5 }]);
      await expect(loadTerrainMap(files)).rejects.toThrow("invalid alpha");
    });

    test("throws on NaN alpha", async () => {
      const files = makeFiles([{ id: "bad", placement: "land", alpha: NaN }]);
      await expect(loadTerrainMap(files)).rejects.toThrow("invalid alpha");
    });

    test("accepts valid alpha values", async () => {
      const files = makeFiles([
        { id: "good", placement: "land", alpha: 0 },
        { id: "good2", placement: "water", alpha: 0.7 },
        { id: "good3", placement: "land", alpha: 1 },
      ]);
      const data = await loadTerrainMap(files);
      expect(data.layers).toHaveLength(3);
    });

    test("accepts layers without alpha (undefined)", async () => {
      const files = makeFiles(
        [{ id: "noalpha", placement: "land" }],
        GameMapType.Europe,
      );
      const data = await loadTerrainMap(files);
      expect(data.layers).toHaveLength(1);
    });
  });
});
