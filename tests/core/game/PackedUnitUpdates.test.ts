import { TrainType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  intToUnitType,
  PackedUnitUpdateDecoder,
  packUnitUpdates as packUnitUpdatesFn,
  unpackUnitUpdates as unpackUnitUpdatesFn,
  unitTypeToInt,
} from "@openfront/engine-lib/game/PackedUnitUpdates";
import { describe, expect, it } from "vitest";

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

    const { packedUnitUpdates } = packUnitUpdatesFn([original]);

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
      },
    };

    const { packedUnitUpdates } = packUnitUpdatesFn([original]);

    const decoder = new PackedUnitUpdateDecoder(packedUnitUpdates, 0);
    const unpacked = decoder.toUnitUpdate();
    unpacked.missileTimerQueue = original.missileTimerQueue;

    expect(unpacked).toEqual(original);
  });

  it("packs and unpacks unit levels >= 256 without 8-bit wrapping", () => {
    const levelsToTest = [255, 256, 257, 300, 1000];
    for (const level of levelsToTest) {
      const original: UnitUpdate = {
        type: GameUpdateType.Unit,
        unitType: UnitType.MissileSilo,
        troops: 0,
        id: 101,
        ownerID: 2,
        lastOwnerID: undefined,
        pos: 200,
        lastPos: 200,
        isActive: true,
        reachedTarget: false,
        targetable: true,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: undefined,
        health: 500,
        underConstruction: false,
        level,
        hasTrainStation: false,
        trainType: undefined,
        loaded: undefined,
        missileTimerQueue: [],
      };

      const { packedUnitUpdates } = packUnitUpdatesFn([original]);
      const decoder = new PackedUnitUpdateDecoder(packedUnitUpdates, 0);
      expect(decoder.level).toBe(level);

      const unpacked = decoder.toUnitUpdate();
      unpacked.missileTimerQueue = original.missileTimerQueue;
      expect(unpacked.level).toBe(level);
      expect(unpacked).toEqual(original);
    }
  });

  it("unpacks multiple units with variable-length timer queues, train types, and transport states", () => {
    const units: UnitUpdate[] = [
      {
        type: GameUpdateType.Unit,
        unitType: UnitType.MissileSilo,
        troops: 0,
        id: 10,
        ownerID: 1,
        lastOwnerID: undefined,
        pos: 100,
        lastPos: 100,
        isActive: true,
        reachedTarget: false,
        targetable: true,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: undefined,
        health: 200,
        underConstruction: false,
        level: 3,
        hasTrainStation: false,
        trainType: undefined,
        loaded: undefined,
        missileTimerQueue: [100, 200, 300],
      },
      {
        type: GameUpdateType.Unit,
        unitType: UnitType.Train,
        troops: 50,
        id: 20,
        ownerID: 1,
        lastOwnerID: undefined,
        pos: 105,
        lastPos: 104,
        isActive: true,
        reachedTarget: false,
        targetable: true,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: 120,
        health: undefined,
        underConstruction: false,
        level: 1,
        hasTrainStation: true,
        trainType: TrainType.Carriage,
        loaded: true,
        missileTimerQueue: [],
      },
      {
        type: GameUpdateType.Unit,
        unitType: UnitType.TransportShip,
        troops: 450,
        id: 30,
        ownerID: 2,
        lastOwnerID: undefined,
        pos: 200,
        lastPos: 199,
        isActive: true,
        reachedTarget: false,
        targetable: true,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: undefined,
        health: undefined,
        underConstruction: false,
        level: 1,
        hasTrainStation: false,
        trainType: undefined,
        loaded: undefined,
        missileTimerQueue: [],
        transportShipState: {
          isRetreating: true,
          troops: 450,
        },
      },
      {
        type: GameUpdateType.Unit,
        unitType: UnitType.MissileSilo,
        troops: 0,
        id: 40,
        ownerID: 2,
        lastOwnerID: undefined,
        pos: 250,
        lastPos: 250,
        isActive: true,
        reachedTarget: false,
        targetable: true,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: undefined,
        health: 300,
        underConstruction: false,
        level: 2,
        hasTrainStation: false,
        trainType: undefined,
        loaded: undefined,
        missileTimerQueue: [500],
      },
      {
        type: GameUpdateType.Unit,
        unitType: UnitType.Train,
        troops: 0,
        id: 50,
        ownerID: 2,
        lastOwnerID: undefined,
        pos: 260,
        lastPos: 259,
        isActive: false,
        reachedTarget: true,
        targetable: false,
        markedForDeletion: false,
        targetUnitId: undefined,
        targetTile: undefined,
        health: undefined,
        underConstruction: false,
        level: 1,
        hasTrainStation: false,
        trainType: TrainType.Engine,
        loaded: false,
        missileTimerQueue: [],
      },
    ];

    const { packedUnitUpdates, packedMissileTimers } = packUnitUpdatesFn(units);
    const unpacked = unpackUnitUpdatesFn(
      packedUnitUpdates,
      packedMissileTimers,
    );

    expect(unpacked).toHaveLength(units.length);
    expect(unpacked).toEqual(units);
  });

  it("throws on unknown unit type mapping in unitTypeToInt and intToUnitType", () => {
    expect(() =>
      unitTypeToInt("InvalidUnitType" as unknown as UnitType),
    ).toThrow(/Unknown UnitType/);
    expect(() => intToUnitType(0)).toThrow(/Unknown packed unit type int: 0/);
    expect(() => intToUnitType(999)).toThrow(
      /Unknown packed unit type int: 999/,
    );
  });
});
