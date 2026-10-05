import { describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import { MouseUpEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
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

describe("BuildPreviewController confirm with the pointer off the map", () => {
  function makeController(worldX: number, worldY: number) {
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
    "resolved preview for %s",
    (type) => {
      const { controller } = makeController(3, 4);
      const buildable = (controller as any).ghostUnit.buildableUnit;
      Object.assign(buildable, { type, canBuild: 0, cost: 1n });
      const data = (controller as any).buildGhostPreviewData(43, false);
      const position = type === UnitType.Warship ? [3, 4] : [0, 0];
      expect([data.tileX, data.tileY]).toEqual(position);
      expect([data.radiusTileX, data.radiusTileY]).toEqual(position);
      expect(data.snapToPlacement).toBe(type !== UnitType.Warship);
    },
  );

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
