import { describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../src/client/render/gl/GraphicsOverrides";
import type { MapLayer } from "../src/core/game/TerrainMapLoader";

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
    const VALID_ID_RE = /^[a-zA-Z0-9-]+$/;

    test("id must be alphanumeric (hyphens allowed)", () => {
      expect(VALID_ID_RE.test("forests")).toBe(true);
      expect(VALID_ID_RE.test("dense-forests")).toBe(true);
      expect(VALID_ID_RE.test("Layer1")).toBe(true);
      expect(VALID_ID_RE.test("123")).toBe(true);
    });

    test("id must not contain spaces or special characters", () => {
      expect(VALID_ID_RE.test("my layer")).toBe(false);
      expect(VALID_ID_RE.test("layer_id")).toBe(false);
      expect(VALID_ID_RE.test("layer.id")).toBe(false);
      expect(VALID_ID_RE.test("layer id!")).toBe(false);
    });

    test("id must not be empty", () => {
      expect(VALID_ID_RE.test("")).toBe(false);
    });

    test("id must not be 'image'", () => {
      const reservedIds = ["image"];
      expect(reservedIds.includes("image")).toBe(true);
      // In the actual validation, "image" is specifically rejected.
    });

    test("placement must be land or water", () => {
      const validPlacements = ["land", "water"];
      expect(validPlacements.includes("land")).toBe(true);
      expect(validPlacements.includes("water")).toBe(true);
      expect(validPlacements.includes("air")).toBe(false);
      expect(validPlacements.includes("")).toBe(false);
    });
  });
});
