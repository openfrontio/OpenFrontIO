/**
 * Field-level schema tests: every PlayerState / UnitState key must be
 * encoded, detected as changed on its own bit, and round-trip exactly in
 * both full and delta form (in both directions, so value↔null transitions
 * are covered).
 */

import type {
  PlayerState,
  UnitState,
} from "../../../../src/client/render/types";
import { BinaryReader } from "../../../../src/client/replay/codec/BinaryReader";
import { BinaryWriter } from "../../../../src/client/replay/codec/BinaryWriter";
import {
  COUNTER,
  PLAYER_FIELDS,
  UNIT_FIELDS,
  diffFields,
  readEntityDelta,
  readEntityFull,
  writeEntityDelta,
  writeEntityFull,
  type DecodeCtx,
  type EncodeCtx,
  type FieldDef,
  type PlayerFields,
  type UnitFields,
} from "../../../../src/client/replay/codec/EntitySchema";

const unitTypes = ["City", "Warship", "Train"];
const encodeCtx: EncodeCtx = { unitTypeIndex: (t) => unitTypes.indexOf(t) };
const decodeCtx: DecodeCtx = { unitTypes };

// Typed as the full renderer records: a new required field fails to
// compile here, and the completeness test below then demands a schema entry.
const basePlayer: PlayerState = {
  smallID: 7,
  isAlive: true,
  isDisconnected: false,
  killedBy: null,
  deathPosition: null,
  tilesOwned: 1200,
  gold: 50_000,
  tradeGold: 100,
  trainGold: 200,
  piracyGold: 0,
  goldEarned: 90_000,
  troops: 25_000,
  isTraitor: false,
  traitorRemainingTicks: 0,
  inDoomsdayClock: false,
  isDecaying: false,
  markedDoomsdayClockTick: -1,
  betrayals: 0,
  hasSpawned: true,
  spawnTile: 4242,
  lastDeleteUnitTick: -1,
  allies: [3],
  embargoes: [],
  targets: [],
  outgoingAttacks: [],
  incomingAttacks: [],
  outgoingAllianceRequests: [],
  alliances: [],
  outgoingEmojis: [],
};

const playerAlternatives: { [K in keyof PlayerFields]: PlayerFields[K] } = {
  isAlive: false,
  isDisconnected: true,
  killedBy: "client_abc",
  deathPosition: 123_456,
  tilesOwned: 1205,
  gold: 50_000.5, // fractional → f64 escape
  tradeGold: 100 + 40_000, // beyond i16 → f64 escape
  trainGold: 150, // negative delta
  piracyGold: 2 ** 40, // huge
  goldEarned: 95_000,
  troops: 24_990,
  isTraitor: true,
  traitorRemainingTicks: 300,
  inDoomsdayClock: true,
  isDecaying: true,
  markedDoomsdayClockTick: 9000,
  betrayals: 2,
  hasSpawned: false,
  spawnTile: undefined,
  lastDeleteUnitTick: 70_000,
  allies: [],
  embargoes: [1, 2, 900],
  targets: [5],
  outgoingAttacks: [
    {
      attackerID: 7,
      targetID: 3,
      troops: 1234.5,
      id: "atk1",
      retreating: false,
    },
  ],
  incomingAttacks: [
    { attackerID: 3, targetID: 7, troops: 99, id: "atk2", retreating: true },
  ],
  outgoingAllianceRequests: ["player_9"],
  alliances: [
    {
      id: 11,
      other: "player_3",
      createdAt: 100,
      expiresAt: 3100,
      hasExtensionRequest: true,
    },
  ],
  outgoingEmojis: [
    { message: "🤝", senderID: 7, recipientID: "AllPlayers", createdAt: 55 },
    { message: "💀", senderID: 7, recipientID: 3, createdAt: 56 },
  ],
};

const baseUnit: UnitState = {
  id: 99,
  unitType: "Warship",
  ownerID: 7,
  lastOwnerID: null,
  pos: 1000,
  lastPos: 999,
  isActive: true,
  reachedTarget: false,
  retreating: false,
  targetable: true,
  waitTicks: 0,
  markedForDeletion: false,
  health: 1000,
  underConstruction: false,
  targetUnitId: null,
  targetTile: null,
  troops: 0,
  missileTimerQueue: [],
  level: 1,
  veterancy: 0,
  hasTrainStation: false,
  trainType: null,
  loaded: null,
  constructionStartTick: null,
  samUpgradeStartTick: null,
  samUpgradeStartRange: null,
  samUpgradeTargetLevel: null,
  samUpgradeDuration: null,
};

const unitAlternatives: { [K in keyof UnitFields]: UnitFields[K] } = {
  unitType: "Train",
  ownerID: 8,
  lastOwnerID: 7,
  pos: 4_000_000,
  lastPos: 1000,
  isActive: false,
  reachedTarget: true,
  retreating: true,
  targetable: false,
  waitTicks: 12,
  markedForDeletion: 5000,
  health: null,
  underConstruction: true,
  targetUnitId: 12,
  targetTile: 77,
  troops: 3_000_000,
  missileTimerQueue: [100_000, 100_050],
  level: 3,
  veterancy: 2,
  hasTrainStation: true,
  trainType: 2,
  loaded: true,
  samUpgradeStartTick: 400,
  samUpgradeStartRange: 70.5,
  samUpgradeTargetLevel: 2,
  samUpgradeDuration: 150,
};

function roundTripFull<T>(
  schema: readonly FieldDef<T>[],
  value: T,
  seed: T,
): T {
  const w = new BinaryWriter(256);
  writeEntityFull(w, schema, value, encodeCtx);
  const r = new BinaryReader(w.finish());
  const out = readEntityFull(r, schema, { ...seed }, decodeCtx);
  expect(r.offset).toBe(r.length);
  return out;
}

function roundTripDelta<T>(
  schema: readonly FieldDef<T>[],
  prev: T,
  curr: T,
): T {
  const w = new BinaryWriter(256);
  writeEntityDelta(
    w,
    schema,
    diffFields(schema, prev, curr),
    curr,
    prev,
    encodeCtx,
  );
  const r = new BinaryReader(w.finish());
  const out = readEntityDelta(r, schema, { ...prev }, decodeCtx);
  expect(r.offset).toBe(r.length);
  return out;
}

function describeSchema<T extends object>(
  name: string,
  schema: readonly FieldDef<T>[],
  base: T,
  alternatives: { [K in keyof T]?: T[K] },
  identityKeys: string[],
) {
  describe(name, () => {
    test("covers every renderer field exactly once", () => {
      const schemaKeys = schema.flatMap((f) => f.keys.map(String));
      expect(new Set(schemaKeys).size).toBe(schemaKeys.length);
      const recordKeys = Object.keys(base).filter(
        (k) => !identityKeys.includes(k),
      );
      expect(schemaKeys.sort()).toEqual(recordKeys.sort());
    });

    test("identical records have an empty diff and round-trip in full", () => {
      expect(diffFields(schema, base, { ...base })).toBe(0);
      expect(roundTripFull(schema, base, base)).toEqual(base);
    });

    const keys = Object.keys(alternatives) as (keyof T)[];
    test.each(keys.map((k) => [String(k), k] as const))(
      "%s: own bit, full and delta round-trip both ways",
      (_label, key) => {
        const changed = { ...base, [key]: alternatives[key] } as T;
        const bit = schema.findIndex((f) => f.keys.includes(key));
        expect(bit).toBeGreaterThanOrEqual(0);
        expect(diffFields(schema, base, changed)).toBe((1 << bit) >>> 0);
        expect(roundTripFull(schema, changed, base)).toEqual(changed);
        expect(roundTripDelta(schema, base, changed)).toEqual(changed);
        expect(roundTripDelta(schema, changed, base)).toEqual(base);
      },
    );

    test("every field changed at once round-trips", () => {
      const all = { ...base, ...alternatives } as T;
      expect(diffFields(schema, base, all)).toBe(
        schema.length === 32 ? 0xffffffff : (2 ** schema.length - 1) >>> 0,
      );
      expect(roundTripDelta(schema, base, all)).toEqual(all);
      expect(roundTripDelta(schema, all, base)).toEqual(base);
    });
  });
}

// constructionStartTick is derived at decode time from the ConstructionStarts
// section, not encoded per unit.
describeSchema(
  "PLAYER_FIELDS",
  PLAYER_FIELDS,
  basePlayer as PlayerFields,
  playerAlternatives,
  ["smallID"],
);
describeSchema(
  "UNIT_FIELDS",
  UNIT_FIELDS,
  baseUnit as UnitFields,
  unitAlternatives,
  ["id", "constructionStartTick"],
);

describe("COUNTER", () => {
  test.each([
    [undefined, 0],
    [undefined, 25_000],
    [undefined, 50_000.5],
    [0, 0],
    [10, -32767],
    [10, 32767 + 10],
    [5, 5.25],
    [1.5, 2.5],
    [0, Number.MAX_SAFE_INTEGER],
    [-(2 ** 50), 2 ** 52],
  ])("from %d to %d is exact", (prev, curr) => {
    const w = new BinaryWriter(32);
    COUNTER.write(w, curr, prev, encodeCtx);
    const r = new BinaryReader(w.finish());
    expect(COUNTER.read(r, prev, decodeCtx)).toBe(curr);
    expect(r.offset).toBe(r.length);
  });

  test.each([
    [1000, 1010, 1],
    [1_000_000, 1_100_000, 3], // a late-game gold income
    [1000, 1000.5, 9], // not an integer: escape and f64
  ])("from %d to %d takes %d bytes", (prev, curr, size) => {
    const w = new BinaryWriter(32);
    COUNTER.write(w, curr, prev, encodeCtx);
    expect(w.finish().length).toBe(size);
  });
});

describe("unit position", () => {
  const position = UNIT_FIELDS.find((f) => f.keys.includes("pos"))!;
  const prev = { ...baseUnit, pos: 5000, lastPos: 4999 } as UnitFields;
  test.each([
    ["a step east", 5001, 5000, 1],
    ["a row north on a 2100-wide map", 5000 - 2100, 5000, 2],
    ["stopping", 5000, 5000, 1],
    ["a jump with lastPos elsewhere", 4_000_000, 100, 8],
  ])("%s is exact in %d bytes", (_label, pos, lastPos, size) => {
    const curr = { ...prev, pos, lastPos };
    const w = new BinaryWriter(32);
    position.write(w, curr, prev, encodeCtx);
    expect(w.finish().length).toBe(size);
    const target = { ...prev };
    position.read(new BinaryReader(w.finish()), target, true, decodeCtx);
    expect([target.pos, target.lastPos]).toEqual([pos, lastPos]);
  });
});

describe("attack lists", () => {
  const attacks = PLAYER_FIELDS.find((f) =>
    f.keys.includes("outgoingAttacks"),
  )!;
  const atk = (id: string, troops: number, retreating = false) => ({
    attackerID: 7,
    targetID: 3,
    troops,
    id,
    retreating,
  });
  const prev = {
    ...basePlayer,
    outgoingAttacks: [atk("a", 5000), atk("b", 800)],
  } as PlayerFields;

  // In full, each of these attacks is 16 bytes.
  test.each([
    ["only troops changed", 6, [atk("a", 4990), atk("b", 790)]],
    ["one ended, one started", 21, [atk("b", 700), atk("c", 300)]],
    ["reordered", 6, [atk("b", 800), atk("a", 5000)]],
    ["a retreat is written in full", 18, [atk("a", 5000, true)]],
    ["troops that aren't whole", 12, [atk("a", 4999.5)]],
  ])("%s: exact in %d bytes", (_label, size, outgoingAttacks) => {
    const curr = { ...prev, outgoingAttacks } as PlayerFields;
    const w = new BinaryWriter(64);
    attacks.write(w, curr, prev, encodeCtx);
    expect(w.finish().length).toBe(size);
    const target = { ...prev };
    attacks.read(new BinaryReader(w.finish()), target, true, decodeCtx);
    expect(target.outgoingAttacks).toEqual(outgoingAttacks);
  });
});
