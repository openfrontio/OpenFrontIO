import { describe, expect, test, vi } from "vitest";
import {
  shouldPreserveGhostAfterBuild,
  StructureIconsLayer,
} from "../../../../src/client/graphics/layers/StructureIconsLayer";
import { UnitType } from "../../../../src/core/game/Game";
import { EventBus } from "../../../../src/core/EventBus";

function createLayerWithMockGame(units: Array<{ id(): number; type(): UnitType; isActive(): boolean }>) {
  const game = {
    config: () => ({
      theme: () => ({}),
      userSettings: () => ({ structureSprites: () => true }),
    }),
    units: () => units,
  };
  const transformHandler = {
    scale: 1,
    worldToScreenCoordinates: (cell: { x: number; y: number }) => cell,
  };
  return new StructureIconsLayer(
    game as never,
    new EventBus(),
    {
      attackRatio: 20,
      ghostStructure: null,
      overlappingRailroads: [],
      ghostRailPaths: [],
      rocketDirectionUp: true,
    },
    transformHandler as never,
  );
}

/**
 * Tests for StructureIconsLayer edge cases mentioned in comments:
 * - Locked nuke / AtomBomb / HydrogenBomb: when confirming placement (Enter or key),
 *   the ghost is preserved so the user can place multiple nukes or keep the nuke
 *   selected. Other structure types clear the ghost after placement.
 */
describe("StructureIconsLayer ghost preservation (locked nuke / Enter confirm)", () => {
  describe("shouldPreserveGhostAfterBuild", () => {
    test("returns true for AtomBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.AtomBomb)).toBe(true);
    });

    test("returns true for HydrogenBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.HydrogenBomb)).toBe(true);
    });

    test("returns false for City so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.City)).toBe(false);
    });

    test("returns false for Factory so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Factory)).toBe(false);
    });

    test("returns false for other buildable types (Port, DefensePost, MissileSilo, SAMLauncher, Warship, MIRV)", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Port)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.DefensePost)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MissileSilo)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.SAMLauncher)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.Warship)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MIRV)).toBe(false);
    });
  });

  test("redraw resizes the canvas and rebuilds structures from authoritative state", () => {
    const layer = createLayerWithMockGame([]);
    const resizeSpy = vi
      .spyOn(layer, "resizeCanvas")
      .mockImplementation(() => undefined);
    const rebuildSpy = vi
      .spyOn(layer, "rebuildAllStructuresFromState")
      .mockReturnValue({} as ReturnType<StructureIconsLayer["captureDebugState"]>);

    layer.redraw();

    expect(resizeSpy).toHaveBeenCalledOnce();
    expect(rebuildSpy).toHaveBeenCalledWith("redraw");
  });

  test("rebuildAllStructuresFromState drops stale tracked renders and re-adds active structures from game state", () => {
    const activeCity = {
      id: () => 101,
      type: () => UnitType.City,
      isActive: () => true,
    };
    const inactiveCity = {
      id: () => 102,
      type: () => UnitType.City,
      isActive: () => false,
    };
    const activeTransportShip = {
      id: () => 103,
      type: () => UnitType.TransportShip,
      isActive: () => true,
    };
    const layer = createLayerWithMockGame([
      activeCity,
      inactiveCity,
      activeTransportShip,
    ]);
    const staleDestroy = vi.fn();
    const staleRender = {
      unit: { id: () => 7 },
      iconContainer: { destroy: staleDestroy },
      levelContainer: { destroy: staleDestroy },
      dotContainer: { destroy: staleDestroy },
    };
    const seenUnitIds = (layer as any).seenUnitIds as Set<number>;
    const rendersByUnitId = (layer as any).rendersByUnitId as Map<number, unknown>;
    seenUnitIds.add(7);
    rendersByUnitId.set(7, staleRender);
    (layer as any).iconsStage = { children: [], removeChildren: vi.fn(() => []) };
    (layer as any).levelsStage = { children: [], removeChildren: vi.fn(() => []) };
    (layer as any).dotsStage = { children: [], removeChildren: vi.fn(() => []) };
    const addNewStructureSpy = vi
      .spyOn(layer as any, "addNewStructure")
      .mockImplementation((unit: { id(): number }) => {
        seenUnitIds.add(unit.id());
        rendersByUnitId.set(unit.id(), { unit });
      });

    layer.rebuildAllStructuresFromState("test");

    expect(staleDestroy).toHaveBeenCalledTimes(3);
    expect(addNewStructureSpy).toHaveBeenCalledTimes(1);
    expect(addNewStructureSpy).toHaveBeenCalledWith(activeCity);
    expect(Array.from(rendersByUnitId.keys())).toEqual([101]);
    expect(Array.from(seenUnitIds)).toEqual([101]);
  });
});
