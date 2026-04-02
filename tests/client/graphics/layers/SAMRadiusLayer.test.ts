import { describe, expect, test, vi } from "vitest";
import { SAMRadiusLayer } from "../../../../src/client/graphics/layers/SAMRadiusLayer";
import { UnitType } from "../../../../src/core/game/Game";

function mockAirDefenseUnit(type: UnitType, level: number, tile = 42) {
  return {
    id: () => 100 + level,
    isActive: () => true,
    level: () => level,
    owner: () => ({ smallID: () => 1 }),
    tile: () => tile,
    type: () => type,
  };
}

describe("SAMRadiusLayer", () => {
  test("includes upgraded warships in air-defense ranges", () => {
    const layer = new SAMRadiusLayer(
      {
        config: () => ({
          samRange: vi.fn((level: number) => level * 10),
        }),
        units: vi.fn(() => [mockAirDefenseUnit(UnitType.Warship, 2)]),
        x: vi.fn(() => 12),
        y: vi.fn(() => 24),
      } as any,
      { on: vi.fn() } as any,
      {} as any,
    );

    const ranges = (layer as any).getAllAirDefenseRanges();

    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ x: 12, y: 24, r: 20 });
  });

  test("excludes level 1 warships from air-defense ranges", () => {
    const layer = new SAMRadiusLayer(
      {
        config: () => ({
          samRange: vi.fn((level: number) => level * 10),
        }),
        units: vi.fn(() => [mockAirDefenseUnit(UnitType.Warship, 1)]),
        x: vi.fn(() => 12),
        y: vi.fn(() => 24),
      } as any,
      { on: vi.fn() } as any,
      {} as any,
    );

    const ranges = (layer as any).getAllAirDefenseRanges();

    expect(ranges).toHaveLength(0);
  });

  test("redraws when an upgraded warship moves", () => {
    const layer = new SAMRadiusLayer(
      {
        config: () => ({
          samRange: vi.fn((level: number) => level * 10),
        }),
        units: vi.fn(() => [mockAirDefenseUnit(UnitType.Warship, 2, 42)]),
        x: vi.fn(() => 12),
        y: vi.fn(() => 24),
      } as any,
      { on: vi.fn() } as any,
      {} as any,
    );

    (layer as any).getAllAirDefenseRanges();

    expect(
      (layer as any).hasChanged(mockAirDefenseUnit(UnitType.Warship, 2, 84)),
    ).toBe(true);
  });
});
