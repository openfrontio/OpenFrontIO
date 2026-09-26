/**
 * Field tables for serializing PlayerState and UnitState. The encoder and
 * decoder both walk these tables, so each field is declared in one place.
 *
 * Each field gets one bit in a u32 change mask (its index in the table). A
 * field can cover several keys that always change together (trainType and
 * loaded, for example), and all of them are written when any one changes.
 *
 * Numbers that change a lot (tiles, gold, troops) use COUNTER. Integers are
 * written as a varint of the change, anything else as a full f64. Every
 * value comes back exactly.
 */

import type {
  AllianceData,
  AttackData,
  EmojiData,
  PlayerState,
  UnitState,
} from "../../render/types";
import { BinaryReader } from "./BinaryReader";
import { BinaryWriter, unzigzag, zigzag } from "./BinaryWriter";

export interface EncodeCtx {
  /** Index of a unit type string in the file's unit-type dictionary. */
  unitTypeIndex(unitType: string): number;
}

export interface DecodeCtx {
  unitTypes: readonly string[];
}

// ---------------------------------------------------------------------------
// Value codecs
// ---------------------------------------------------------------------------

interface ValueCodec<V> {
  /** `prev` is undefined for a full write (keyframe or new entity). */
  write(w: BinaryWriter, v: V, prev: V | undefined, ctx: EncodeCtx): void;
  /** `prev` is undefined for a full read, else the previously decoded value. */
  read(r: BinaryReader, prev: V | undefined, ctx: DecodeCtx): V;
  eq(a: V, b: V): boolean;
}

const same = <V>(a: V, b: V) => a === b;

const BOOL: ValueCodec<boolean> = {
  write: (w, v) => w.writeU8(v ? 1 : 0),
  read: (r) => r.readU8() === 1,
  eq: same,
};

const U8: ValueCodec<number> = {
  write: (w, v) => w.writeU8(v),
  read: (r) => r.readU8(),
  eq: same,
};

const U16: ValueCodec<number> = {
  write: (w, v) => w.writeU16(v),
  read: (r) => r.readU16(),
  eq: same,
};

const U32: ValueCodec<number> = {
  write: (w, v) => w.writeU32(v),
  read: (r) => r.readU32(),
  eq: same,
};

const I32: ValueCodec<number> = {
  write: (w, v) => w.writeI32(v),
  read: (r) => r.readI32(),
  eq: same,
};

const F64: ValueCodec<number> = {
  write: (w, v) => w.writeF64(v),
  read: (r) => r.readF64(),
  eq: same,
};

/**
 * A number that changes often. An integer is written as a varint of its
 * change (from 0 in a full write), shifted left one bit. Anything else is
 * the escape (a varint 1) and a full f64.
 */
export const COUNTER: ValueCodec<number> = {
  write(w, v, prev) {
    const d = v - (prev ?? 0);
    if (
      Number.isSafeInteger(v) &&
      Number.isSafeInteger(d) &&
      Math.abs(d) <= 2 ** 50
    ) {
      w.writeVarUint(zigzag(d) * 2);
    } else {
      w.writeVarUint(1);
      w.writeF64(v);
    }
  },
  read(r, prev) {
    const z = r.readVarUint();
    return z === 1 ? r.readF64() : (prev ?? 0) + unzigzag(z / 2);
  },
  eq: same,
};

const STRING: ValueCodec<string> = {
  write: (w, v) => w.writeShortString(v),
  read: (r) => r.readShortString(),
  eq: same,
};

/** A presence byte, then the value. `empty` is null or undefined. */
function maybe<V, E extends null | undefined>(
  inner: ValueCodec<V>,
  empty: E,
): ValueCodec<V | E> {
  return {
    write(w, v, _prev, ctx) {
      if (v === empty || v === undefined || v === null) {
        w.writeU8(0);
      } else {
        w.writeU8(1);
        inner.write(w, v as V, undefined, ctx);
      }
    },
    read(r, _prev, ctx) {
      return r.readU8() === 1 ? inner.read(r, undefined, ctx) : empty;
    },
    eq: (a, b) =>
      a === b || (a !== empty && b !== empty && inner.eq(a as V, b as V)),
  };
}

/** Count-prefixed list (u16 count). */
function list<V>(inner: ValueCodec<V>): ValueCodec<V[]> {
  return {
    write(w, v, _prev, ctx) {
      w.writeU16(v.length);
      for (const item of v) inner.write(w, item, undefined, ctx);
    },
    read(r, _prev, ctx) {
      const n = r.readU16();
      const out: V[] = new Array(n);
      for (let i = 0; i < n; i++) out[i] = inner.read(r, undefined, ctx);
      return out;
    },
    eq(a, b) {
      if (a === b) return true;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++)
        if (!inner.eq(a[i], b[i])) return false;
      return true;
    },
  };
}

/** An object with fixed keys, written in declaration order. */
function struct<S extends object>(parts: {
  [K in keyof S]: ValueCodec<S[K]>;
}): ValueCodec<S> {
  const entries = Object.entries(parts) as [keyof S, ValueCodec<unknown>][];
  return {
    write(w, v, _prev, ctx) {
      for (const [k, c] of entries) c.write(w, v[k], undefined, ctx);
    },
    read(r, _prev, ctx) {
      const out = {} as S;
      for (const [k, c] of entries)
        out[k] = c.read(r, undefined, ctx) as S[typeof k];
      return out;
    },
    eq(a, b) {
      if (a === b) return true;
      for (const [k, c] of entries) if (!c.eq(a[k], b[k])) return false;
      return true;
    },
  };
}

const ATTACK = struct<AttackData>({
  attackerID: U16,
  targetID: U16,
  troops: F64,
  id: STRING,
  retreating: BOOL,
});

/**
 * A player's attack list. Attacks go on for many ticks, and on most of
 * them only the troop count changes, so a delta writes each attack as a
 * varint tag: 0 for a full write, or 1 + the index of the same attack in
 * the previous list, followed by its troops as a COUNTER from there.
 */
const ATTACKS: ValueCodec<AttackData[]> = {
  write(w, v, prev, ctx) {
    w.writeU16(v.length);
    for (const a of v) {
      const i = prev === undefined ? -1 : sameAttackIndex(prev, a);
      if (i === -1) {
        w.writeVarUint(0);
        ATTACK.write(w, a, undefined, ctx);
      } else {
        w.writeVarUint(i + 1);
        COUNTER.write(w, a.troops, prev![i].troops, ctx);
      }
    }
  },
  read(r, prev, ctx) {
    const n = r.readU16();
    const out: AttackData[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const tag = r.readVarUint();
      if (tag === 0) {
        out[i] = ATTACK.read(r, undefined, ctx);
      } else {
        const before = prev?.[tag - 1];
        if (before === undefined) throw new Error(`no previous attack ${tag}`);
        out[i] = { ...before, troops: COUNTER.read(r, before.troops, ctx) };
      }
    }
    return out;
  },
  eq: list(ATTACK).eq,
};

/** Where `a` is in `prev`, if nothing but its troops changed; else -1. */
function sameAttackIndex(prev: readonly AttackData[], a: AttackData): number {
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    if (
      p.id === a.id &&
      p.attackerID === a.attackerID &&
      p.targetID === a.targetID &&
      p.retreating === a.retreating
    ) {
      return i;
    }
  }
  return -1;
}

const ALLIANCE = struct<AllianceData>({
  id: U32,
  other: STRING,
  createdAt: U32,
  expiresAt: U32,
  hasExtensionRequest: BOOL,
});

const ALL_PLAYERS_RECIPIENT = 0xffff;
const EMOJI_RECIPIENT: ValueCodec<number | "AllPlayers"> = {
  write: (w, v) => w.writeU16(v === "AllPlayers" ? ALL_PLAYERS_RECIPIENT : v),
  read: (r) => {
    const v = r.readU16();
    return v === ALL_PLAYERS_RECIPIENT ? "AllPlayers" : v;
  },
  eq: same,
};

const EMOJI = struct<EmojiData>({
  message: STRING,
  senderID: U16,
  recipientID: EMOJI_RECIPIENT,
  createdAt: U32,
});

/** `false` (not marked) or the tick the unit was marked for deletion. */
const MARKED_FOR_DELETION: ValueCodec<number | false> = {
  write: (w, v) => w.writeI32(v === false ? -1 : v),
  read: (r) => {
    const v = r.readI32();
    return v === -1 ? false : v;
  },
  eq: same,
};

/** A unit type, stored as its index in the file's unit type dictionary. */
const UNIT_TYPE: ValueCodec<string> = {
  write: (w, v, _prev, ctx) => w.writeU8(ctx.unitTypeIndex(v)),
  read: (r, _prev, ctx) => {
    const idx = r.readU8();
    const t = ctx.unitTypes[idx];
    if (t === undefined) throw new Error(`unknown unit type index ${idx}`);
    return t;
  },
  eq: same,
};

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export interface FieldDef<T> {
  /** Keys this field covers (usually one). */
  readonly keys: readonly (keyof T)[];
  write(w: BinaryWriter, curr: T, prev: T | null, ctx: EncodeCtx): void;
  /** Read into `target`, which holds the previous values on a delta read. */
  read(r: BinaryReader, target: T, isDelta: boolean, ctx: DecodeCtx): void;
  changed(prev: T, curr: T): boolean;
}

type Part<T> = { [K in keyof T]: [K, ValueCodec<T[K]>] }[keyof T];

function field<T>(...parts: Part<T>[]): FieldDef<T> {
  const ps = parts as [keyof T, ValueCodec<unknown>][];
  return {
    keys: ps.map(([k]) => k),
    write(w, curr, prev, ctx) {
      for (const [k, c] of ps) {
        c.write(w, curr[k], prev?.[k], ctx);
      }
    },
    read(r, target, isDelta, ctx) {
      for (const [k, c] of ps) {
        target[k] = c.read(
          r,
          isDelta ? target[k] : undefined,
          ctx,
        ) as T[keyof T];
      }
    },
    changed(prev, curr) {
      for (const [k, c] of ps) if (!c.eq(prev[k], curr[k])) return true;
      return false;
    },
  };
}

/**
 * A unit's pos and lastPos. lastPos is almost always the previous pos (a
 * unit that moved, or one that stopped), so a delta packs the change of pos
 * and whether that's the case into one varint, and only writes lastPos when
 * it isn't. A full write has pos, then lastPos relative to it.
 */
const POSITION: FieldDef<UnitFields> = {
  keys: ["pos", "lastPos"],
  write(w, curr, prev) {
    const usual = prev !== null && curr.lastPos === prev.pos;
    if (prev === null) w.writeVarUint(curr.pos);
    else w.writeVarUint(zigzag(curr.pos - prev.pos) * 2 + (usual ? 0 : 1));
    if (!usual) w.writeVarInt(curr.lastPos - curr.pos);
  },
  read(r, target, isDelta) {
    const prevPos = target.pos;
    const z = r.readVarUint();
    target.pos = isDelta ? prevPos + unzigzag(Math.floor(z / 2)) : z;
    target.lastPos =
      isDelta && z % 2 === 0 ? prevPos : target.pos + r.readVarInt();
  },
  changed: (prev, curr) =>
    prev.pos !== curr.pos || prev.lastPos !== curr.lastPos,
};

export type PlayerFields = Omit<PlayerState, "smallID">;
export type UnitFields = Omit<UnitState, "id" | "constructionStartTick">;

/** Only append. Reordering changes the format (bump REPLAY_VERSION). */
export const PLAYER_FIELDS: readonly FieldDef<PlayerFields>[] = [
  field(["isAlive", BOOL]),
  field(["isDisconnected", BOOL]),
  field(["killedBy", maybe(STRING, null)]),
  field(["deathPosition", maybe(U32, null)]),
  field(["tilesOwned", COUNTER]),
  field(["gold", COUNTER]),
  field(["tradeGold", COUNTER]),
  field(["trainGold", COUNTER]),
  field(["piracyGold", COUNTER]),
  field(["goldEarned", COUNTER]),
  field(["troops", COUNTER]),
  field(["isTraitor", BOOL]),
  field(["traitorRemainingTicks", U32]),
  field(["inDoomsdayClock", BOOL]),
  field(["isDecaying", BOOL]),
  field(["markedDoomsdayClockTick", I32]),
  field(["betrayals", U16]),
  field(["hasSpawned", BOOL]),
  field(["spawnTile", maybe(U32, undefined)]),
  field(["lastDeleteUnitTick", I32]),
  field(["allies", list(U16)]),
  field(["embargoes", list(U16)]),
  field(["targets", list(U16)]),
  field(["outgoingAttacks", ATTACKS]),
  field(["incomingAttacks", ATTACKS]),
  field(["outgoingAllianceRequests", list(STRING)]),
  field(["alliances", list(ALLIANCE)]),
  field(["outgoingEmojis", list(EMOJI)]),
];

export const UNIT_FIELDS: readonly FieldDef<UnitFields>[] = [
  field(["unitType", UNIT_TYPE]),
  field(["ownerID", U16]),
  field(["lastOwnerID", maybe(U16, null)]),
  POSITION,
  field(["isActive", BOOL]),
  field(["reachedTarget", BOOL]),
  field(["retreating", BOOL]),
  field(["targetable", BOOL]),
  field(["waitTicks", U32]),
  field(["markedForDeletion", MARKED_FOR_DELETION]),
  field(["health", maybe(F64, null)]),
  field(["underConstruction", BOOL]),
  field(["targetUnitId", maybe(U32, null)]),
  field(["targetTile", maybe(U32, null)]),
  field(["troops", COUNTER]),
  field(["missileTimerQueue", list(U32)]),
  field(["level", U16]),
  field(["veterancy", COUNTER]),
  field(["hasTrainStation", BOOL]),
  field(["trainType", maybe(U8, null)], ["loaded", maybe(BOOL, null)]),
  field(
    ["samUpgradeStartTick", maybe(F64, null)],
    ["samUpgradeStartRange", maybe(F64, null)],
    ["samUpgradeTargetLevel", maybe(F64, null)],
    ["samUpgradeDuration", maybe(F64, null)],
  ),
];

for (const [name, schema] of [
  ["PLAYER_FIELDS", PLAYER_FIELDS],
  ["UNIT_FIELDS", UNIT_FIELDS],
] as const) {
  if (schema.length > 32) {
    throw new Error(`${name} has ${schema.length} fields; the mask is u32`);
  }
}

// ---------------------------------------------------------------------------
// Schema-driven operations
// ---------------------------------------------------------------------------

/** Bitmask of fields that differ between `prev` and `curr`. */
export function diffFields<T>(
  schema: readonly FieldDef<T>[],
  prev: T,
  curr: T,
): number {
  let mask = 0;
  for (let i = 0; i < schema.length; i++) {
    if (schema[i].changed(prev, curr)) mask |= 1 << i;
  }
  return mask >>> 0;
}

export function writeEntityFull<T>(
  w: BinaryWriter,
  schema: readonly FieldDef<T>[],
  entity: T,
  ctx: EncodeCtx,
): void {
  for (const f of schema) f.write(w, entity, null, ctx);
}

export function readEntityFull<T>(
  r: BinaryReader,
  schema: readonly FieldDef<T>[],
  target: T,
  ctx: DecodeCtx,
): T {
  for (const f of schema) f.read(r, target, false, ctx);
  return target;
}

export function writeEntityDelta<T>(
  w: BinaryWriter,
  schema: readonly FieldDef<T>[],
  mask: number,
  curr: T,
  prev: T,
  ctx: EncodeCtx,
): void {
  w.writeVarUint(mask >>> 0);
  for (let i = 0; i < schema.length; i++) {
    if (mask & (1 << i)) schema[i].write(w, curr, prev, ctx);
  }
}

/** Apply a delta onto `target` (which must hold the previous state). */
export function readEntityDelta<T>(
  r: BinaryReader,
  schema: readonly FieldDef<T>[],
  target: T,
  ctx: DecodeCtx,
): T {
  const mask = r.readVarUint();
  for (let i = 0; i < schema.length; i++) {
    if (mask & (1 << i)) schema[i].read(r, target, true, ctx);
  }
  return target;
}
