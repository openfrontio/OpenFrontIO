import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import {
  ConfirmGhostStructureEvent,
  MouseMoveEvent,
  MouseUpEvent,
  TouchGhostPlacementEvent,
} from "../../../src/client/InputHandler";
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
    expect(c.pendingConfirmations).toHaveLength(0);
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

  test("a pending confirmation on an invalid held tile keeps the tool", async () => {
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
    c.requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(c.pendingConfirmations).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(c.pendingConfirmations).toHaveLength(0);
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
    expect(c.pendingConfirmations).toHaveLength(1);
    expect(c.pendingConfirmations[0]).toEqual({
      tile: 45,
      ghostType: UnitType.City,
      preventStacking: false,
      ghostGeneration: c.ghostGeneration,
    });
    expect(buildables).toHaveBeenNthCalledWith(1, 43, [UnitType.City], false);
    expect(buildables).toHaveBeenNthCalledWith(2, 45, [UnitType.City], false);
    expect(emitted).toEqual([]);
    coordinates.mockReturnValue({ x: 8, y: 8 }); // Move away before either reply.
    pending[0]([{ type: UnitType.City, canBuild: false, canUpgrade: false }]);
    await Promise.resolve();
    expect(emitted).toEqual([]);
    pending[1]([{ type: UnitType.City, canBuild: 45, canUpgrade: false }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emitted).toHaveLength(1);
    expect((emitted[0] as BuildUnitIntentEvent).tile).toBe(45);
    expect(c.pendingConfirmations).toHaveLength(0);
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

  test("clearing the ghost before confirmation validation cannot build", async () => {
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
    expect(c.pendingConfirmations).toHaveLength(0);
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

describe("BuildPreviewController idle diffing optimization", () => {
  function createTestFixture(initialWorldX = 5, initialWorldY = 5) {
    let currentX = initialWorldX;
    let currentY = initialWorldY;

    const mockSilos: any[] = [];
    const mockSams: any[] = [];
    const mockPlayers: any[] = [];
    let playerGold = 100n;

    const mockMyPlayer = {
      gold: () => playerGold,
      smallID: () => 1,
      readyMissileCount: () => 5,
      units: (type: UnitType) => {
        if (type === UnitType.MissileSilo) return mockSilos;
        return [];
      },
      allies: () => [],
      isOnSameTeam: () => false,
    };

    const game = {
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < 20 && y < 20,
      ref: (x: number, y: number) => y * 20 + x,
      x: (t: number) => t % 20,
      y: (t: number) => Math.floor(t / 20),
      height: () => 20,
      isImpassable: (_tile: number) => false,
      myPlayer: () => mockMyPlayer,
      players: () => mockPlayers,
      units: (type: UnitType) => {
        if (type === UnitType.SAMLauncher) return mockSams;
        if (type === UnitType.MissileSilo) return mockSilos;
        return [];
      },
      config: () => ({
        samRange: (_lvl: number) => 10,
        nukeMagnitudes: (_type: UnitType) => ({ inner: 5, outer: 10 }),
        nukeAllianceBreakThreshold: () => 100,
        trainStationMaxRange: () => 10,
        defensePostRange: () => 10,
      }),
    };

    const transformHandler = {
      screenToWorldCoordinates: () => ({
        x: Math.floor(currentX),
        y: Math.floor(currentY),
      }),
      screenToWorldCoordinatesFloat: () => ({ x: currentX, y: currentY }),
    };

    const updateGhostPreview = vi.fn();
    const updateNukeTrajectory = vi.fn();
    const view = {
      updateGhostPreview,
      updateNukeTrajectory,
    };

    const uiState: any = {
      ghostStructure: UnitType.AtomBomb,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };

    const userSettings: any = {
      nukeAllianceSafetyDuration: () => 0,
      cursorCostLabel: () => true,
      snapBuildPreview: () => false,
    };

    const eventBus = new EventBus();
    const controller = new BuildPreviewController(
      game as any,
      eventBus,
      uiState,
      transformHandler as any,
      view as any,
      userSettings,
    );

    (controller as any).ghostUnit = {
      buildableUnit: {
        type: UnitType.AtomBomb,
        canBuild: 100,
        canUpgrade: false,
        cost: 10n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };

    return {
      controller,
      view,
      updateGhostPreview,
      updateNukeTrajectory,
      mockSilos,
      mockSams,
      mockMyPlayer,
      setPlayerGold: (g: bigint) => {
        playerGold = g;
      },
      setCoords: (x: number, y: number) => {
        currentX = x;
        currentY = y;
      },
      stepFrame: () => {
        (controller as any).cursorLoop();
      },
    };
  }

  test("buildGhostPreviewData preserves object reference when underlying data matches", () => {
    const { controller, setPlayerGold } = createTestFixture();

    const data1 = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = data1;

    // Second call with identical data should return exact same object reference
    const data2 = (controller as any).buildGhostPreviewData(100, false);
    expect(data2).toBe(data1);

    // Call after state change (gold dropped below cost) should return new object reference
    setPlayerGold(5n);
    const data3 = (controller as any).buildGhostPreviewData(100, false);
    expect(data3).not.toBe(data1);
    expect(data3.canAfford).toBe(false);
  });

  test("hovering over water does not set ghost preview to null", () => {
    const { controller } = createTestFixture();
    // In OpenFront, water is a valid tile where isImpassable is false
    const waterTile = 100;
    const data = (controller as any).buildGhostPreviewData(waterTile, false);
    expect(data).not.toBeNull();
    expect(data.tileX).toBe(0);
    expect(data.tileY).toBe(5);
  });

  test("updateNukeTrajectoryPreview performs O(N) search and preserves reference when inputs match", () => {
    const { controller, mockSilos, mockSams } = createTestFixture();

    // Setup candidate silos:
    // Silo 0: active, at tile 0 (x=0, y=0). Distance to target tile 100 (x=0, y=5) is 5.
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });
    // Silo 1: active, at tile 19 (x=19, y=0). Distance is 19 + 5 = 24.
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 19,
    });
    // Silo 2: at tile 100 (dist 0), but in cooldown -> must be ignored!
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => true,
      isUnderConstruction: () => false,
      tile: () => 100,
    });
    // Silo 3: at tile 100 (dist 0), but inactive -> must be ignored!
    mockSilos.push({
      isActive: () => false,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 100,
    });

    (controller as any).updateNukeTrajectoryPreview(100);
    const traj1 = (controller as any).nukeTrajectoryStatic;
    expect(traj1).not.toBeNull();
    expect(traj1.srcX).toBe(0);
    expect(traj1.srcY).toBe(0);
    expect(traj1.sams).toHaveLength(0);

    // Call again with same target tile -> reference preserved!
    (controller as any).updateNukeTrajectoryPreview(100);
    const traj2 = (controller as any).nukeTrajectoryStatic;
    expect(traj2).toBe(traj1);

    // Call with different target tile -> new reference!
    (controller as any).updateNukeTrajectoryPreview(101);
    const traj3 = (controller as any).nukeTrajectoryStatic;
    expect(traj3).not.toBe(traj1);
    expect(traj3.targetTile).toBe(101);

    // Add a threatening SAM launcher
    mockSams.push({
      isActive: () => true,
      owner: () => ({ smallID: () => 99 }),
      tile: () => 50,
      level: () => 1,
    });
    (controller as any).updateNukeTrajectoryPreview(101);
    const traj4 = (controller as any).nukeTrajectoryStatic;
    expect(traj4).not.toBe(traj3);
    expect(traj4.sams).toHaveLength(1);

    // Call again with same SAM and target -> reference preserved!
    (controller as any).updateNukeTrajectoryPreview(101);
    const traj5 = (controller as any).nukeTrajectoryStatic;
    expect(traj5).toBe(traj4);
  });

  test("cursorLoop skips calculations and WebGL updates while cursor is idle", () => {
    const {
      controller,
      mockSilos,
      updateGhostPreview,
      updateNukeTrajectory,
      setCoords,
      stepFrame,
    } = createTestFixture(5, 5);

    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    // Populate initial ghost data and trajectory
    const ghostData = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = ghostData;
    (controller as any).updateNukeTrajectoryPreview(100);

    // Frame 1: initial render
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 2: mouse stationary (idle) with same data references -> zero dispatches!
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 3: mouse still stationary -> still zero dispatches!
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 4: mouse moves
    setCoords(5.5, 5.5);
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(2);

    // Frame 5: mouse stationary at new position -> idle bypass again
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(2);
  });

  test("cursorLoop independently updates ghost when ghost data changes while cursor is idle", () => {
    const {
      controller,
      mockSilos,
      updateGhostPreview,
      updateNukeTrajectory,
      stepFrame,
    } = createTestFixture(5, 5);

    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    (controller as any).lastGhostData = (
      controller as any
    ).buildGhostPreviewData(100, false);
    (controller as any).updateNukeTrajectoryPreview(100);

    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Update ghost preview data reference (e.g. buildability or cost changed)
    (controller as any).lastGhostData = {
      ...(controller as any).lastGhostData,
      canBuild: false,
    };

    // Step frame while cursor is stationary: ghost updates, trajectory bypassed!
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);
  });

  test("cursorLoop independently updates trajectory when trajectory data changes while cursor is idle", () => {
    const {
      controller,
      mockSilos,
      mockSams,
      updateGhostPreview,
      updateNukeTrajectory,
      stepFrame,
    } = createTestFixture(5, 5);

    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    (controller as any).lastGhostData = (
      controller as any
    ).buildGhostPreviewData(100, false);
    (controller as any).updateNukeTrajectoryPreview(100);

    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // New SAM appears on tick while cursor is idle
    mockSams.push({
      isActive: () => true,
      owner: () => ({ smallID: () => 42 }),
      tile: () => 25,
      level: () => 1,
    });
    (controller as any).updateNukeTrajectoryPreview(100);

    // Step frame while cursor is stationary: trajectory updates, ghost bypassed!
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(2);
  });

  test("cache references are reset when ghost structure is cleared", () => {
    const { controller, mockSilos } = createTestFixture(5, 5);
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    (controller as any).lastGhostData = (
      controller as any
    ).buildGhostPreviewData(100, false);
    (controller as any).updateNukeTrajectoryPreview(100);
    (controller as any).cursorLoop();

    expect((controller as any).prevGhostDataRef).not.toBeNull();
    expect((controller as any).prevTrajRef).not.toBeNull();
    expect((controller as any).lastWorldX).toBe(5);
    expect((controller as any).lastWorldY).toBe(5);

    (controller as any).clearGhostStructure();

    expect((controller as any).lastGhostData).toBeNull();
    expect((controller as any).nukeTrajectoryStatic).toBeNull();
    expect((controller as any).prevGhostDataRef).toBeNull();
    expect((controller as any).prevTrajRef).toBeNull();
    expect((controller as any).lastWorldX).toBeNull();
    expect((controller as any).lastWorldY).toBeNull();
    expect((controller as any).renderedGhostBuffer).toBeNull();
  });

  test("buildGhostPreviewData invalidates cache when railroad properties change", () => {
    const { controller } = createTestFixture();
    const data1 = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = data1;

    // Mutate overlapping railroads
    (controller as any).ghostUnit.buildableUnit.overlappingRailroads = [10, 11];
    const data2 = (controller as any).buildGhostPreviewData(100, false);
    expect(data2).not.toBe(data1);

    (controller as any).lastGhostData = data2;
    // Mutate ghost rail paths
    (controller as any).ghostUnit.buildableUnit.ghostRailPaths = [[10, 11, 12]];
    const data3 = (controller as any).buildGhostPreviewData(100, false);
    expect(data3).not.toBe(data2);
  });

  test("updateNukeTrajectoryPreview invalidates cache when rocketDirectionUp changes", () => {
    const { controller, mockSilos } = createTestFixture();
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    (controller as any).updateNukeTrajectoryPreview(100);
    const traj1 = (controller as any).nukeTrajectoryStatic;
    expect(traj1).not.toBeNull();

    // Toggle rocketDirectionUp
    controller.uiState.rocketDirectionUp =
      !controller.uiState.rocketDirectionUp;
    (controller as any).updateNukeTrajectoryPreview(100);
    const traj2 = (controller as any).nukeTrajectoryStatic;
    expect(traj2).not.toBe(traj1);
    expect(traj2.directionUp).toBe(controller.uiState.rocketDirectionUp);
  });

  test("cursorLoop handles trajectory-only mode over impassable terrain with idle bypass", () => {
    const {
      controller,
      mockSilos,
      updateGhostPreview,
      updateNukeTrajectory,
      setCoords,
      stepFrame,
    } = createTestFixture(5, 5);

    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    // Destination tile is impassable, ensuring T_BLOCKED_DST clamp runs
    (controller as any).game.isImpassable = () => true;

    // Ghost data is null (e.g. over impassable mountain), but trajectory is active
    (controller as any).lastGhostData = null;
    (controller as any).updateNukeTrajectoryPreview(100);

    // Frame 1: renders trajectory only with blocked intercept marker
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);
    expect(updateNukeTrajectory.mock.calls[0][0].tSamIntercept).toBe(0.9999);

    // Frame 2: mouse stationary (idle) -> bypasses WebGL update
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 3: mouse moves -> trajectory updates with blocked intercept marker
    setCoords(6, 6);
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(2);
    expect(updateNukeTrajectory.mock.calls[1][0].tSamIntercept).toBe(0.9999);
  });

  test("createGhostStructure resets diffing caches", () => {
    const { controller, mockSilos } = createTestFixture(5, 5);
    mockSilos.push({
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 0,
    });

    (controller as any).lastGhostData = (
      controller as any
    ).buildGhostPreviewData(100, false);
    (controller as any).updateNukeTrajectoryPreview(100);
    (controller as any).cursorLoop();

    expect((controller as any).prevGhostDataRef).not.toBeNull();
    expect((controller as any).lastWorldX).toBe(5);

    // Creating a new ghost structure resets all diffing caches
    (controller as any).createGhostStructure(UnitType.Factory);
    expect((controller as any).prevGhostDataRef).toBeNull();
    expect((controller as any).prevTrajRef).toBeNull();
    expect((controller as any).lastWorldX).toBeNull();
    expect((controller as any).lastWorldY).toBeNull();
    expect((controller as any).renderedGhostBuffer).toBeNull();
  });
});

describe("BuildPreviewController 0-allocation mutable render buffer", () => {
  function createFixture(initialWorldX = 5, initialWorldY = 5) {
    let currentX = initialWorldX;
    let currentY = initialWorldY;

    const mockMyPlayer = {
      gold: () => 1000n,
      smallID: () => 1,
      readyMissileCount: () => 5,
      units: () => [],
      allies: () => [],
      isOnSameTeam: () => false,
    };

    const game = {
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < 20 && y < 20,
      ref: (x: number, y: number) => y * 20 + x,
      x: (t: number) => t % 20,
      y: (t: number) => Math.floor(t / 20),
      height: () => 20,
      isImpassable: (_tile: number) => false,
      myPlayer: () => mockMyPlayer,
      players: () => [],
      units: () => [],
      config: () => ({
        samRange: () => 10,
        nukeMagnitudes: () => ({ inner: 5, outer: 10 }),
        nukeAllianceBreakThreshold: () => 100,
        trainStationMaxRange: () => 10,
        defensePostRange: () => 10,
      }),
    };

    const transformHandler = {
      screenToWorldCoordinates: () => ({
        x: Math.floor(currentX),
        y: Math.floor(currentY),
      }),
      screenToWorldCoordinatesFloat: () => ({ x: currentX, y: currentY }),
    };

    const updateGhostPreview = vi.fn();
    const updateNukeTrajectory = vi.fn();
    const view = {
      updateGhostPreview,
      updateNukeTrajectory,
    };

    const uiState: any = {
      ghostStructure: UnitType.AtomBomb,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };

    const userSettings: any = {
      nukeAllianceSafetyDuration: () => 0,
      cursorCostLabel: () => true,
      snapBuildPreview: () => false,
    };

    const eventBus = new EventBus();
    const controller = new BuildPreviewController(
      game as any,
      eventBus,
      uiState,
      transformHandler as any,
      view as any,
      userSettings,
    );

    (controller as any).ghostUnit = {
      buildableUnit: {
        type: UnitType.AtomBomb,
        canBuild: 100,
        canUpgrade: false,
        cost: 10n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    };

    return {
      controller,
      updateGhostPreview,
      setCoords: (x: number, y: number) => {
        currentX = x;
        currentY = y;
      },
      stepFrame: () => {
        (controller as any).cursorLoop();
      },
    };
  }

  test("renderedGhostBuffer is updated in-place across frames without re-allocating object reference", () => {
    const { controller, updateGhostPreview, setCoords, stepFrame } =
      createFixture(5.0, 5.0);

    const ghostData = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = ghostData;

    // Frame 1
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    const bufferRef1 = (controller as any).renderedGhostBuffer;
    expect(bufferRef1).not.toBeNull();
    expect(bufferRef1).not.toBe(ghostData);
    expect(bufferRef1.tileX).toBe(4.5);
    expect(bufferRef1.tileY).toBe(4.5);
    expect(bufferRef1.radiusTileX).toBe(4.5);
    expect(bufferRef1.radiusTileY).toBe(4.5);

    // Frame 2: mouse moves to (6.2, 7.8)
    setCoords(6.2, 7.8);
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
    const bufferRef2 = (controller as any).renderedGhostBuffer;
    // Exactly the same object reference (0 allocations during RAF motion)
    expect(bufferRef2).toBe(bufferRef1);
    expect(bufferRef2.tileX).toBeCloseTo(5.7);
    expect(bufferRef2.tileY).toBeCloseTo(7.3);
    expect(bufferRef2.radiusTileX).toBeCloseTo(5.7);
    expect(bufferRef2.radiusTileY).toBeCloseTo(7.3);
  });

  test("lastGhostData remains strictly immutable with canonical integer coordinates", () => {
    const { controller, setCoords, stepFrame } = createFixture(5.2, 5.8);

    const ghostData = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = ghostData;

    expect(ghostData.tileX).toBe(0);
    expect(ghostData.tileY).toBe(5);
    expect(ghostData.radiusTileX).toBe(0);
    expect(ghostData.radiusTileY).toBe(5);

    // Run frame with fractional sub-tile coords
    stepFrame();
    setCoords(8.4, 9.1);
    stepFrame();

    // lastGhostData must NOT be mutated!
    expect(ghostData.tileX).toBe(0);
    expect(ghostData.tileY).toBe(5);
    expect(ghostData.radiusTileX).toBe(0);
    expect(ghostData.radiusTileY).toBe(5);
  });

  test("snapping rules preserve canonical tileX and tileY on renderedGhostBuffer when snapToPlacement is true", () => {
    const { controller, setCoords, stepFrame } = createFixture(5.2, 5.8);

    const ghostData = (controller as any).buildGhostPreviewData(100, false);
    // Force snapToPlacement to true (like city or defense post placement)
    const snappedGhost = {
      ...ghostData,
      snapToPlacement: true,
      tileX: 12,
      tileY: 15,
      radiusTileX: 12,
      radiusTileY: 15,
    };
    (controller as any).lastGhostData = snappedGhost;

    stepFrame();
    const buf = (controller as any).renderedGhostBuffer;
    expect(buf.tileX).toBe(12);
    expect(buf.tileY).toBe(15);
    expect(buf.radiusTileX).toBe(12);
    expect(buf.radiusTileY).toBe(15);

    // Move cursor - tileX/tileY stay snapped to placement
    setCoords(7.5, 9.5);
    stepFrame();
    expect(buf.tileX).toBe(12);
    expect(buf.tileY).toBe(15);
    expect(buf.radiusTileX).toBe(12);
    expect(buf.radiusTileY).toBe(15);
  });

  test("renderedGhostBuffer is set to null when ghost becomes null", () => {
    const { controller, stepFrame } = createFixture(5.0, 5.0);

    (controller as any).lastGhostData = (
      controller as any
    ).buildGhostPreviewData(100, false);
    stepFrame();
    expect((controller as any).renderedGhostBuffer).not.toBeNull();

    // Clear ghost data
    (controller as any).lastGhostData = null;
    stepFrame();
    expect((controller as any).renderedGhostBuffer).toBeNull();
  });

  test("renderedGhostBuffer synchronizes with new ghost reference", () => {
    const { controller, stepFrame } = createFixture(5.0, 5.0);

    const ghost1 = (controller as any).buildGhostPreviewData(100, false);
    (controller as any).lastGhostData = ghost1;
    stepFrame();
    const buf1 = (controller as any).renderedGhostBuffer;
    expect(buf1.canBuild).toBe(true);

    // Ghost state changes (e.g. invalid placement)
    const ghost2 = { ...ghost1, canBuild: false };
    (controller as any).lastGhostData = ghost2;
    stepFrame();
    const buf2 = (controller as any).renderedGhostBuffer;
    expect(buf2.canBuild).toBe(false);
  });

  test("anchors radiusTileX and radiusTileY to upgradeTargetTile for upgrade previews across motion", () => {
    const { controller, setCoords, stepFrame, updateGhostPreview } =
      createFixture(5.0, 5.0);

    const ghostData = (controller as any).buildGhostPreviewData(100, false);
    // Simulate an upgrade ghost targeting tile 42 (x=2, y=2 in 20-wide grid)
    const upgradeGhost = {
      ...ghostData,
      canUpgrade: true,
      upgradeTargetTile: 42,
      snapToPlacement: false,
      tileX: 0,
      tileY: 5,
      radiusTileX: 2,
      radiusTileY: 2,
    };
    (controller as any).lastGhostData = upgradeGhost;

    // Frame 1
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(1);
    const buf1 = (controller as any).renderedGhostBuffer;
    expect(buf1.tileX).toBe(4.5);
    expect(buf1.tileY).toBe(4.5);
    // Radius remains anchored to upgradeTargetTile coordinates (2, 2)
    expect(buf1.radiusTileX).toBe(2);
    expect(buf1.radiusTileY).toBe(2);

    // Frame 2: mouse moves to (8.8, 12.4)
    setCoords(8.8, 12.4);
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
    const buf2 = (controller as any).renderedGhostBuffer;
    expect(buf2).toBe(buf1);
    expect(buf2.tileX).toBeCloseTo(8.3);
    expect(buf2.tileY).toBeCloseTo(11.9);
    // Radius must still be locked at (2, 2)
    expect(buf2.radiusTileX).toBe(2);
    expect(buf2.radiusTileY).toBe(2);

    // Frame 3: mouse stationary at (8.8, 12.4) -> 0 dispatches
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(2);
  });
});

describe("BuildPreviewController Single-Flight Coalescing Guard with Tile-Change Triggering", () => {
  function createCoalescingFixture() {
    const width = 10;
    const height = 10;
    let mouseWorldX = 0;
    let mouseWorldY = 0;
    const playerGold = 100n;
    const buildablesCalls: Array<{ tile: number | undefined; types: any }> = [];
    const pendingPromises: Array<{
      resolve: (val: any) => void;
      reject: (err: any) => void;
      tile: number | undefined;
    }> = [];

    const mockMyPlayer = {
      gold: () => playerGold,
      smallID: () => 1,
      allies: () => [],
      buildables: vi.fn((tileRef: number | undefined, types: any) => {
        buildablesCalls.push({ tile: tileRef, types });
        return new Promise((resolve, reject) => {
          pendingPromises.push({ resolve, reject, tile: tileRef });
        });
      }),
    };

    const game = {
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < width && y < height,
      ref: (x: number, y: number) => y * width + x,
      x: (t: number) => t % width,
      y: (t: number) => Math.floor(t / width),
      isImpassable: (_tile: number) => false,
      myPlayer: () => mockMyPlayer,
      players: () => [mockMyPlayer],
      units: () => [],
      config: () => ({
        samRange: () => 10,
        nukeMagnitudes: () => ({ inner: 5, outer: 10 }),
        nukeAllianceBreakThreshold: () => 100,
        trainStationMaxRange: () => 10,
        defensePostRange: () => 10,
      }),
    };

    const transformHandler = {
      screenToWorldCoordinates: (x: number, y: number) => {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          if (x < 0 || y < 0) return { x: -1, y: -1 };
          return { x: Math.floor(x / 10), y: Math.floor(y / 10) };
        }
        return { x: mouseWorldX, y: mouseWorldY };
      },
      screenToWorldCoordinatesFloat: (x: number, y: number) => {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          if (x < 0 || y < 0) return { x: -1, y: -1 };
          return { x: x / 10, y: y / 10 };
        }
        return { x: mouseWorldX, y: mouseWorldY };
      },
    };

    const userSettings = {
      nukeAllianceSafetyDuration: () => 0,
      cursorCostLabel: () => false,
      snapBuildPreview: () => false,
    };

    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on(BuildUnitIntentEvent, (e) => {
      emitted.push(e);
    });

    const uiState = {
      ghostStructure: UnitType.City,
      upgradeMultiplier: 1,
      rocketDirectionUp: true,
    };

    const view = {
      updateGhostPreview: vi.fn(),
      updateNukeTrajectory: vi.fn(),
      triggerBlockedFlash: vi.fn(),
    };

    const controller = new BuildPreviewController(
      game as any,
      eventBus,
      uiState as any,
      transformHandler as any,
      view as any,
      userSettings as any,
    );

    controller.init();

    return {
      controller,
      eventBus,
      game,
      mockMyPlayer,
      buildablesCalls,
      pendingPromises,
      emitted,
      view,
      uiState,
      setMousePos: (x: number, y: number) => {
        mouseWorldX = x;
        mouseWorldY = y;
      },
      resolveNextQuery: async (canBuild = true) => {
        const p = pendingPromises.shift();
        if (!p) throw new Error("No pending query to resolve");
        p.resolve([
          {
            type: UnitType.City,
            canBuild: canBuild ? p.tile : false,
            canUpgrade: false,
            cost: 10n,
          },
        ]);
        await new Promise((r) => setTimeout(r, 0));
      },
    };
  }

  test("does not re-query when mouse moves within the same tile", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));

    expect(fixture.buildablesCalls.length).toBe(1);
    expect(fixture.buildablesCalls[0].tile).toBe(11);

    // Move slightly, still within tile (1, 1)
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(15, 15));
    expect(fixture.buildablesCalls.length).toBe(1);

    await fixture.resolveNextQuery(true);
    await Promise.resolve();
  });

  test("single-flight coalesces multiple intermediate tile moves into the latest tile", async () => {
    let renderCb: FrameRequestCallback | null = null;
    const origRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      renderCb = cb;
      return 1;
    };
    try {
      const fixture = createCoalescingFixture();
      fixture.setMousePos(1, 1);
      fixture.eventBus.emit(new MouseMoveEvent(10, 10));
      expect(fixture.buildablesCalls.length).toBe(1);
      expect(fixture.buildablesCalls[0].tile).toBe(11);

      // While query for tile 11 is in-flight, cursor traverses tiles 22, 33, 44
      fixture.setMousePos(2, 2);
      fixture.eventBus.emit(new MouseMoveEvent(20, 20));
      fixture.setMousePos(3, 3);
      fixture.eventBus.emit(new MouseMoveEvent(30, 30));
      fixture.setMousePos(4, 4);
      fixture.eventBus.emit(new MouseMoveEvent(40, 40));

      // No extra queries dispatched yet
      expect(fixture.buildablesCalls.length).toBe(1);

      // Resolve first query (tile 11)
      await fixture.resolveNextQuery(true);
      await Promise.resolve();

      // Now query for tile 44 should be dispatched, skipping 22 and 33
      expect(fixture.buildablesCalls.length).toBe(2);
      expect(fixture.buildablesCalls[1].tile).toBe(44);

      await fixture.resolveNextQuery(true);
      await Promise.resolve();
      expect(fixture.buildablesCalls.length).toBe(2);

      // Invoke the render callback registered by init() and assert ghost preview is updated
      (renderCb as ((time: DOMHighResTimeStamp) => void) | null)?.(
        performance.now(),
      );
      expect(fixture.view.updateGhostPreview.mock.lastCall?.[0]).not.toBeNull();
    } finally {
      globalThis.requestAnimationFrame = origRaf;
    }
  });

  test("switching ghost structure mid-flight drops stale response and continues tracking new ghost", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);
    expect(fixture.buildablesCalls[0].types).toEqual([UnitType.City]);

    // Switch ghost structure while City query is in flight
    fixture.uiState.ghostStructure = UnitType.DefensePost;
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseMoveEvent(20, 20));

    // Stale City query resolves
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // The in-flight gate must not be reopened by the stale query;
    // DefensePost query should dispatch cleanly for tile 22
    expect(fixture.buildablesCalls.length).toBe(2);
    expect(fixture.buildablesCalls[1].types).toEqual([UnitType.DefensePost]);
    expect(fixture.buildablesCalls[1].tile).toBe(22);

    await fixture.resolveNextQuery(true);
    await Promise.resolve();
    expect((fixture.controller as any).lastGhostData).not.toBeNull();
  });

  test("50ms guard is removed: consecutive queries can dispatch without artificial 50ms delay", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);

    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Immediately move to a new tile (no 50ms wait)
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseMoveEvent(20, 20));
    expect(fixture.buildablesCalls.length).toBe(2);
    expect(fixture.buildablesCalls[1].tile).toBe(22);

    await fixture.resolveNextQuery(true);
    await Promise.resolve();
  });

  test("confirmation validation waits for its own tile", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Now move to tile 22
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseMoveEvent(20, 20));
    expect(fixture.buildablesCalls.length).toBe(2);

    // While tile 22 is in flight, user clicks on tile 22
    fixture.eventBus.emit(new MouseUpEvent(20, 20));
    // Should NOT have confirmed with tile 11's data
    expect(fixture.emitted.length).toBe(0);
    expect(fixture.buildablesCalls.length).toBe(3);
    expect(fixture.buildablesCalls[2].tile).toBe(22);

    // The preview query for tile 22 may complete first; it cannot consume the
    // separately queued confirmation.
    await fixture.resolveNextQuery(true);
    await Promise.resolve();
    expect(fixture.emitted.length).toBe(0);

    // The confirmation query for tile 22 completes as buildable.
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Now it should confirm on tile 22!
    expect(fixture.emitted.length).toBe(1);
    const intent = fixture.emitted[0] as BuildUnitIntentEvent;
    expect(intent).toBeInstanceOf(BuildUnitIntentEvent);
    expect(intent.tile).toBe(22);
  });

  test("confirmation validation drops an unbuildable tile", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Move to tile 22
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseMoveEvent(20, 20));

    // Click on tile 22 while query is in-flight
    fixture.eventBus.emit(new MouseUpEvent(20, 20));
    expect(fixture.emitted.length).toBe(0);
    expect(fixture.buildablesCalls.length).toBe(3);

    // Resolve the preview query, then the confirmation's exact-tile query.
    await fixture.resolveNextQuery(true);
    await Promise.resolve();
    await fixture.resolveNextQuery(false);
    await Promise.resolve();

    // Should NOT have emitted a build intent
    expect(fixture.emitted.length).toBe(0);
  });

  test("stale response is dropped when querySeq increments (e.g. ghost cleared)", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);

    // User deselects ghost
    (fixture.controller as any).clearGhostStructure();

    // Stale response arrives
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Ghost remains cleared
    expect((fixture.controller as any).ghostUnit).toBeNull();
  });

  test("tick() updates passive state when stationary if no query is in flight", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    expect(fixture.buildablesCalls.length).toBe(1);

    // Next tick runs while hovering stationary at tile 11
    fixture.controller.tick();
    expect(fixture.buildablesCalls.length).toBe(2);
    expect(fixture.buildablesCalls[1].tile).toBe(11);

    await fixture.resolveNextQuery(true);
    await Promise.resolve();
  });

  test("off-map movement during in-flight query dispatches follow-up query to clear ghost preview", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);

    // While query 11 is in flight, move off the map (-1, -1)
    fixture.setMousePos(-1, -1);
    fixture.eventBus.emit(new MouseMoveEvent(-10, -10));

    // Resolve first query
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Second query should have been dispatched for undefined (off-map)
    expect(fixture.buildablesCalls.length).toBe(2);
    expect(fixture.buildablesCalls[1].tile).toBeUndefined();

    // Resolve off-map query
    await fixture.resolveNextQuery(false);
    await Promise.resolve();

    // Ghost preview must be cleared
    expect(fixture.view.updateGhostPreview).toHaveBeenLastCalledWith(null);
  });

  test("moving to new tile and back to original tile during in-flight query cancels pending tile", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);

    // Move to tile 22
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseMoveEvent(20, 20));

    // Move back to tile 11 before query 11 resolves
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));

    // Resolve query 11
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // No redundant query should be dispatched
    expect(fixture.buildablesCalls.length).toBe(1);
  });

  test("click on unqueried tile initiates query and confirms when query completes", async () => {
    const fixture = createCoalescingFixture();
    // Do not emit mouse move, mouse is at (3, 3) = tile 33
    fixture.setMousePos(3, 3);
    fixture.eventBus.emit(new MouseUpEvent(30, 30));

    // Query should have been dispatched for tile 33
    expect(fixture.buildablesCalls.length).toBe(1);
    expect(fixture.buildablesCalls[0].tile).toBe(33);
    expect(fixture.emitted.length).toBe(0);

    // Resolve query 33 as buildable
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    expect(fixture.emitted.length).toBe(1);
    const intent = fixture.emitted[0] as BuildUnitIntentEvent;
    expect(intent.tile).toBe(33);
  });

  test("cursor movement after click does not retarget queued confirmation", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    expect(fixture.buildablesCalls.length).toBe(1);

    // While tile 11 is in flight, user clicks at tile 22
    fixture.setMousePos(2, 2);
    fixture.eventBus.emit(new MouseUpEvent(20, 20));

    // Cursor immediately drifts to tile 33 before tile 11 finishes
    fixture.setMousePos(3, 3);
    fixture.eventBus.emit(new MouseMoveEvent(30, 30));

    // Tile 11 resolves
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Confirmation query stays pinned to tile 22; pointer movement may schedule
    // a separate preview query for tile 33.
    expect(fixture.buildablesCalls.length).toBe(3);
    expect(fixture.buildablesCalls[1].tile).toBe(22);
    expect(fixture.buildablesCalls[2].tile).toBe(33);

    // Resolve the exact confirmation query for tile 22.
    await fixture.resolveNextQuery(true);
    await Promise.resolve();

    // Build intent for tile 22 must be emitted!
    expect(fixture.emitted.length).toBe(1);
    const intent = fixture.emitted[0] as BuildUnitIntentEvent;
    expect(intent.tile).toBe(22);
    await fixture.resolveNextQuery(true);
    await Promise.resolve();
  });

  test("clicking a known unbuildable tile leaves the queue empty", async () => {
    const fixture = createCoalescingFixture();
    fixture.setMousePos(1, 1);
    fixture.eventBus.emit(new MouseMoveEvent(10, 10));
    await fixture.resolveNextQuery(false); // Unbuildable!
    await Promise.resolve();

    // Now click on tile 11
    fixture.eventBus.emit(new MouseUpEvent(10, 10));
    expect(fixture.emitted.length).toBe(0);
    expect((fixture.controller as any).pendingConfirmations).toHaveLength(0);
    // No new query dispatched
    expect(fixture.buildablesCalls.length).toBe(1);
  });
});

describe("BuildPreviewController touch preview", () => {
  function makeController(type: UnitType) {
    const eventBus = new EventBus();
    const builds: BuildUnitIntentEvent[] = [];
    eventBus.on(BuildUnitIntentEvent, (event) => builds.push(event));
    const uiState = { ghostStructure: type, upgradeMultiplier: 1 };
    const player = {
      gold: () => 1000n,
      smallID: () => 1,
      readyMissileCount: () => 10,
      allies: () => [],
      units: () => [],
      isOnSameTeam: () => false,
      buildables: vi.fn(
        (
          _tile: number | undefined,
          types: UnitType[],
          _preventStacking?: boolean,
        ) =>
          Promise.resolve(
            types.map((unitType) => ({
              type: unitType,
              canBuild: true,
              canUpgrade: false,
              cost: 1n,
              overlappingRailroads: [],
              ghostRailPaths: [],
            })),
          ),
      ),
    };
    const controller = new BuildPreviewController(
      {
        myPlayer: () => player,
        players: () => [player],
        units: () => [],
        unit: () => null,
        isValidCoord: () => true,
        isImpassable: () => false,
        ref: (x: number, y: number) => x * 100 + y,
        x: (ref: number) => Math.floor(ref / 100),
        y: (ref: number) => ref % 100,
        config: () => ({
          nukeMagnitudes: () => ({ inner: 5, outer: 10 }),
          nukeAllianceBreakThreshold: () => 100,
        }),
      } as any,
      eventBus,
      uiState as any,
      {
        screenToWorldCoordinates: (x: number) =>
          x < 150 ? { x: 1, y: 1 } : { x: 2, y: 2 },
        worldToScreenCoordinates: (cell: { x: number }) =>
          cell.x < 2 ? { x: 100, y: 100 } : { x: 200, y: 200 },
      } as any,
      {
        updateGhostPreview: vi.fn(),
        updateNukeTrajectory: vi.fn(),
      } as any,
      {
        nukeAllianceSafetyDuration: () => 0,
        cursorCostLabel: () => false,
        snapBuildPreview: () => false,
      } as any,
    );
    (controller as any).ghostUnit = {
      buildableUnit: { type, canBuild: true, canUpgrade: false },
    };
    return { controller, builds, uiState, player, eventBus };
  }

  async function flushBuildables(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function makeDeferredBuildablesController(type: UnitType) {
    const fixture = makeController(type);
    const requests: Array<{
      tile: number | undefined;
      types: UnitType[];
      preventStacking: boolean;
      resolve: (buildables: any[]) => void;
    }> = [];
    fixture.player.buildables.mockImplementation(
      (tile, types, preventStacking = false) =>
        new Promise((resolve) => {
          requests.push({
            tile,
            types,
            preventStacking,
            resolve,
          });
        }),
    );
    return { ...fixture, requests };
  }

  test("moves on a distant tap and confirms the anchored tile on a nearby tap", async () => {
    const { controller, builds } = makeController(UnitType.City);

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(100, 100),
    );
    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(200, 200),
    );
    expect((controller as any).touchPreviewTile).toBe(202);
    expect(builds).toHaveLength(0);
    (controller as any).ghostUnit.buildableUnit.canBuild = true;

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(205, 205),
    );
    await flushBuildables();
    await flushBuildables();
    expect(builds.map((event) => event.tile)).toEqual([202]);
  });

  test("dragging before the first tap anchors and validates the ghost at the drag tile", async () => {
    const { controller, player } = makeController(UnitType.City);

    (controller as any).moveTouchPreview(200, 200);

    expect((controller as any).touchPlacementMode).toBe(true);
    expect(player.buildables).toHaveBeenCalledWith(202, [UnitType.City], false);
    await flushBuildables();
    expect((controller as any).lastGhostData.tileX).toBe(2);
    expect((controller as any).lastGhostData.tileY).toBe(2);
  });

  test("init subscribes to touch placement events", async () => {
    const { controller, eventBus, player } = makeController(UnitType.City);
    const requestAnimationFrame = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => 1);

    try {
      controller.init();
      eventBus.emit(new TouchGhostPlacementEvent(200, 200));

      expect((controller as any).touchPreviewTile).toBe(202);
      expect(player.buildables).toHaveBeenCalledWith(
        202,
        [UnitType.City],
        false,
      );
      await flushBuildables();
      expect((controller as any).lastGhostData.tileX).toBe(2);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  test("Enter uses the preserved touch preview after changing build type", async () => {
    const { controller, builds, eventBus, requests } =
      makeDeferredBuildablesController(UnitType.City);
    const requestAnimationFrame = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => 1);
    (controller as any).ghostResolved = false;
    (controller as any).touchPlacementMode = true;
    (controller as any).touchPreviewTile = 202;
    (controller as any).mousePos.x = 100;
    (controller as any).mousePos.y = 100;
    (controller as any).uiState.ghostStructure = UnitType.Port;

    try {
      controller.init();
      eventBus.emit(new ConfirmGhostStructureEvent());

      expect((controller as any).touchPreviewTile).toBe(202);
      expect(requests).toHaveLength(2);
      expect(requests[0]).toEqual(
        expect.objectContaining({ tile: 202, types: [UnitType.Port] }),
      );
      expect(requests[1]).toEqual(
        expect.objectContaining({ tile: 202, types: [UnitType.Port] }),
      );
      requests[0].resolve([
        {
          type: UnitType.Port,
          canBuild: 202,
          canUpgrade: false,
          cost: 1n,
        },
      ]);
      await flushBuildables();
      requests[1].resolve([
        {
          type: UnitType.Port,
          canBuild: 202,
          canUpgrade: false,
          cost: 1n,
        },
      ]);
      await flushBuildables();
      expect(builds.map((event) => event.tile)).toEqual([202]);
      expect(builds[0].unit).toBe(UnitType.Port);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  test("Enter does not confirm at a stale mouse position without a touch preview", () => {
    const { controller, eventBus, player } = makeController(UnitType.City);
    const requestAnimationFrame = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => 1);
    (controller as any).touchPlacementMode = true;
    (controller as any).touchPreviewTile = null;
    (controller as any).mousePos.x = 100;
    (controller as any).mousePos.y = 100;

    try {
      controller.init();
      eventBus.emit(new ConfirmGhostStructureEvent());

      expect(player.buildables).not.toHaveBeenCalled();
      expect((controller as any).pendingConfirmations).toHaveLength(0);
    } finally {
      requestAnimationFrame.mockRestore();
    }
  });

  test("preserves a selected nuke for repeated touch launches", async () => {
    const { controller, builds, uiState } = makeController(UnitType.AtomBomb);

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(100, 100),
    );
    (controller as any).ghostUnit.buildableUnit.canBuild = true;
    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(105, 105),
    );
    await flushBuildables();
    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(200, 200),
    );
    (controller as any).ghostUnit.buildableUnit.canBuild = true;
    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(205, 205),
    );
    await flushBuildables();
    await flushBuildables();

    expect(builds.map((event) => event.tile)).toEqual([101, 202]);
    expect(uiState.ghostStructure).toBe(UnitType.AtomBomb);
  });

  test("keeps separate desktop confirmations queued while validation is pending", async () => {
    const { controller, builds, requests } = makeDeferredBuildablesController(
      UnitType.AtomBomb,
    );
    (controller as any).ghostResolved = false;

    (controller as any).requestConfirmStructure(new MouseUpEvent(100, 100));
    (controller as any).requestConfirmStructure(new MouseUpEvent(200, 200));

    expect(requests).toHaveLength(1);
    expect(requests[0].tile).toBe(101);
    expect((controller as any).pendingConfirmations).toHaveLength(2);

    requests[0].resolve([
      {
        type: UnitType.AtomBomb,
        canBuild: 101,
        canUpgrade: false,
        cost: 1n,
      },
    ]);
    await flushBuildables();

    expect(requests).toHaveLength(2);
    expect(requests[1].tile).toBe(202);
    requests[1].resolve([
      {
        type: UnitType.AtomBomb,
        canBuild: 202,
        canUpgrade: false,
        cost: 1n,
      },
    ]);
    await flushBuildables();

    expect(builds.map((event) => event.tile)).toEqual([101, 202]);
    expect((controller as any).pendingConfirmations).toHaveLength(0);
  });

  test("drains repeated touch confirmations for a validated nuke tile", async () => {
    const { controller, builds, requests, uiState } =
      makeDeferredBuildablesController(UnitType.AtomBomb);
    (controller as any).ghostResolved = false;
    (controller as any).touchPlacementMode = true;
    (controller as any).touchPreviewTile = 101;

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(100, 100),
    );
    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(100, 100),
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].tile).toBe(101);
    expect((controller as any).pendingConfirmations).toHaveLength(2);
    requests[0].resolve([
      {
        type: UnitType.AtomBomb,
        canBuild: 101,
        canUpgrade: false,
        cost: 1n,
      },
    ]);
    await flushBuildables();

    expect(builds.map((event) => event.tile)).toEqual([101, 101]);
    expect(uiState.ghostStructure).toBe(UnitType.AtomBomb);
    expect((controller as any).pendingConfirmations).toHaveLength(0);
  });

  test("moving the preview clears cached eligibility without dropping confirmations", async () => {
    const { controller } = makeController(UnitType.City);
    const c = controller as any;
    c.touchPreviewTile = 101;
    c.pendingConfirmations.push({
      tile: 101,
      ghostType: UnitType.City,
      preventStacking: false,
      ghostGeneration: c.ghostGeneration,
    });
    Object.assign(c.ghostUnit.buildableUnit, {
      canBuild: 101,
      canUpgrade: 42,
      cost: 1n,
      overlappingRailroads: [],
      ghostRailPaths: [],
    });
    c.lastGhostData = c.buildGhostPreviewData(101, false);
    c.prevGhostDataRef = c.lastGhostData;
    c.renderedGhostBuffer = { ...c.lastGhostData };

    c.moveTouchPreview(200, 200);

    expect(c.touchPreviewTile).toBe(202);
    expect(c.pendingConfirmations).toHaveLength(1);
    expect(c.pendingConfirmations[0].tile).toBe(101);
    expect(c.ghostUnit.buildableUnit).toEqual(
      expect.objectContaining({ canBuild: false, canUpgrade: false }),
    );
    expect(c.lastGhostData).toEqual(
      expect.objectContaining({ canBuild: false, canUpgrade: false }),
    );
    expect(c.prevGhostDataRef).toBeNull();
    expect(c.renderedGhostBuffer).toBeNull();
    await flushBuildables();
  });

  test("hit testing follows the snapped preview position only when snapping is enabled", () => {
    const { controller } = makeController(UnitType.City);
    const c = controller as any;
    c.touchPreviewTile = 101;
    c.lastGhostData = {
      snapToPlacement: true,
      tileX: 5,
      tileY: 5,
    };

    expect(c.isNearTouchPreview(200, 200)).toBe(true);
    expect(c.isNearTouchPreview(100, 100)).toBe(false);

    c.lastGhostData.snapToPlacement = false;
    expect(c.isNearTouchPreview(100, 100)).toBe(true);
    expect(c.isNearTouchPreview(200, 200)).toBe(false);
  });

  test("ignores validation returned for an earlier touch preview", async () => {
    const pendingBuildables: Array<(value: any[]) => void> = [];
    const buildables = vi.fn(
      () =>
        new Promise<any[]>((resolve) => {
          pendingBuildables.push(resolve);
        }),
    );
    const eventBus = new EventBus();
    const controller = new BuildPreviewController(
      {
        myPlayer: () => ({ buildables }),
        isValidCoord: () => true,
        ref: (x: number, y: number) => x * 100 + y,
        x: (ref: number) => Math.floor(ref / 100),
        y: (ref: number) => ref % 100,
        isImpassable: () => false,
      } as any,
      eventBus,
      { ghostStructure: UnitType.City, upgradeMultiplier: 1 } as any,
      {
        screenToWorldCoordinates: (x: number) =>
          x < 150 ? { x: 1, y: 1 } : { x: 2, y: 2 },
        worldToScreenCoordinates: () => ({ x: 100, y: 100 }),
      } as any,
      {
        updateGhostPreview: vi.fn(),
        updateNukeTrajectory: vi.fn(),
      } as any,
      { nukeAllianceSafetyDuration: () => 0 } as any,
    );
    (controller as any).ghostUnit = {
      buildableUnit: {
        type: UnitType.City,
        canBuild: false,
        canUpgrade: false,
      },
    };
    (controller as any).touchPlacementMode = true;
    (controller as any).touchPreviewTile = 101;
    (controller as any).lastGhostQueryAt = -Infinity;

    controller.renderGhost();
    expect(buildables).toHaveBeenCalledWith(101, [UnitType.City], false);

    (controller as any).moveTouchPreview(200, 200);
    pendingBuildables[0]([
      { type: UnitType.City, canBuild: false, canUpgrade: 42 },
    ]);
    await flushBuildables();

    expect((controller as any).touchPreviewTile).toBe(202);
    expect(buildables).toHaveBeenLastCalledWith(202, [UnitType.City], false);
    expect((controller as any).ghostUnit.buildableUnit).toEqual(
      expect.objectContaining({ canBuild: false, canUpgrade: false }),
    );
  });
});
