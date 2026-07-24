import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import type { MapLayer } from "../src/core/game/TerrainMapLoader";
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
  });
});
