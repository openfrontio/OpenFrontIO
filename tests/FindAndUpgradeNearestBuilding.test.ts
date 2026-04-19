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

const TILE = 42 as TileRef;
const PLAYER_ID = "player-1";
const SEARCH_RADIUS = 15;

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
 * @param buildableUnits - list returned by myPlayer.actions(); canUpgrade is a
 *   unit id when upgradeable, or false when the unit exists but is blocked
 *   (e.g. insufficient gold).
 * @param allUnits - units returned by gameView.units()
 * @param nearbySamUnits - own SAM units returned by gameView.nearbyUnits()
 * @param distanceMap - optional map of unit tile → manhattanDist from clickedTile
 */
function makeRunner(
  buildableUnits: any[],
  allUnits: any[],
  nearbySamUnits: { unit: ReturnType<typeof makeUnit>; distSquared: number }[],
  distanceMap: Map<TileRef, number> = new Map(),
) {
  const eventBus = new EventBus();
  const emitSpy = vi.spyOn(eventBus, "emit");

  const myPlayer = {
    id: () => PLAYER_ID,
    actions: vi.fn().mockResolvedValue({ buildableUnits }),
  };

  const gameView = {
    units: () => allUnits,
    manhattanDist: (_a: TileRef, b: TileRef) => distanceMap.get(b) ?? 5,
    nearbyUnits: vi.fn().mockReturnValue(nearbySamUnits),
    config: () => ({ structureMinDist: () => SEARCH_RADIUS }),
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

      const bestUpgrade = upgradeUnits.reduce((a, b) =>
        a.distance <= b.distance ? a : b,
      );

      // Check if any unaffordable building is closer than bestUpgrade
      for (const bu of actions.buildableUnits) {
        if (bu.canUpgrade === false && bu.type !== bestUpgrade.unitType) {
          const myPlayerID = this.myPlayer!.id();
          const closestOfType = this.gameView
            .nearbyUnits(
              tile,
              this.gameView.config().structureMinDist(),
              bu.type,
            )
            .filter(({ unit }: any) => unit.owner().id() === myPlayerID)
            .sort((a: any, b: any) => a.distSquared - b.distSquared)[0];

          if (closestOfType) {
            const dist = this.gameView.manhattanDist(
              tile,
              closestOfType.unit.tile(),
            );
            if (dist <= bestUpgrade.distance) {
              return;
            }
          }
        }
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
      const { runner, emitSpy } = makeRunner(buildableUnits, [defensePost], []);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });

    test("does nothing when no buildings are upgradeable", async () => {
      const buildableUnits = [
        { type: UnitType.DefensePost, canUpgrade: false },
      ];
      const { runner, emitSpy } = makeRunner(buildableUnits, [], []);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe("SAM nearby — the bug scenario", () => {
    test("does NOT upgrade DefensePost when unaffordable SAM is closer to click", async () => {
      // SAM is at tile 5 (dist=2), DefensePost at tile 20 (dist=10)
      // Player clicked near the SAM — should do nothing
      const samTile = 5 as TileRef;
      const dpTile = 20 as TileRef;
      const samUnit = makeUnit(10, UnitType.SAMLauncher, PLAYER_ID, samTile);
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID, dpTile);

      const buildableUnits = [
        { type: UnitType.SAMLauncher, canUpgrade: false },
        { type: UnitType.DefensePost, canUpgrade: 1 },
      ];
      const distMap = new Map<TileRef, number>([
        [samTile, 2],
        [dpTile, 10],
      ]);
      const { runner, emitSpy } = makeRunner(
        buildableUnits,
        [defensePost],
        [{ unit: samUnit, distSquared: 4 }],
        distMap,
      );

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    test("DOES upgrade DefensePost when unaffordable SAM is farther than DefensePost", async () => {
      // DefensePost at tile 5 (dist=2), SAM at tile 20 (dist=10)
      // Player clicked near the DefensePost — should upgrade it
      const samTile = 20 as TileRef;
      const dpTile = 5 as TileRef;
      const samUnit = makeUnit(10, UnitType.SAMLauncher, PLAYER_ID, samTile);
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID, dpTile);

      const buildableUnits = [
        { type: UnitType.SAMLauncher, canUpgrade: false },
        { type: UnitType.DefensePost, canUpgrade: 1 },
      ];
      const distMap = new Map<TileRef, number>([
        [samTile, 10],
        [dpTile, 2],
      ]);
      const { runner, emitSpy } = makeRunner(
        buildableUnits,
        [defensePost],
        [{ unit: samUnit, distSquared: 100 }],
        distMap,
      );

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });

    test("does NOT upgrade Factory when unaffordable City is closer (Evan's scenario)", async () => {
      // City at tile 5 (dist=2, costs 1M), Factory at tile 20 (dist=10, costs 500K)
      // Player clicked near the City — should do nothing
      const cityTile = 5 as TileRef;
      const factoryTile = 20 as TileRef;
      const cityUnit = makeUnit(10, UnitType.City, PLAYER_ID, cityTile);
      const factoryUnit = makeUnit(1, UnitType.Factory, PLAYER_ID, factoryTile);

      const buildableUnits = [
        { type: UnitType.City, canUpgrade: false },
        { type: UnitType.Factory, canUpgrade: 1 },
      ];
      const distMap = new Map<TileRef, number>([
        [cityTile, 2],
        [factoryTile, 10],
      ]);
      const { runner, emitSpy } = makeRunner(
        buildableUnits,
        [factoryUnit],
        [],
        distMap,
      );
      // Mock nearbyUnits to return city when queried for City type
      runner.gameView.nearbyUnits = vi.fn((tile, radius, type) => {
        if (type === UnitType.City) {
          return [{ unit: cityUnit, distSquared: 4 }];
        }
        return [];
      });

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    test("upgrades SAM when it IS affordable", async () => {
      const samUnit = makeUnit(10, UnitType.SAMLauncher, PLAYER_ID);
      const buildableUnits = [{ type: UnitType.SAMLauncher, canUpgrade: 10 }];
      const { runner, emitSpy } = makeRunner(buildableUnits, [samUnit], []);

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 10, unitType: UnitType.SAMLauncher }),
      );
    });
  });

  describe("multiple upgradeable buildings", () => {
    test("picks the closest upgradeable building when no SAM nearby", async () => {
      const dpTile = 10 as TileRef;
      const factoryTile = 20 as TileRef;
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID, dpTile);
      const factory = makeUnit(2, UnitType.Factory, PLAYER_ID, factoryTile);
      const buildableUnits = [
        { type: UnitType.DefensePost, canUpgrade: 1 },
        { type: UnitType.Factory, canUpgrade: 2 },
      ];
      const distMap = new Map<TileRef, number>([
        [dpTile, 3],
        [factoryTile, 8],
      ]);
      const { runner, emitSpy } = makeRunner(
        buildableUnits,
        [defensePost, factory],
        [],
        distMap,
      );

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 1, unitType: UnitType.DefensePost }),
      );
    });

    test("upgrades SAM when both SAM and DefensePost are upgradeable and SAM is closer", async () => {
      const samTile = 5 as TileRef;
      const dpTile = 20 as TileRef;
      const samUnit = makeUnit(10, UnitType.SAMLauncher, PLAYER_ID, samTile);
      const defensePost = makeUnit(1, UnitType.DefensePost, PLAYER_ID, dpTile);
      const buildableUnits = [
        { type: UnitType.SAMLauncher, canUpgrade: 10 },
        { type: UnitType.DefensePost, canUpgrade: 1 },
      ];
      const distMap = new Map<TileRef, number>([
        [samTile, 2],
        [dpTile, 10],
      ]);
      const { runner, emitSpy } = makeRunner(
        buildableUnits,
        [samUnit, defensePost],
        [],
        distMap,
      );

      await runner.findAndUpgradeNearestBuilding(TILE);

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({ unitId: 10, unitType: UnitType.SAMLauncher }),
      );
    });
  });
});
