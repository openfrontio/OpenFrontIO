import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import {
  ConfirmGhostStructureEvent,
  MouseUpEvent,
} from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { USER_SETTINGS_CHANGED_EVENT } from "../../../src/client/UserSettings";

let previewAbort: AbortController | undefined;

afterEach(() => {
  previewAbort?.abort();
  previewAbort = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

describe.each([UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV])(
  "BuildPreviewController betrayal protection for %s",
  (type) => {
    function makeController() {
      vi.stubGlobal("requestAnimationFrame", vi.fn());
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const unit = {
        type,
        canBuild: 43,
        canUpgrade: false,
        cost: 1n,
        ghostRailPaths: [],
        overlappingRailroads: [],
      };
      const ally = {
        smallID: () => 2,
        isTraitor: () => false,
        isDisconnected: () => false,
      };
      const player = {
        gold: () => 100n,
        readyMissileCount: () => 3,
        smallID: () => 1,
        allies: () => [ally],
        units: () => [],
        buildables: async () => [unit],
      };
      const game = {
        isValidCoord: () => true,
        isImpassable: () => false,
        ref: (x: number, y: number) => y * 10 + x,
        x: (tile: number) => tile % 10,
        y: (tile: number) => Math.floor(tile / 10),
        ownerID: (tile: number) => (tile === 43 ? 2 : 3),
        myPlayer: () => player,
        anyUnitNearby: () => false,
        circleSearch: (
          tile: number,
          _radius: number,
          visit: (tile: number, distanceSquared: number) => boolean,
        ) => visit(tile, 0),
        config: () => ({
          nukeMagnitudes: () => ({ inner: 1, outer: 1 }),
          nukeAllianceBreakThreshold: () => 0,
        }),
      };
      const transformHandler = {
        screenToWorldCoordinates: vi.fn(() => ({ x: 3, y: 4 })),
      };
      const userSettings = {
        preventNuclearBetrayal: vi.fn(() => true),
        nukeAllianceSafetyDuration: () => 0,
        cursorCostLabel: () => false,
        snapBuildPreview: () => false,
      };
      const eventBus = new EventBus();
      const listenerAbort = new window.AbortController();
      previewAbort = listenerAbort;
      const intents: BuildUnitIntentEvent[] = [];
      eventBus.on(BuildUnitIntentEvent, (event) => intents.push(event));
      const controller = new BuildPreviewController(
        game as any,
        eventBus,
        { ghostStructure: type } as any,
        transformHandler as any,
        { updateGhostPreview: vi.fn(), updateNukeTrajectory: vi.fn() } as any,
        userSettings as any,
        listenerAbort.signal,
      );
      (controller as any).ghostUnit = { buildableUnit: unit };
      controller.init();
      return {
        controller,
        eventBus,
        intents,
        transformHandler,
        userSettings,
        listenerAbort,
      };
    }

    test("blocks repeated clicks and Enter without clearing the selection", () => {
      const { controller, eventBus, intents } = makeController();
      eventBus.emit(new MouseUpEvent(0, 0));
      eventBus.emit(new MouseUpEvent(0, 0));
      eventBus.emit(new ConfirmGhostStructureEvent());
      expect(intents).toEqual([]);
      expect(controller.uiState.ghostStructure).toBe(type);
    });

    test("re-enables preview and launch when moving to a safe target", async () => {
      const { controller, eventBus, intents, transformHandler } =
        makeController();
      controller.tick();
      await Promise.resolve();
      expect((controller as any).lastGhostData).toMatchObject({
        canBuild: false,
        betrayalBlocked: true,
      });

      transformHandler.screenToWorldCoordinates.mockReturnValue({
        x: 4,
        y: 4,
      });
      vi.mocked(performance.now).mockReturnValue(1100);
      controller.tick();
      await Promise.resolve();
      expect((controller as any).lastGhostData).toMatchObject({
        canBuild: true,
        betrayalBlocked: false,
      });
      eventBus.emit(new ConfirmGhostStructureEvent());
      expect(intents).toHaveLength(1);
      expect(intents[0].tile).toBe(44);
    });

    test("checks the setting again at confirmation before the preview refreshes", () => {
      const { controller, eventBus, intents, userSettings } = makeController();
      userSettings.preventNuclearBetrayal.mockReturnValue(false);
      const preview = (controller as any).buildGhostPreviewData(43, true);
      expect(preview).toMatchObject({
        canBuild: true,
        rangeWarning: true,
        betrayalBlocked: false,
      });

      userSettings.preventNuclearBetrayal.mockReturnValue(true);
      eventBus.emit(new ConfirmGhostStructureEvent());
      expect(intents).toEqual([]);
      userSettings.preventNuclearBetrayal.mockReturnValue(false);
      eventBus.emit(new ConfirmGhostStructureEvent());
      expect(intents).toHaveLength(1);
    });

    test("refreshes on a setting change while paused and removes the listener on stop", async () => {
      const { controller, userSettings, listenerAbort } = makeController();
      controller.tick();
      await Promise.resolve();
      expect((controller as any).lastGhostData.betrayalBlocked).toBe(true);

      userSettings.preventNuclearBetrayal.mockReturnValue(false);
      globalThis.dispatchEvent(
        new CustomEvent(
          `${USER_SETTINGS_CHANGED_EVENT}:settings.preventNuclearBetrayal`,
        ),
      );
      await Promise.resolve();
      expect((controller as any).lastGhostData).toMatchObject({
        canBuild: true,
        betrayalBlocked: false,
        rangeWarning: type !== UnitType.MIRV,
      });

      listenerAbort.abort();
      userSettings.preventNuclearBetrayal.mockReturnValue(true);
      globalThis.dispatchEvent(
        new CustomEvent(
          `${USER_SETTINGS_CHANGED_EVENT}:settings.preventNuclearBetrayal`,
        ),
      );
      await Promise.resolve();
      expect((controller as any).lastGhostData.betrayalBlocked).toBe(false);
    });
  },
);

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
      preventNuclearBetrayal: () => false,
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
      new AbortController().signal,
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
