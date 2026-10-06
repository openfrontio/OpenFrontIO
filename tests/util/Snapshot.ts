import { GameMap } from "@openfront/engine-api/game/GameMap";
import { MapManifest } from "@openfront/engine-api/game/GameMapLoader";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { TileSet } from "@openfront/engine-lib/game/TileSet";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { FlatBinaryHeap } from "@openfront/engine/execution/utils/FlatBinaryHeap";
import { Game } from "@openfront/engine/game/Game";
import { AStar } from "@openfront/engine/pathfinding/algorithms/AStar";
import { AbstractGraphAStar } from "@openfront/engine/pathfinding/algorithms/AStar.AbstractGraph";
import { AStarRail } from "@openfront/engine/pathfinding/algorithms/AStar.Rail";
import { AStarWater } from "@openfront/engine/pathfinding/algorithms/AStar.Water";
import { AStarWaterBounded } from "@openfront/engine/pathfinding/algorithms/AStar.WaterBounded";
import { AStarWaterHierarchical } from "@openfront/engine/pathfinding/algorithms/AStar.WaterHierarchical";
import { BFSGrid } from "@openfront/engine/pathfinding/algorithms/BFS.Grid";
import {
  BucketQueue,
  MinHeap,
} from "@openfront/engine/pathfinding/algorithms/PriorityQueue";
import { WaterPathMemo } from "@openfront/engine/pathfinding/PathFinder";
import {
  restoreGame,
  snapshotGame,
} from "@openfront/engine/snapshot/GameSnapshot";
import { decodeSnapshotValue } from "@openfront/engine/snapshot/SnapshotCodec";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TestConfig } from "./TestConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Loads a test map fresh (unshared), as setup() does. */
export async function loadTestMaps(
  mapName: string,
): Promise<{ gameMap: GameMap; miniGameMap: GameMap }> {
  const dir = path.join(__dirname, `../testdata/maps/${mapName}`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  ) satisfies MapManifest;
  return {
    gameMap: await genTerrainFromBin(
      manifest.map,
      fs.readFileSync(path.join(dir, "map.bin")),
    ),
    miniGameMap: await genTerrainFromBin(
      manifest.map4x,
      fs.readFileSync(path.join(dir, "map4x.bin")),
    ),
  };
}

/**
 * Restores a snapshot of a game built by tests/util/Setup on `mapName`, with
 * the given EngineConfig class (TestConfig and its variants override behavior).
 */
export async function restoreTestGame(
  bytes: Uint8Array,
  mapName: string,
  ConfigClass: typeof EngineConfig = TestConfig,
): Promise<Game> {
  const maps = await loadTestMaps(mapName);
  return restoreGame(bytes, {
    config: (gc) => new ConfigClass(gc, false),
    ...maps,
  });
}

/**
 * Snapshot, restore into a fresh game (with the same EngineConfig class as the
 * original), and return both with the bytes.
 */
export async function roundTrip(game: Game, mapName: string) {
  const bytes = snapshotGame(game);
  const restored = await restoreTestGame(
    bytes,
    mapName,
    game.config().constructor as typeof EngineConfig,
  );
  return { bytes, restored, again: snapshotGame(restored) };
}

/** Differences between two encoded snapshots, as paths into the data. */
export function diffSnapshots(a: Uint8Array, b: Uint8Array): string[] {
  if (bytesEqual(a, b)) return [];
  const diffs: string[] = [];
  const walk = (x: unknown, y: unknown, p: string): void => {
    if (diffs.length >= 20) return;
    if (typeof x !== "object" || x === null) {
      if (!Object.is(x, y)) diffs.push(`${p}: ${String(x)} !== ${String(y)}`);
      return;
    }
    if (typeof y !== "object" || y === null) {
      diffs.push(`${p}: object vs ${String(y)}`);
      return;
    }
    if (ArrayBuffer.isView(x) || Array.isArray(x)) {
      const xa = x as unknown as ArrayLike<unknown>;
      const ya = y as unknown as ArrayLike<unknown>;
      if (xa.length !== ya.length) {
        diffs.push(`${p}: length ${xa.length} !== ${ya.length}`);
      }
      for (let i = 0; i < Math.min(xa.length, ya.length); i++) {
        walk(xa[i], ya[i], `${p}[${i}]`);
      }
      return;
    }
    const xk = Object.keys(x);
    const yk = Object.keys(y);
    if (xk.join() !== yk.join()) {
      diffs.push(`${p}: keys [${xk.join()}] !== [${yk.join()}]`);
    }
    for (const k of xk) {
      walk(
        (x as Record<string, unknown>)[k],
        (y as Record<string, unknown>)[k],
        `${p}.${k}`,
      );
    }
  };
  walk(decodeSnapshotValue(a), decodeSnapshotValue(b), "snapshot");
  return diffs;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Fields that are caches rebuilt on demand, per-tick output buffers, or
// render-side bookkeeping. A restored game starts with them empty; anything
// else that differs is a snapshot bug.
export const DERIVED_FIELDS = new Set<string>([
  // GameImpl
  "updates",
  "tileUpdatePairs",
  "playerStatsQuads",
  "attackTroopsQuads",
  "motionPlanRecords",
  "_nukeImpactQueue",
  "unitCountMemo",
  "unitsByTypeMemo",
  "borderNbuf",
  // PlayerImpl
  "lastSentUpdate",
  "myUnitsMemo",
  "myUnitCountMemo",
  "myUnitsOwnedMemo",
  "nearbyMemo",
  // SharedWaterCache
  "playerWater",
  // Config / EngineConfig
  "unitInfoCache",
  "engineUnitInfoCache",
  // executions: basic
  "nbuf", // PlayerExecution scratch neighbor buffers
  "nbuf8",
  // executions: structures and missiles
  "tilesToDestroyCache", // NukeExecution: filled and read in the detonation tick only
  // executions: attacks, ships and trains
  "nbuf2", // AttackExecution scratch neighbor buffer (nbuf is above)
  // executions: nations and tribes
  // NationStructureBehavior: both reset at the start of doHandleStructures
  // and only read inside it. (AiAttackBehavior.nbuf is covered above.)
  "_sharedWaterComponents",
  "reachableStationsCache",
]);

// Search engines whose fields are per-query scratch (stamps, scores, open
// lists) reset on every query, and the shared water path memo, a pure
// (from, to) -> path cache per water graph version. Units' own paths are
// saved through their steppers. Only the class is compared.
const OPAQUE_CLASSES: readonly (abstract new (...args: never[]) => unknown)[] =
  [
    AStar,
    AStarRail,
    AStarWater,
    AStarWaterBounded,
    AStarWaterHierarchical,
    AbstractGraphAStar,
    BFSGrid,
    MinHeap,
    BucketQueue,
    WaterPathMemo,
  ];

/**
 * Walks two object graphs in parallel and lists every difference: values,
 * key sets, collection order, prototypes, and aliasing (an object reached
 * twice in one graph must map to one object in the other). Functions are
 * not compared. Undefined and absent keys are treated as equal.
 */
export function diffGraphs(
  a: unknown,
  b: unknown,
  opts: { ignore?: Set<string>; limit?: number } = {},
): string[] {
  const ignore = opts.ignore ?? DERIVED_FIELDS;
  const limit = opts.limit ?? 20;
  const diffs: string[] = [];
  const seen = new Map<object, object>();

  const walk = (x: unknown, y: unknown, p: string): void => {
    if (diffs.length >= limit) return;
    if (typeof x === "function" || typeof y === "function") return;
    if (typeof x !== "object" || x === null) {
      if (!Object.is(x, y)) {
        diffs.push(`${p}: ${String(x)} !== ${String(y)}`);
      }
      return;
    }
    if (typeof y !== "object" || y === null) {
      diffs.push(`${p}: object vs ${String(y)}`);
      return;
    }
    const mapped = seen.get(x);
    if (mapped !== undefined) {
      if (mapped !== y) diffs.push(`${p}: aliasing differs`);
      return;
    }
    seen.set(x, y);
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) {
      diffs.push(
        `${p}: ${x.constructor?.name} vs ${(y as object).constructor?.name}`,
      );
      return;
    }
    if (OPAQUE_CLASSES.some((C) => x instanceof C)) return;
    if (x instanceof TileSet) {
      walk([...x], [...(y as TileSet)], `${p}<TileSet>`);
      return;
    }
    if (x instanceof FlatBinaryHeap) {
      // Slots past the live length hold stale entries that are never read.
      walk(x.getState(), (y as FlatBinaryHeap).getState(), `${p}<Heap>`);
      return;
    }
    if (ArrayBuffer.isView(x)) {
      const xa = x as unknown as ArrayLike<number>;
      const ya = y as unknown as ArrayLike<number>;
      if (xa.length !== ya.length) {
        diffs.push(`${p}: length ${xa.length} !== ${ya.length}`);
        return;
      }
      for (let i = 0; i < xa.length; i++) {
        if (!Object.is(xa[i], ya[i])) {
          diffs.push(`${p}[${i}]: ${xa[i]} !== ${ya[i]}`);
          return;
        }
      }
      return;
    }
    if (x instanceof Map) {
      const xe = [...x];
      const ye = [...(y as Map<unknown, unknown>)];
      if (xe.length !== ye.length) {
        diffs.push(`${p}: Map size ${xe.length} !== ${ye.length}`);
        return;
      }
      xe.forEach(([k, v], i) => {
        walk(k, ye[i][0], `${p}<key ${i}>`);
        walk(v, ye[i][1], `${p}.get(${String(k)})`);
      });
      return;
    }
    if (x instanceof Set) {
      walk([...x], [...(y as Set<unknown>)], `${p}<Set>`);
      return;
    }
    if (Array.isArray(x)) {
      const ya = y as unknown[];
      if (x.length !== ya.length) {
        diffs.push(`${p}: length ${x.length} !== ${ya.length}`);
        return;
      }
      x.forEach((v, i) => walk(v, ya[i], `${p}[${i}]`));
      return;
    }
    const keys = new Set([...Object.keys(x), ...Object.keys(y as object)]);
    for (const k of keys) {
      if (ignore.has(k)) continue;
      walk(
        (x as Record<string, unknown>)[k],
        (y as Record<string, unknown>)[k],
        `${p}.${k}`,
      );
    }
  };
  walk(a, b, "game");
  return diffs;
}

/**
 * The standard snapshot check for a game in any state:
 *  1. restoring reproduces the live object graph exactly (diffGraphs),
 *  2. snapshot -> restore -> snapshot is byte-identical,
 *  3. the original and the restored game stay identical for `ticks` more
 *     ticks: same hash every tick, same snapshot bytes every 5 ticks and at
 *     the end.
 * `onTick` runs on both games before each tick (e.g. to add the same
 * executions to each); it receives the game it should act on.
 */
function hash(game: Game): number {
  return (game as unknown as { hash(): number }).hash();
}

export async function expectSnapshotRoundTrip(
  game: Game,
  mapName: string,
  ticks = 30,
  onTick?: (g: Game, tick: number) => void,
): Promise<Game> {
  const { bytes, restored, again } = await roundTrip(game, mapName);
  expect(diffGraphs(game, restored)).toEqual([]);
  expect(diffSnapshots(bytes, again)).toEqual([]);
  for (let i = 0; i < ticks; i++) {
    onTick?.(game, i);
    onTick?.(restored, i);
    game.executeNextTick();
    restored.executeNextTick();
    // The state hash every tick, the full snapshot every few (it is the
    // expensive part on big maps) and on the last.
    if (hash(game) !== hash(restored)) {
      throw new Error(`hash diverged ${i + 1} tick(s) after restore`);
    }
    if ((i + 1) % 5 !== 0 && i + 1 !== ticks) continue;
    const diffs = diffSnapshots(snapshotGame(game), snapshotGame(restored));
    if (diffs.length > 0) {
      throw new Error(
        `diverged ${i + 1} tick(s) after restore:\n${diffs.join("\n")}`,
      );
    }
  }
  expect(diffGraphs(game, restored)).toEqual([]);
  return restored;
}
