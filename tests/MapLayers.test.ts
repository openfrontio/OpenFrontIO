import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import { GameMapSize, GameMapType } from "../src/core/game/Game";
import type { GameMapLoader, MapData } from "../src/core/game/GameMapLoader";
import {
  loadTerrainMap,
  type MapLayer,
} from "../src/core/game/TerrainMapLoader";
import { validateLayer } from "./util/layerValidation";

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
    test("valid id is accepted", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "forests", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors).toHaveLength(0);
    });

    test("hyphenated id is accepted", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "dense-forests", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors).toHaveLength(0);
    });

    test("numeric id is accepted", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "123", placement: "water" },
        0,
        "test",
        seen,
      );
      expect(errors).toHaveLength(0);
    });

    test("id with spaces is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "my layer", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("alphanumeric");
    });

    test("id with underscores is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "layer_id", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    test("id with dots is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "layer.id", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    test("empty id is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("must not be empty"))).toBe(true);
    });

    test("reserved id 'image' is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "image", placement: "land" },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("reserved"))).toBe(true);
    });

    test("duplicate id is rejected", () => {
      const seen = new Set<string>();
      seen.add("forests");
      const errors = validateLayer(
        { id: "forests", placement: "land" },
        1,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    test("invalid placement 'air' is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "clouds", placement: "air" },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("must be"))).toBe(true);
    });

    test("valid placements 'land' and 'water' are accepted", () => {
      const seen1 = new Set<string>();
      expect(
        validateLayer({ id: "a", placement: "land" }, 0, "test", seen1),
      ).toHaveLength(0);
      const seen2 = new Set<string>();
      expect(
        validateLayer({ id: "b", placement: "water" }, 0, "test", seen2),
      ).toHaveLength(0);
    });

    test("valid alpha value is accepted", () => {
      const seen = new Set<string>();
      expect(
        validateLayer(
          { id: "a", placement: "land", alpha: 0.5 },
          0,
          "test",
          seen,
        ),
      ).toHaveLength(0);
    });

    test("alpha boundary values are accepted", () => {
      const seen1 = new Set<string>();
      expect(
        validateLayer(
          { id: "a", placement: "land", alpha: 0 },
          0,
          "test",
          seen1,
        ),
      ).toHaveLength(0);
      const seen2 = new Set<string>();
      expect(
        validateLayer(
          { id: "b", placement: "land", alpha: 1 },
          0,
          "test",
          seen2,
        ),
      ).toHaveLength(0);
    });

    test("negative alpha is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "a", placement: "land", alpha: -0.1 },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("between 0 and 1"))).toBe(true);
    });

    test("alpha greater than 1 is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "a", placement: "land", alpha: 1.5 },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("between 0 and 1"))).toBe(true);
    });

    test("non-numeric alpha is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "a", placement: "land", alpha: "0.5" },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("must be a finite number"))).toBe(
        true,
      );
    });

    test("NaN alpha is rejected", () => {
      const seen = new Set<string>();
      const errors = validateLayer(
        { id: "a", placement: "land", alpha: NaN },
        0,
        "test",
        seen,
      );
      expect(errors.some((e) => e.includes("must be a finite number"))).toBe(
        true,
      );
    });

    test("undefined alpha is accepted", () => {
      const seen = new Set<string>();
      expect(
        validateLayer({ id: "a", placement: "land" }, 0, "test", seen),
      ).toHaveLength(0);
    });
  });

  describe("loadTerrainMap alpha validation", () => {
    function makeLoader(
      layers: MapLayer[],
      width = 2,
      height = 2,
    ): GameMapLoader {
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
      const mapData: MapData = {
        mapBin: () => Promise.resolve(bin),
        map4xBin: () => Promise.resolve(bin),
        map16xBin: () => Promise.resolve(bin),
        manifest: () => Promise.resolve(manifest as never),
        webpPath: "",
        layerPng: () =>
          Promise.resolve(new ImageData(1, 1) as unknown as ImageBitmap),
      };
      return {
        getMapData: () => mapData,
      };
    }

    test("throws on alpha below 0", async () => {
      const loader = makeLoader([
        { id: "bad", placement: "land", alpha: -0.5 },
      ]);
      await expect(
        loadTerrainMap(GameMapType.World, GameMapSize.Normal, loader, false),
      ).rejects.toThrow("invalid alpha");
    });

    test("throws on alpha above 1", async () => {
      const loader = makeLoader([{ id: "bad", placement: "land", alpha: 1.5 }]);
      await expect(
        loadTerrainMap(GameMapType.World, GameMapSize.Normal, loader, false),
      ).rejects.toThrow("invalid alpha");
    });

    test("throws on NaN alpha", async () => {
      const loader = makeLoader([{ id: "bad", placement: "land", alpha: NaN }]);
      await expect(
        loadTerrainMap(GameMapType.World, GameMapSize.Normal, loader, false),
      ).rejects.toThrow("invalid alpha");
    });

    test("accepts valid alpha values", async () => {
      const loader = makeLoader([
        { id: "good", placement: "land", alpha: 0 },
        { id: "good2", placement: "water", alpha: 0.7 },
        { id: "good3", placement: "land", alpha: 1 },
      ]);
      const data = await loadTerrainMap(
        GameMapType.World,
        GameMapSize.Normal,
        loader,
        false,
      );
      expect(data.layers).toHaveLength(3);
    });

    test("accepts layers without alpha (undefined)", async () => {
      const loader = makeLoader([{ id: "noalpha", placement: "land" }]);
      const data = await loadTerrainMap(
        GameMapType.Europe,
        GameMapSize.Normal,
        loader,
        false,
      );
      expect(data.layers).toHaveLength(1);
    });
  });
});
