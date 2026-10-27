import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import { MouseUpEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";

describe("BuildPreviewController ghost preservation (locked nuke / Enter confirm)", () => {
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
});

describe("samThreatensNukePreview (nuke trajectory threat set, #4226)", () => {
  const teammates = new Set([7, 8]);
  const allies = new Set([2, 3]);

  test("non-friendly SAM threatens the trajectory", () => {
    expect(samThreatensNukePreview(5, teammates, allies, new Set())).toBe(true);
  });

  test("allied SAM does not threaten when the strike breaks no alliance", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set())).toBe(
      false,
    );
  });

  test("would-be-betrayed ally's SAM threatens (alliance breaks at launch)", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set([2]))).toBe(
      true,
    );
  });

  test("other allies' SAMs still excluded when a different ally is betrayed", () => {
    expect(samThreatensNukePreview(3, teammates, allies, new Set([2]))).toBe(
      false,
    );
  });

  test("teammate SAM does not threaten the trajectory", () => {
    expect(samThreatensNukePreview(7, teammates, new Set(), new Set())).toBe(
      false,
    );
  });

  test("teammate SAM stays excluded even if listed as betrayed (a strike never breaks a team)", () => {
    expect(
      samThreatensNukePreview(7, teammates, new Set([7]), new Set([7])),
    ).toBe(false);
  });
});

describe("BuildPreviewController confirm with the pointer off the map", () => {
  function makeController(worldX: number, worldY: number, snap = false) {
    const width = 10;
    const height = 10;
    const game = {
      isImpassable: () => false,
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < width && y < height,
      ref: (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) {
          throw new Error(`Invalid coordinates: ${x},${y}`);
        }
        return y * width + x;
      },
      myPlayer: () => ({ gold: () => 100n, smallID: () => 1 }),
      x: (t: number) => t % width,
      y: (t: number) => Math.floor(t / width),
    };
    const transformHandler = {
      screenToWorldCoordinates: () => ({ x: worldX, y: worldY }),
    };
    const userSettings = {
      nukeAllianceSafetyDuration: () => 0,
      cursorCostLabel: () => false,
      snapBuildPreview: () => snap,
    };
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    vi.spyOn(eventBus, "emit").mockImplementation((e) => {
      emitted.push(e);
    });
    const controller = new BuildPreviewController(
      game as any,
      eventBus,
      { ghostStructure: UnitType.City } as any,
      transformHandler as any,
      { updateGhostPreview: () => {}, updateNukeTrajectory: () => {} } as any,
      userSettings as any,
    );
    (controller as any).ghostUnit = {
      buildableUnit: { type: UnitType.City, canBuild: 1, canUpgrade: false },
    };
    (controller as any).ghostResolved = true;
    (controller as any).resolvedGhostTile = worldY * width + worldX;
    return { controller, emitted };
  }

  test.each([UnitType.City, UnitType.Port, UnitType.Warship])(
    "snapped preview for %s",
    (type) => {
      const { controller } = makeController(3, 4, true);
      const buildable = (controller as any).ghostUnit.buildableUnit;
      Object.assign(buildable, { type, canBuild: 0, cost: 1n });
      const data = (controller as any).buildGhostPreviewData(43, false);
      const position = type === UnitType.Warship ? [3, 4] : [0, 0];
      expect([data.tileX, data.tileY]).toEqual(position);
      expect([data.radiusTileX, data.radiusTileY]).toEqual(position);
      expect(data.snapToPlacement).toBe(type !== UnitType.Warship);
    },
  );

  test("preview stays under the cursor when snapping is off", () => {
    const { controller } = makeController(3, 4);
    const buildable = (controller as any).ghostUnit.buildableUnit;
    Object.assign(buildable, { type: UnitType.City, canBuild: 0, cost: 1n });
    const data = (controller as any).buildGhostPreviewData(43, false);
    expect([data.tileX, data.tileY]).toEqual([3, 4]);
    expect([data.radiusTileX, data.radiusTileY]).toEqual([3, 4]);
    expect(data.snapToPlacement).toBe(false);
  });

  test.each([false, true])(
    "rail preview follows effective build mode (held: %s)",
    (held) => {
      const { controller } = makeController(3, 4);
      const c = controller as any;
      c.game.unit = () => ({ tile: () => 21 });
      c.uiState.preventStacking = held;
      const rails = {
        ghostRailPaths: [[1, 2, 3]],
        overlappingRailroads: [4, 5],
      };
      Object.assign(c.ghostUnit.buildableUnit, rails, {
        canUpgrade: 7,
        cost: 1n,
      });
      const preview = c.buildGhostPreviewData(43, false);
      expect(preview.ghostRailPaths).toEqual(held ? rails.ghostRailPaths : []);
      expect(preview.overlappingRailroads).toEqual(
        held ? rails.overlappingRailroads : [],
      );
      expect(preview.canUpgrade).toBe(!held);
      expect(c.ghostUnit.buildableUnit.canUpgrade).toBe(7);
    },
  );

  test("a click on an invalid held preview keeps the tool and queues no build", () => {
    const { controller, emitted } = makeController(3, 4);
    const c = controller as any;
    c.uiState.preventStacking = true;
    c.ghostResolved = true;
    Object.assign(c.ghostUnit.buildableUnit, {
      canBuild: false,
      canUpgrade: 7,
    });
    expect(c.isGhostReadyForConfirm()).toBe(false);
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(emitted).toEqual([]);
    expect(c.uiState.ghostStructure).toBe(UnitType.City);
    expect(c.ghostUnit).not.toBeNull();
    expect(c.pendingConfirm).toBeNull();
    c.createStructure(43);
    expect(c.ghostUnit).not.toBeNull();
    c.uiState.preventStacking = false;
    expect(c.isGhostReadyForConfirm()).toBe(true);
  });

  test("valid spawn tile zero builds while upgrading is prevented", () => {
    const { controller, emitted } = makeController(0, 0);
    const c = controller as any;
    c.uiState.preventStacking = true;
    Object.assign(c.ghostUnit.buildableUnit, { canBuild: 0, canUpgrade: 7 });
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(emitted[0]).toBeInstanceOf(BuildUnitIntentEvent);
    expect((emitted[0] as BuildUnitIntentEvent).tile).toBe(0);
  });

  test("held placement uses the single-build cost rather than bulk upgrades", () => {
    const { controller } = makeController(3, 4);
    const c = controller as any;
    c.uiState.preventStacking = true;
    c.uiState.upgradeMultiplier = 5;
    Object.assign(c.ghostUnit.buildableUnit, {
      canUpgrade: 7,
      cost: 2n,
      upgradeCosts: [20n],
    });
    const preview = c.buildGhostPreviewData(43, false);
    expect(preview.cost).toBe(2);
    expect(preview.multiplier).toBe(1);
  });

  test("a pending initial click on a subsequently invalid held preview keeps the tool", async () => {
    const { controller, emitted } = makeController(3, 4);
    const c = controller as any;
    c.uiState.preventStacking = true;
    c.ghostResolved = false;
    Object.assign(c.ghostUnit.buildableUnit, {
      canBuild: false,
      canUpgrade: false,
    });
    const buildables = vi
      .fn()
      .mockResolvedValue([
        { type: UnitType.City, canBuild: false, canUpgrade: 7 },
      ]);
    c.game.myPlayer = () => ({ buildables });
    c.game.isImpassable = () => false;
    vi.spyOn(c, "emitGhostPreview").mockImplementation(() => {});
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(c.pendingConfirm).not.toBeNull();
    c.lastGhostQueryAt = -Infinity;
    c.renderGhost();
    await Promise.resolve();
    expect(c.pendingConfirm).toBeNull();
    expect(c.uiState.ghostStructure).toBe(UnitType.City);
    expect(c.ghostUnit).not.toBeNull();
    expect(emitted).toEqual([]);
  });

  test("a click on a new tile waits for that tile even if the pointer or camera moves", async () => {
    const { controller, emitted } = makeController(3, 4);
    const c = controller as any;
    const pending: ((units: unknown[]) => void)[] = [];
    const buildables = vi.fn(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    c.game.myPlayer = () => ({ buildables });
    const coordinates = vi.fn().mockReturnValue({ x: 3, y: 4 });
    c.transformHandler.screenToWorldCoordinates = coordinates;
    vi.spyOn(c, "emitGhostPreview").mockImplementation(() => {});
    c.ghostUnit.buildableUnit.canBuild = false;
    c.lastGhostQueryAt = -Infinity;
    c.renderGhost(); // The old hover query is still in flight for tile 43.
    coordinates.mockReturnValue({ x: 5, y: 4 });
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(c.pendingConfirm).toEqual({ tile: 45, preventStacking: false });
    expect(emitted).toEqual([]);
    coordinates.mockReturnValue({ x: 8, y: 8 }); // Move away before either reply.
    pending[0]([{ type: UnitType.City, canBuild: false, canUpgrade: false }]);
    await Promise.resolve();
    expect(buildables).toHaveBeenLastCalledWith(45, [UnitType.City], false);
    expect(emitted).toEqual([]);
    pending[1]([{ type: UnitType.City, canBuild: 45, canUpgrade: false }]);
    await Promise.resolve();
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as BuildUnitIntentEvent).tile).toBe(45);
    expect(c.pendingConfirm).toBeNull();
  });

  test.each([false, true])(
    "a queued click keeps its hold mode after key release (held: %s)",
    async (held) => {
      const { controller, emitted } = makeController(3, 4);
      const c = controller as any;
      let reply: (units: unknown[]) => void = () => {};
      c.game.myPlayer = () => ({
        buildables: () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      });
      c.uiState.preventStacking = held;
      c.ghostResolved = false;
      vi.spyOn(c, "emitGhostPreview").mockImplementation(() => {});
      c.requestConfirmStructure(new MouseUpEvent(0, 0));
      c.uiState.preventStacking = !held;
      reply([{ type: UnitType.City, canBuild: 43, canUpgrade: 7 }]);
      await Promise.resolve();
      expect(emitted).toHaveLength(1);
      expect(emitted[0] instanceof BuildUnitIntentEvent).toBe(held);
    },
  );

  test("a hold change during a hover request immediately requeries rail metadata", async () => {
    const { controller } = makeController(3, 4);
    const c = controller as any;
    let reply: (units: unknown[]) => void = () => {};
    const fresh = {
      type: UnitType.City,
      canBuild: 43,
      canUpgrade: 7,
      ghostRailPaths: [[43, 44]],
    };
    const buildables = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            reply = resolve;
          }),
      )
      .mockResolvedValue([fresh]);
    c.game.myPlayer = () => ({ buildables });
    vi.spyOn(c, "emitGhostPreview").mockImplementation(() => {});
    c.renderGhost();
    c.uiState.preventStacking = true;
    reply([
      { type: UnitType.City, canBuild: 43, canUpgrade: 7, ghostRailPaths: [] },
    ]);
    await Promise.resolve();
    expect(buildables).toHaveBeenNthCalledWith(1, 43, [UnitType.City], false);
    expect(buildables).toHaveBeenNthCalledWith(2, 43, [UnitType.City], true);
    await Promise.resolve();
    expect(c.ghostUnit.buildableUnit.ghostRailPaths).toEqual([[43, 44]]);
  });

  test("canceling a queued click before the worker replies cannot build", async () => {
    const { controller, emitted } = makeController(3, 4);
    const c = controller as any;
    let reply: (units: unknown[]) => void = () => {};
    const buildables = vi.fn(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    c.game.myPlayer = () => ({ buildables });
    c.ghostResolved = false;
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    c.uiState.ghostStructure = null; // Escape arrives before the next tick.
    reply([{ type: UnitType.City, canBuild: 43, canUpgrade: false }]);
    await Promise.resolve();
    expect(c.ghostUnit).toBeNull();
    expect(c.pendingConfirm).toBeNull();
    expect(emitted).toEqual([]);
  });

  test("renderGhost requests rails without flooding a slow worker or reviving canceled ghosts", async () => {
    const { controller } = makeController(3, 4);
    const c = controller as any;
    const pending: ((units: unknown[]) => void)[] = [];
    const buildables = vi.fn(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    c.game.myPlayer = () => ({
      gold: () => 100n,
      smallID: () => 1,
      buildables,
    });
    c.game.isImpassable = () => false;
    c.uiState.preventStacking = true;
    const preview = vi
      .spyOn(c, "emitGhostPreview")
      .mockImplementation(() => {});
    c.lastGhostQueryAt = -Infinity;
    c.renderGhost();
    expect(buildables).toHaveBeenLastCalledWith(43, [UnitType.City], true);
    c.lastGhostQueryAt = -Infinity;
    c.renderGhost();
    expect(buildables).toHaveBeenCalledTimes(1);
    pending[0]([{ type: UnitType.City, canBuild: 2, canUpgrade: 7 }]);
    await Promise.resolve();
    expect(c.ghostUnit.buildableUnit.canBuild).toBe(2);
    expect(preview).toHaveBeenCalledTimes(1);
    c.uiState.preventStacking = false;
    c.lastGhostQueryAt = -Infinity;
    c.renderGhost();
    expect(buildables).toHaveBeenLastCalledWith(43, [UnitType.City], false);
    c.clearGhostStructure();
    c.createGhostStructure(UnitType.Factory);
    pending[1]([{ type: UnitType.City, canBuild: 3, canUpgrade: 7 }]);
    await Promise.resolve();
    expect(c.ghostUnit.buildableUnit.type).toBe(UnitType.Factory);
    expect(c.ghostResolved).toBe(false);
    expect(preview).toHaveBeenCalledTimes(1);
  });

  test("does not throw or emit a build intent when released off the map edge", () => {
    const { controller, emitted } = makeController(-1, 4);
    expect(() =>
      (controller as any).requestConfirmStructure(new MouseUpEvent(0, 0)),
    ).not.toThrow();
    expect(emitted.some((e) => e instanceof BuildUnitIntentEvent)).toBe(false);
  });

  test("emits a build intent when released on the map", () => {
    const { controller, emitted } = makeController(3, 4);
    (controller as any).requestConfirmStructure(new MouseUpEvent(0, 0));
    const intent = emitted.find((e) => e instanceof BuildUnitIntentEvent) as
      | BuildUnitIntentEvent
      | undefined;
    expect(intent?.tile).toBe(43);
  });
  test.each([true, false])("prevent stacking held: %s", (held) => {
    const { controller, emitted } = makeController(3, 4);
    const c = controller as any;
    c.uiState.preventStacking = held;
    c.ghostUnit.buildableUnit.canUpgrade = 7;
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(emitted[0] instanceof BuildUnitIntentEvent).toBe(held);
  });
});
