import { describe, expect, it } from "vitest";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType, UnitUpdate } from "@openfront/engine-api/game/GameUpdates";
import {
  PackedUnitUpdateDecoder,
  packUnitUpdates as packUnitUpdatesFn,
} from "@openfront/engine/game/PackedUnitUpdates";

describe("PackedUnitUpdates", () => {
  it("packs and unpacks a complex UnitUpdate without fidelity loss", () => {
    const original: UnitUpdate = {
      type: GameUpdateType.Unit,
      unitType: UnitType.Warship,
      troops: 1500,
      id: 42,
      ownerID: 7,
      lastOwnerID: 3,
      pos: 100,
      lastPos: 99,
      isActive: true,
      reachedTarget: false,
      targetable: true,
      markedForDeletion: false,
      targetUnitId: undefined,
      targetTile: undefined,
      health: 120,
      underConstruction: true,
      level: 5,
      hasTrainStation: false,
      trainType: undefined,
      loaded: undefined,
      missileTimerQueue: [1000, 1200],
      warshipState: {
        state: "patrolling",
        patrolTile: 120,
        retreatPort: undefined,
        isInCombat: true,
        lastCombatTick: 900,
        veterancy: 3,
        veterancyProgress: 15,
      },
      transportShipState: undefined,
      nukeState: undefined,
      samUpgrade: undefined,
    };

    const { packedUnitUpdates, packedMissileTimers } = packUnitUpdatesFn([original]);

    const decoder = new PackedUnitUpdateDecoder(packedUnitUpdates, 0);
    const unpacked = decoder.toUnitUpdate();
    unpacked.missileTimerQueue = original.missileTimerQueue;

    expect(unpacked).toEqual(original);
  });

  it("packs and unpacks a complex UnitUpdate with samUpgrade", () => {
    const original: UnitUpdate = {
      type: GameUpdateType.Unit,
      unitType: UnitType.SAMLauncher,
      troops: 1500,
      id: 42,
      ownerID: 7,
      lastOwnerID: 3,
      pos: 100,
      lastPos: 99,
      isActive: true,
      reachedTarget: false,
      targetable: true,
      markedForDeletion: false,
      targetUnitId: undefined,
      targetTile: undefined,
      health: 120,
      underConstruction: true,
      level: 5,
      hasTrainStation: false,
      trainType: undefined,
      loaded: undefined,
      missileTimerQueue: [1000, 1200],
      samUpgrade: {
        upgradeStartTick: undefined,
        startRange: 10,
        targetLevel: 3,
        duration: 100,
      },
    };

    const { packedUnitUpdates } = packUnitUpdatesFn([original]);
    const decoder = new PackedUnitUpdateDecoder(packedUnitUpdates, 0);
    const unpacked = decoder.toUnitUpdate();
    unpacked.missileTimerQueue = original.missileTimerQueue;

    expect(unpacked).toEqual(original);
  });

  it("packs and unpacks a nuke UnitUpdate", () => {
    const original: UnitUpdate = {
      type: GameUpdateType.Unit,
      unitType: UnitType.AtomBomb,
      troops: 0,
      id: 99,
      ownerID: 1,
      lastOwnerID: undefined,
      pos: 50,
      lastPos: 49,
      isActive: false,
      reachedTarget: true,
      targetable: false,
      markedForDeletion: 5000,
      targetUnitId: undefined,
      targetTile: 100,
      health: undefined,
      underConstruction: false,
      level: 1,
      hasTrainStation: false,
      trainType: undefined,
      loaded: undefined,
      missileTimerQueue: [],
      nukeState: {
        targetedBySam: true,
        waitTicks: 10,
      }
    };

    const { packedUnitUpdates, packedMissileTimers } = packUnitUpdatesFn([original]);

    const decoder = new PackedUnitUpdateDecoder(packedUnitUpdates, 0);
    const unpacked = decoder.toUnitUpdate();
    unpacked.missileTimerQueue = original.missileTimerQueue;

    expect(unpacked).toEqual(original);
  });
});
