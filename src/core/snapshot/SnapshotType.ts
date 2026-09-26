import { z } from "zod";

/**
 * Migrates one record from version `n` (the key it is registered under) to
 * version `n + 1`. Receives and returns plain decoded data.
 */
export type Migration = (data: any) => any;

/**
 * A versioned record layout. Every object a snapshot stores (the game, each
 * player, unit, execution, ...) is written under one of these, as
 * `{ v: version, d: data }`.
 *
 * Changing the layout of `d` means bumping `version` and adding a migration
 * from the previous version, so snapshots written by older builds keep
 * loading. The schema validates the fully migrated data.
 */
export interface SnapshotType<S> {
  readonly name: string;
  readonly version: number;
  readonly schema: z.ZodType<S>;
  readonly migrations: Readonly<Record<number, Migration>>;
}

export function snapshotType<T extends z.ZodType>(def: {
  name: string;
  version: number;
  schema: T;
  migrations?: Record<number, Migration>;
}): SnapshotType<z.output<T>> {
  const migrations = def.migrations ?? {};
  for (let v = 1; v < def.version; v++) {
    if (migrations[v] === undefined) {
      throw new Error(
        `snapshot type ${def.name} is at version ${def.version} but has no migration from version ${v}`,
      );
    }
  }
  return {
    name: def.name,
    version: def.version,
    schema: def.schema as z.ZodType<z.output<T>>,
    migrations,
  };
}

export interface Versioned {
  v: number;
  d: unknown;
}

export const VersionedSchema = z.object({
  v: z.number().int(),
  d: z.unknown(),
});

export class SnapshotError extends Error {
  override readonly name = "SnapshotError";
}

export function writeVersioned<S>(type: SnapshotType<S>, data: S): Versioned {
  return { v: type.version, d: data };
}

/** Migrates a stored record up to the current version and validates it. */
export function readVersioned<S>(type: SnapshotType<S>, raw: unknown): S {
  const rec = VersionedSchema.safeParse(raw);
  if (!rec.success) {
    throw new SnapshotError(`${type.name}: malformed record`);
  }
  let { v, d } = rec.data;
  if (v > type.version) {
    throw new SnapshotError(
      `${type.name}: record version ${v} is newer than this build supports (${type.version})`,
    );
  }
  while (v < type.version) {
    const migrate = type.migrations[v];
    if (migrate === undefined) {
      throw new SnapshotError(`${type.name}: no migration from version ${v}`);
    }
    d = migrate(d);
    v++;
  }
  const parsed = type.schema.safeParse(d);
  if (!parsed.success) {
    throw new SnapshotError(
      `${type.name} v${v}: invalid data: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

// Shared field schemas.

/** Integer that fits a snapshot varint. */
export const zInt = () => z.number().int();
/** A number that may be fractional or non-finite (stored as float64). */
export const zNum = () =>
  z.custom<number>((v) => typeof v === "number", "expected a number");
export const zTile = () => z.number().int().nonnegative();
export const zTiles = () =>
  z.custom<Uint32Array>((v) => v instanceof Uint32Array, "expected tiles");
export const zBytes = () =>
  z.custom<Uint8Array>((v) => v instanceof Uint8Array, "expected bytes");
export const zU16Array = () =>
  z.custom<Uint16Array>((v) => v instanceof Uint16Array, "expected u16s");
/** sfc32 state words, see PseudoRandom.getState. */
export const zRandom = () => z.tuple([zInt(), zInt(), zInt(), zInt()]);
/** A reference to a row of one of the snapshot's object tables. */
export const zRef = () => z.number().int().nonnegative();
/** A player's small id; 0 is terra nullius. */
export const zPlayerRef = () => z.number().int().nonnegative();
