import { describe, expect, test, vi } from "vitest";
import {
  BuildPreviewController,
  samThreatensNukePreview,
} from "../../../src/client/controllers/BuildPreviewController";
import { MouseUpEvent } from "../../../src/client/InputHandler";
import { BuildUnitIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

describe("BuildPreviewController keep-selected setting", () => {
  // Places a defense post on the map with the setting on or off, and returns
  // what uiState.ghostStructure was left at.
  function placeDefensePost(keepSelected: boolean) {
    const game = {
      isValidCoord: () => true,
      ref: (x: number, y: number) => y * 10 + x,
      myPlayer: () => null,
    };
    const uiState = { ghostStructure: UnitType.DefensePost as UnitType | null };
    const keepBuildSelected = vi.fn(() => keepSelected);
    const controller = new BuildPreviewController(
      game as any,
      new EventBus(),
      uiState as any,
      { screenToWorldCoordinates: () => ({ x: 3, y: 4 }) } as any,
      { updateGhostPreview: () => {}, updateNukeTrajectory: () => {} } as any,
      { nukeAllianceSafetyDuration: () => 0, keepBuildSelected } as any,
    );
    (controller as any).ghostUnit = {
      buildableUnit: {
        type: UnitType.DefensePost,
        canBuild: 1,
        canUpgrade: false,
      },
    };
    (controller as any).requestConfirmStructure(new MouseUpEvent(0, 0));
    expect(keepBuildSelected).toHaveBeenCalledWith(UnitType.DefensePost);
    return uiState.ghostStructure;
  }

  test("keeps the ghost selected after placing when the setting is on", () => {
    expect(placeDefensePost(true)).toBe(UnitType.DefensePost);
  });

  test("clears the ghost after placing when the setting is off", () => {
    expect(placeDefensePost(false)).toBeNull();
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
      myPlayer: () => null,
    };
    const transformHandler = {
      screenToWorldCoordinates: () => ({ x: worldX, y: worldY }),
    };
    const userSettings = {
      nukeAllianceSafetyDuration: () => 0,
      keepBuildSelected: () => false,
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
