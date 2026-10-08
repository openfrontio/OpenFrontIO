import { GameMap } from "@openfront/engine-api/game/GameMap";
import { GameConfig, GameConfigSchema } from "@openfront/engine-api/Schemas";
import { z } from "zod";
import { GameMapImpl, GameMapSnapshot } from "../game/GameMapImpl";
import { decodeSnapshotValue } from "./SnapshotCodec";
import {
  readVersioned,
  SnapshotError,
  snapshotType,
  VersionedSchema,
  zInt,
  zTiles,
} from "./SnapshotType";

export const SNAPSHOT_MAGIC = "OpenFrontGameSnapshot";

/**
 * Version of the root layout below. Everything inside it carries its own
 * record version, so this only moves when the root itself changes.
 */
export const SNAPSHOT_FORMAT_VERSION = 1;

export const ExecRecordSchema = z.object({
  t: z.string(),
  v: z.number().int(),
  d: z.unknown(),
});

export const RootSchema = z.object({
  magic: z.literal(SNAPSHOT_MAGIC),
  format: z.number().int(),
  /** Build that wrote the snapshot. Informational: any build can read it. */
  gitCommit: z.string(),
  gameID: z.string().nullable(),
  tick: z.number().int(),
  gameConfig: z.unknown(),
  game: VersionedSchema,
  map: VersionedSchema,
  miniMap: VersionedSchema,
  players: z.array(VersionedSchema),
  units: z.array(VersionedSchema),
  attacks: z.array(VersionedSchema),
  alliances: z.array(VersionedSchema),
  allianceRequests: z.array(VersionedSchema),
  stations: z.array(VersionedSchema),
  railroads: z.array(VersionedSchema),
  clusters: z.array(VersionedSchema),
  execs: z.array(ExecRecordSchema),
});
export type Root = z.infer<typeof RootSchema>;

export function decodeRoot(bytes: Uint8Array): Root {
  let raw: unknown;
  try {
    raw = decodeSnapshotValue(bytes);
  } catch (e) {
    throw new SnapshotError(`not a game snapshot: ${String(e)}`);
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { magic?: unknown }).magic !== SNAPSHOT_MAGIC
  ) {
    throw new SnapshotError("not a game snapshot");
  }
  const format = (raw as { format?: unknown }).format;
  if (typeof format !== "number" || format > SNAPSHOT_FORMAT_VERSION) {
    throw new SnapshotError(
      `snapshot format ${String(format)} is newer than this build supports (${SNAPSHOT_FORMAT_VERSION})`,
    );
  }
  const root = RootSchema.safeParse(raw);
  if (!root.success) {
    throw new SnapshotError(`malformed snapshot: ${root.error.message}`);
  }
  return root.data;
}

export function readStartTick(d: unknown): number | null {
  if (typeof d !== "object" || d === null) return null;
  const v = (d as { startTick?: unknown }).startTick;
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

export interface SnapshotHeader {
  format: number;
  gitCommit: string;
  gameID: string | null;
  tick: number;
  gameConfig: GameConfig;
  startTick?: number | null;
}

/** Reads what a restore needs to load first: the config and the map. */
export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader {
  const root = decodeRoot(bytes);
  return {
    format: root.format,
    gitCommit: root.gitCommit,
    gameID: root.gameID,
    tick: root.tick,
    gameConfig: GameConfigSchema.parse(root.gameConfig),
    startTick: readStartTick(root.game?.d),
  };
}

const PlayerTilesSnapshot = snapshotType({
  name: "Player",
  version: 1,
  schema: z
    .object({
      smallID: zInt(),
      info: z.object({
        id: z.string(),
      }),
      tiles: zTiles(),
    })
    .passthrough(),
});

/**
 * Restores map edits (water nukes, fallout, defense) and tile ownership from a
 * snapshot onto freshly loaded map instances. Used on the client so GameView's
 * local maps match the simulation state without waiting for per-tile deltas.
 */
export function restoreMapsFromSnapshot(
  bytes: Uint8Array,
  gameMap: GameMap,
  miniGameMap?: GameMap,
): void {
  const root = decodeRoot(bytes);
  (gameMap as GameMapImpl).restoreSnapshot(
    readVersioned(GameMapSnapshot, root.map),
  );
  if (miniGameMap) {
    (miniGameMap as GameMapImpl).restoreSnapshot(
      readVersioned(GameMapSnapshot, root.miniMap),
    );
  }
  const players = root.players.map((p) =>
    readVersioned(PlayerTilesSnapshot, p),
  );
  for (const p of players) {
    const id = p.smallID;
    const tiles = p.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      if (!gameMap.isValidRef(tile)) {
        throw new SnapshotError(
          `invalid tile ref ${tile} for player ${p.info.id}`,
        );
      }
      gameMap.setOwnerID(tile, id);
    }
  }
}
