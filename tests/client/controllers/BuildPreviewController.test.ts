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

    // Ghost data is null (e.g. over impassable mountain), but trajectory is active
    (controller as any).lastGhostData = null;
    (controller as any).updateNukeTrajectoryPreview(100);

    // Frame 1: renders trajectory only
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 2: mouse stationary (idle) -> bypasses WebGL update
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(1);

    // Frame 3: mouse moves -> trajectory updates
    setCoords(6, 6);
    stepFrame();
    expect(updateGhostPreview).toHaveBeenCalledTimes(0);
    expect(updateNukeTrajectory).toHaveBeenCalledTimes(2);
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
