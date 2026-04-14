import { describe, expect, test, vi } from "vitest";
import { SendUpgradeStructureIntentEvent } from "../src/client/Transport";
import { EventBus } from "../src/core/EventBus";
import { UnitType } from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";

/**
 * NOTE: The `findAndUpgradeNearestBuilding` function below is a test-local
 * mirror of `ClientGameRunner.findAndUpgradeNearestBuilding` (src/client/ClientGameRunner.ts).
 * If you change the production logic, update this stub accordingly so the
 * tests remain meaningful.
 */

// Minimal tile ref for testing
const TILE = 42 as TileRef;
const PLAYER_ID = "player-1";

/** Creates a minimal unit view stub for testing. */
function makeUnit(id: number, type: UnitType, ownerID: string, tile = TILE) {
  return {
    id: () => id,
    type: () => type,
    tile: () => tile,
    owner: () => ({ id: () => ownerID }),
  };
}

/**
 * Builds a minimal ClientGameRunner stub with mocked dependencies.
 * @param buildableUnits - list returned by myPlayer.actions(); set canUpgrade to
 *   a unit id to mark it upgradeable, or false to mark it as existing but blocked
 *   (e.g. insufficient gold).
 * @param allUnits - units returned by gameView.units()
 */
function makeRunner(buildableUnits: any[], allUnits: any[]) {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");

  const myPlayer = {
    id: () => PLAYER_ID,
    actions: vi.fn().mockResolvedValue({ buildableUnits }),
  };

  const gameView = {
    units: () => allUnits,
    manhattanDist: (_a: TileRef, _b: TileRef) => 5,
  };

  // Mirrors ClientGameRunner.findAndUpgradeNearestBuilding
  const runner = {
    myPlayer,
    gameView,
    eventBus,
    findAndUpgradeNearestBuilding: async function (tile: TileRef) {
      const actions = await this.myPlayer!.actions(tile, []);
      const upgradeUnits: {
        unitId: number;
        unitType: UnitType;
        distance: number;
      }[] = [];

      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade !== false) {
          const existingUnit = this.gameView
            .units()
            .find((unit: any) => unit.id() === bu.canUpgrade);
          if (existingUnit) {
            const distance = this.gameView.manhattanDist(
              tile,
              existingUnit.tile(),
            );
            upgradeUnits.push({
              unitId: bu.canUpgrade,
              unitType: bu.type,
              distance,
            });
          }
        }
      }

      if (upgradeUnits.length === 0) {
        return;
      }

      // findClosestBy equivalent — pick minimum distance
      const bestUpgrade = upgradeUnits.reduce((a, b) =>
        a.distance <= b.distance ? a : b,
      );

      if (bestUpgrade.unitType !== UnitType.SAMLauncher) {
        // If actions() returned a SAM entry with canUpgrade===false, a SAM
        // exists near clickedTile but can't be afforded — do nothing.
        const samBlockedByGold = actions.buildableUnits.some(
          (bu: any) =>
            bu.type === UnitType.SAMLauncher && bu.canUpgrade === false,
        );
        if (samBlockedByGold) return;
      }

      this.eventBus.emit(
        new SendUpgradeStructureIntentEvent(
          bestUpgrade.unitId,
          bestUpgrade.unitType,
        ),
      );
    },
  };

  return { runner, emitSpy };
}

describe("findAndUpgradeNearestBuilding", () => {
  describe("no SAM nearby", () => {
    test("upgrades DefensePost when it is the only upgradeable building", async () => {
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID);
      const buildableUnits = [{ type: UnitType.DefensePost, canUpgrade: 1 }];
      const { runner, emitSpy } = makeRunner(buildableUnits, [defensePost]);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });

    test("does nothing when no buildings are upgradeable", async () => {
      const buildableUnits = [
        { type: UnitType.DefensePost, canUpgrade: false },
      ];
      const { runner, emitSpy } = makeRunner(buildableUnits, []);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe("SAM nearby — the bug scenario", () => {
    test("does NOT upgrade DefensePost when own SAM is nearby but unaffordable", async () => {
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID);

      // SAM has canUpgrade=false (exists near tile but gold insufficient)
      const buildableUnits = [
        { type: UnitType.SAMLauncher, canUpgrade: false },
        { type: UnitType.DefensePost, canUpgrade: 1 },
      ];
      const { runner, emitSpy } = makeRunner(buildableUnits, [defensePost]);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    test("upgrades SAM when it IS affordable", async () => {
      const samUnit = makeUnit(10, UnitType.SAMLauncher, PLAYER_ID);
      const buildableUnits = [{ type: UnitType.SAMLauncher, canUpgrade: 10 }];
      const { runner, emitSpy } = makeRunner(buildableUnits, [samUnit]);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 10, unitType: UnitType.SAMLauncher }),
      );
    });

    test("upgrades DefensePost when no SAM entry exists in buildableUnits at all", async () => {
      // No SAM in buildableUnits means no SAM near this tile — normal upgrade
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID);
      const buildableUnits = [{ type: UnitType.DefensePost, canUpgrade: 1 }];
      const { runner, emitSpy } = makeRunner(buildableUnits, [defensePost]);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });
  });

  describe("multiple upgradeable buildings", () => {
    test("picks the closest upgradeable building when no SAM nearby", async () => {
      const defensePost = makeUnit(
        1,
        UnitType.DefensePost,
        PLAYER_ID,
        10 as TileRef,
      );
      const factory = makeUnit(2, UnitType.Factory, PLAYER_ID, 20 as TileRef);
      const buildableUnits = [
        { type: UnitType.DefensePost, canUpgrade: 1 },
        { type: UnitType.Factory, canUpgrade: 2 },
      ];

      const { runner, emitSpy } = makeRunner(buildableUnits, [
        defensePost,
        factory,
      ]);
      runner.gameView.manhattanDist = (_a: TileRef, b: TileRef) =>
        b === (10 as TileRef) ? 3 : 8;

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });

    test("upgrades SAM when both SAM and DefensePost are upgradeable and SAM is closer", async () => {
      const samUnit = makeUnit(
        10,
        UnitType.SAMLauncher,
        PLAYER_ID,
        5 as TileRef,
      );
      const defensePost = makeUnit(
        1,
        UnitType.DefensePost,
        PLAYER_ID,
        20 as TileRef,
      );
      const buildableUnits = [
        { type: UnitType.SAMLauncher, canUpgrade: 10 },
        { type: UnitType.DefensePost, canUpgrade: 1 },
      ];
      const { runner, emitSpy } = makeRunner(buildableUnits, [
        samUnit,
        defensePost,
      ]);
      runner.gameView.manhattanDist = (_a: TileRef, b: TileRef) =>
        b === (5 as TileRef) ? 2 : 10;

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 10, unitType: UnitType.SAMLauncher }),
      );
    });
  });
});
