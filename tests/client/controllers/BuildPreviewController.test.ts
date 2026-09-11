import { describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import {
  MouseUpEvent,
  TouchGhostPlacementEvent,
} from "../../../src/client/InputHandler";
import { SendUpgradeStructureIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

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

describe("BuildPreviewController confirmation validation", () => {
  test("uses canUpgrade from the tapped tile instead of the cached preview", async () => {
    const eventBus = new EventBus();
    const upgrades: SendUpgradeStructureIntentEvent[] = [];
    eventBus.on(SendUpgradeStructureIntentEvent, (event) =>
      upgrades.push(event),
    );
    const buildables = vi.fn().mockResolvedValue([
      {
        type: UnitType.City,
        canBuild: false,
        canUpgrade: 22,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    ]);
    const uiState = {
      ghostStructure: UnitType.City,
      upgradeMultiplier: 1,
    };
    const controller = new BuildPreviewController(
      {
        myPlayer: () => ({ buildables }),
        isValidCoord: () => true,
        ref: () => 123,
        isImpassable: () => false,
      } as any,
      eventBus,
      uiState as any,
      { screenToWorldCoordinates: () => ({ x: 4, y: 5 }) } as any,
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
        canUpgrade: 11,
      },
    };

    (controller as any).requestConfirmStructure(new MouseUpEvent(40, 50));
    await vi.waitFor(() => expect(upgrades).toHaveLength(1));

    expect(buildables).toHaveBeenCalledWith(123, [UnitType.City]);
    expect(upgrades[0].unitId).toBe(22);
  });

  test("a distant tap moves the anchored preview and a nearby tap confirms it", async () => {
    const eventBus = new EventBus();
    const buildables = vi.fn().mockResolvedValue([
      {
        type: UnitType.City,
        canBuild: true,
        canUpgrade: false,
        cost: 0n,
        overlappingRailroads: [],
        ghostRailPaths: [],
      },
    ]);
    const uiState = { ghostStructure: UnitType.City, upgradeMultiplier: 1 };
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
      { nukeAllianceSafetyDuration: () => 0 } as any,
    );
    (controller as any).ghostUnit = {
      buildableUnit: { type: UnitType.City },
    };

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(100, 100),
    );
    expect((controller as any).touchPreviewTile).toBe(101);

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(200, 200),
    );
    expect((controller as any).touchPreviewTile).toBe(202);
    expect(buildables).not.toHaveBeenCalled();

    (controller as any).handleTouchPlacement(
      new TouchGhostPlacementEvent(210, 210),
    );
    await vi.waitFor(() =>
      expect(buildables).toHaveBeenCalledWith(202, [UnitType.City]),
    );
  });
});
