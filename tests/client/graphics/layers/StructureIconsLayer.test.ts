import { describe, expect, test, vi } from "vitest";
import {
  shouldPreserveGhostAfterBuild,
  StructureIconsLayer,
} from "../../../../src/client/graphics/layers/StructureIconsLayer";
import { UnitType } from "../../../../src/core/game/Game";
import { EventBus } from "../../../../src/core/EventBus";

type MockStructureUnit = {
  id(): number;
  type(): UnitType;
  isActive(): boolean;
};

type StructureIconsLayerTestInternals = {
  seenUnitIds: Set<number>;
  rendersByUnitId: Map<number, unknown>;
  iconsStage: { children: unknown[]; removeChildren(): unknown[] };
  levelsStage: { children: unknown[]; removeChildren(): unknown[] };
  dotsStage: { children: unknown[]; removeChildren(): unknown[] };
  addNewStructure(unit: { id(): number }): void;
  rebuildAllStructuresFromState(reason?: string): unknown;
};

function createStructureIconsLayerWithMockGame(units: MockStructureUnit[]) {
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
    const layer = createStructureIconsLayerWithMockGame([]);
    const resizeSpy = vi
      .spyOn(layer, "resizeCanvas")
      .mockImplementation(() => undefined);
    const rebuildSpy = vi
      .spyOn(layer, "rebuildAllStructuresFromState")
      .mockReturnValue({
        rendererInitialized: false,
        rendersByUnitIdSize: 0,
        seenUnitIdsSize: 0,
        dotsStageChildren: 0,
        iconsStageChildren: 0,
        levelsStageChildren: 0,
        ghostStageChildren: 0,
        canvasWidth: 0,
        canvasHeight: 0,
      });

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
    const layer = createStructureIconsLayerWithMockGame([
      activeCity,
      inactiveCity,
      activeTransportShip,
    ]);
    const layerInternals = layer as unknown as StructureIconsLayerTestInternals;
    const staleDestroy = vi.fn();
    const staleRender = {
      unit: { id: () => 7 },
      iconContainer: { destroy: staleDestroy },
      levelContainer: { destroy: staleDestroy },
      dotContainer: { destroy: staleDestroy },
    };
    const { seenUnitIds, rendersByUnitId } = layerInternals;
    seenUnitIds.add(7);
    rendersByUnitId.set(7, staleRender);
    layerInternals.iconsStage = {
      children: [],
      removeChildren: vi.fn(() => []),
    };
    layerInternals.levelsStage = {
      children: [],
      removeChildren: vi.fn(() => []),
    };
    layerInternals.dotsStage = { children: [], removeChildren: vi.fn(() => []) };
    const addNewStructureSpy = vi
      .spyOn(layerInternals, "addNewStructure")
      .mockImplementation((unit: { id(): number }) => {
        seenUnitIds.add(unit.id());
        rendersByUnitId.set(unit.id(), { unit });
      });

    layerInternals.rebuildAllStructuresFromState("test");

    expect(staleDestroy).toHaveBeenCalledTimes(3);
    expect(addNewStructureSpy).toHaveBeenCalledTimes(1);
    expect(addNewStructureSpy).toHaveBeenCalledWith(activeCity);
    expect(Array.from(rendersByUnitId.keys())).toEqual([101]);
    expect(Array.from(seenUnitIds)).toEqual([101]);
  });
});
