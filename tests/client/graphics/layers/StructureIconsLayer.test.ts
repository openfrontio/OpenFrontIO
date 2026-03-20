import { describe, expect, test, vi } from "vitest";
import {
  shouldPreserveGhostAfterBuild,
  StructureIconsLayer,
} from "../../../../src/client/graphics/layers/StructureIconsLayer";
import type { TransformHandler } from "../../../../src/client/graphics/TransformHandler";
import { EventBus } from "../../../../src/core/EventBus";
import { UnitType } from "../../../../src/core/game/Game";
import type { GameView } from "../../../../src/core/game/GameView";

type MockStructureUnit = {
  id(): number;
  type(): UnitType;
  isActive(): boolean;
};

type MockGame = {
  config(): {
    theme(): object;
    userSettings(): {
      structureSprites(): boolean;
    };
  };
  units(): MockStructureUnit[];
};

type MockTransformHandler = {
  scale: number;
  worldToScreenCoordinates(cell: { x: number; y: number }): {
    x: number;
    y: number;
  };
};

type StructureIconsLayerTestInternals = {
  pixicanvas: {
    height?: number;
    removeEventListener: ReturnType<typeof vi.fn>;
    width?: number;
  };
  onWebGLContextLost: ((event: Event) => void) | null;
  onWebGLContextRestored: (() => void) | null;
  ghostUnit?: object | null;
  renderer: object | null;
  rendererInitialized: boolean;
  seenUnitIds: Set<number>;
  rendersByUnitId: Map<number, unknown>;
  iconsStage: { children: unknown[]; removeChildren(): unknown[] };
  levelsStage: { children: unknown[]; removeChildren(): unknown[] };
  dotsStage: { children: unknown[]; removeChildren(): unknown[] };
  addNewStructure(unit: { id(): number }): void;
  rebuildAllStructuresFromState(): void;
};

function createStructureIconsLayerWithMockGame(units: MockStructureUnit[]) {
  const game: MockGame = {
    config: () => ({
      theme: () => ({}),
      userSettings: () => ({ structureSprites: () => true }),
    }),
    units: () => units,
  };
  const transformHandler: MockTransformHandler = {
    scale: 1,
    worldToScreenCoordinates: (cell: { x: number; y: number }) => cell,
  };
  return new StructureIconsLayer(
    game as unknown as GameView,
    new EventBus(),
    {
      attackRatio: 20,
      ghostStructure: null,
      overlappingRailroads: [],
      ghostRailPaths: [],
      rocketDirectionUp: true,
    },
    transformHandler as unknown as TransformHandler,
  );
}

function createMockRender(destroy: ReturnType<typeof vi.fn>, unitId: number) {
  return {
    unit: {
      id() {
        return unitId;
      },
    },
    iconContainer: { destroy },
    levelContainer: { destroy },
    dotContainer: { destroy },
  };
}

function createMockStageChild() {
  return { destroy: vi.fn() };
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
    // Arrange
    const layer = createStructureIconsLayerWithMockGame([]);
    const resizeSpy = vi
      .spyOn(layer, "resizeCanvas")
      .mockImplementation(() => undefined);
    const rebuildSpy = vi
      .spyOn(layer, "rebuildAllStructuresFromState")
      .mockImplementation(() => undefined);

    // Act
    layer.redraw();

    // Assert
    expect(resizeSpy).toHaveBeenCalledOnce();
    expect(rebuildSpy).toHaveBeenCalledOnce();
  });

  test("rebuildAllStructuresFromState is a no-op before the renderer is initialized", () => {
    const layer = createStructureIconsLayerWithMockGame([
      {
        id() {
          return 101;
        },
        type() {
          return UnitType.City;
        },
        isActive() {
          return true;
        },
      },
    ]);
    const layerInternals = layer as unknown as StructureIconsLayerTestInternals;
    const addNewStructureSpy = vi.spyOn(layerInternals, "addNewStructure");

    expect(() => layer.rebuildAllStructuresFromState()).not.toThrow();
    expect(addNewStructureSpy).not.toHaveBeenCalled();
  });

  test("resizeCanvas repositions the active ghost after resizing", () => {
    const layer = createStructureIconsLayerWithMockGame([]);
    const layerInternals = layer as unknown as StructureIconsLayerTestInternals;
    const resize = vi.fn();
    const moveGhostSpy = vi
      .spyOn(
        layer as unknown as { moveGhost(event: unknown): void },
        "moveGhost",
      )
      .mockImplementation(() => undefined);

    layerInternals.renderer = { resize };
    layerInternals.ghostUnit = {};
    layerInternals.pixicanvas = {
      width: 0,
      height: 0,
      removeEventListener: vi.fn(),
    };

    layer.resizeCanvas();

    expect(resize).toHaveBeenCalledOnce();
    expect(moveGhostSpy).toHaveBeenCalledOnce();
  });

  test("rebuildAllStructuresFromState removes inactive renders and re-adds active structures", () => {
    const activeCity = {
      id() {
        return 101;
      },
      type() {
        return UnitType.City;
      },
      isActive() {
        return true;
      },
    };
    const inactiveCity = {
      id() {
        return 102;
      },
      type() {
        return UnitType.City;
      },
      isActive() {
        return false;
      },
    };
    const activeTransportShip = {
      id() {
        return 103;
      },
      type() {
        return UnitType.TransportShip;
      },
      isActive() {
        return true;
      },
    };
    const layer = createStructureIconsLayerWithMockGame([
      activeCity,
      inactiveCity,
      activeTransportShip,
    ]);
    const layerInternals = layer as unknown as StructureIconsLayerTestInternals;
    const staleRender = createMockRender(vi.fn(), 7);
    const inactiveRender = createMockRender(vi.fn(), 102);
    const iconChildA = createMockStageChild();
    const iconChildB = createMockStageChild();
    const levelChildA = createMockStageChild();
    const levelChildB = createMockStageChild();
    const dotChildA = createMockStageChild();
    const dotChildB = createMockStageChild();
    const { seenUnitIds, rendersByUnitId } = layerInternals;
    layerInternals.renderer = {};
    layerInternals.rendererInitialized = true;
    seenUnitIds.add(7);
    seenUnitIds.add(102);
    rendersByUnitId.set(7, staleRender);
    rendersByUnitId.set(102, inactiveRender);
    layerInternals.iconsStage = {
      children: [],
      removeChildren: vi.fn(() => [iconChildA, iconChildB]),
    };
    layerInternals.levelsStage = {
      children: [],
      removeChildren: vi.fn(() => [levelChildA, levelChildB]),
    };
    layerInternals.dotsStage = {
      children: [],
      removeChildren: vi.fn(() => [dotChildA, dotChildB]),
    };
    const addNewStructureSpy = vi
      .spyOn(layerInternals, "addNewStructure")
      .mockImplementation((unit: { id(): number }) => {
        seenUnitIds.add(unit.id());
        rendersByUnitId.set(unit.id(), { unit });
      });

    layerInternals.rebuildAllStructuresFromState();

    expect(iconChildA.destroy).toHaveBeenCalledWith({ children: true });
    expect(iconChildB.destroy).toHaveBeenCalledWith({ children: true });
    expect(levelChildA.destroy).toHaveBeenCalledWith({ children: true });
    expect(levelChildB.destroy).toHaveBeenCalledWith({ children: true });
    expect(dotChildA.destroy).toHaveBeenCalledWith({ children: true });
    expect(dotChildB.destroy).toHaveBeenCalledWith({ children: true });
    expect(addNewStructureSpy).toHaveBeenCalledTimes(1);
    expect(addNewStructureSpy).toHaveBeenCalledWith(activeCity);
    expect(Array.from(rendersByUnitId.keys())).toEqual([101]);
    expect(Array.from(seenUnitIds)).toEqual([101]);
  });

  test("dispose removes WebGL canvas listeners and clears handler references", () => {
    const layer = createStructureIconsLayerWithMockGame([]);
    const layerInternals = layer as unknown as StructureIconsLayerTestInternals;
    const removeEventListener = vi.fn();
    const lostHandler = vi.fn();
    const restoredHandler = vi.fn();

    layerInternals.pixicanvas = { removeEventListener };
    layerInternals.onWebGLContextLost = lostHandler;
    layerInternals.onWebGLContextRestored = restoredHandler;

    layer.dispose();

    expect(removeEventListener).toHaveBeenCalledWith(
      "webglcontextlost",
      lostHandler,
    );
    expect(removeEventListener).toHaveBeenCalledWith(
      "webglcontextrestored",
      restoredHandler,
    );
    expect(layerInternals.onWebGLContextLost).toBeNull();
    expect(layerInternals.onWebGLContextRestored).toBeNull();
  });
});
