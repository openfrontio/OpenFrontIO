import { z } from "zod";
import { Config } from "../configuration/Config";
import { AllianceImpl, AllianceSnapshot } from "../game/AllianceImpl";
import {
  AllianceRequestImpl,
  AllianceRequestSnapshot,
} from "../game/AllianceRequestImpl";
import { AttackImpl, AttackSnapshot } from "../game/AttackImpl";
import {
  Attack,
  Execution,
  Game,
  MutableAlliance,
  Nation,
  TeamGameSpawnAreas,
  Unit,
} from "../game/Game";
import { GameImpl, GameSnapshot } from "../game/GameImpl";
import { GameMap, GameMapImpl, GameMapSnapshot } from "../game/GameMap";
import { PlayerImpl, PlayerSnapshot } from "../game/PlayerImpl";
import { Railroad, RailroadSnapshot } from "../game/Railroad";
import { StatsImpl } from "../game/StatsImpl";
import {
  Cluster,
  ClusterSnapshot,
  TrainStation,
  TrainStationSnapshot,
} from "../game/TrainStation";
import { UnitImpl, UnitSnapshot } from "../game/UnitImpl";
import { GameConfig, GameConfigSchema } from "../Schemas";
import { newCell, newPlayerInfo } from "./CommonSchemas";
import { EXECUTION_SNAPSHOT_TYPES } from "./ExecutionRegistry";
import { decodeSnapshotValue, encodeSnapshotValue } from "./SnapshotCodec";
import {
  ExecRecord,
  RefTable,
  SnapshotReader,
  SnapshotWriter,
} from "./SnapshotContext";
import {
  readVersioned,
  SnapshotError,
  SnapshotType,
  Versioned,
  VersionedSchema,
} from "./SnapshotType";

export const SNAPSHOT_MAGIC = "OpenFrontGameSnapshot";

/**
 * Version of the root layout below. Everything inside it carries its own
 * record version, so this only moves when the root itself changes.
 */
export const SNAPSHOT_FORMAT_VERSION = 1;

const ExecRecordSchema = z.object({
  t: z.string(),
  v: z.number().int(),
  d: z.unknown(),
});

const RootSchema = z.object({
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
type Root = z.infer<typeof RootSchema>;

const EXEC_TYPES = EXECUTION_SNAPSHOT_TYPES;
const execTypes = new Map(EXEC_TYPES.map((t) => [t.name, t]));
let execTypesByProto: Map<object, string> | null = null;

/** The registered type name for an execution's exact class, if any. */
function registeredExecType(e: Execution): string | undefined {
  execTypesByProto ??= new Map(
    EXEC_TYPES.map((t) => [t.cls().prototype, t.name]),
  );
  return execTypesByProto.get(Object.getPrototypeOf(e));
}

export interface SnapshotOptions {
  gameID?: string | null;
  gitCommit?: string;
}

/**
 * Serializes the whole core simulation at the current tick boundary (between
 * executeNextTick calls). The result is uncompressed; see compressSnapshot.
 */
export function snapshotGame(
  game: Game,
  opts: SnapshotOptions = {},
): Uint8Array {
  return encodeSnapshotValue(snapshotGameData(game, opts));
}

/** The snapshot as plain data, before encoding. Exposed for tests/tools. */
export function snapshotGameData(game: Game, opts: SnapshotOptions = {}): Root {
  const g = game as GameImpl;
  const w = new SnapshotWriter(g);

  const players = g.allPlayers().map((p) => {
    return w.versioned(PlayerSnapshot, (p as PlayerImpl).snapshot(w));
  });
  const gameState = w.versioned(GameSnapshot, g.snapshotState(w));

  const units: Versioned[] = [];
  const attacks: Versioned[] = [];
  const alliances: Versioned[] = [];
  const allianceRequests: Versioned[] = [];
  const stations: Versioned[] = [];
  const railroads: Versioned[] = [];
  const clusters: Versioned[] = [];
  const execs: ExecRecord[] = [];

  // Serializing a row can reference new rows in any table: drain them all
  // until nothing new turns up.
  const drain = <T>(
    table: RefTable<T>,
    out: unknown[],
    write: (obj: T) => unknown,
  ): boolean => {
    const before = out.length;
    while (out.length < table.items.length) {
      out.push(write(table.items[out.length]));
    }
    return out.length !== before;
  };
  let progressed = true;
  while (progressed) {
    progressed = false;
    progressed ||= drain(w.execs, execs, (e) => {
      const rec = e.snapshot(w);
      // A subclass without its own registration would otherwise serialize
      // as its parent and restore as the wrong class.
      if (registeredExecType(e) !== rec.t) {
        throw new SnapshotError(
          `execution ${e.constructor.name} is not registered for snapshots as ${rec.t}`,
        );
      }
      return rec;
    });
    progressed ||= drain(w.units, units, (u) =>
      w.versioned(UnitSnapshot, (u as UnitImpl).snapshot(w)),
    );
    progressed ||= drain(w.attacks, attacks, (a) =>
      w.versioned(AttackSnapshot, (a as AttackImpl).snapshot(w)),
    );
    progressed ||= drain(w.alliances, alliances, (a) =>
      w.versioned(AllianceSnapshot, (a as AllianceImpl).snapshot(w)),
    );
    progressed ||= drain(w.allianceRequests, allianceRequests, (r) =>
      w.versioned(
        AllianceRequestSnapshot,
        (r as AllianceRequestImpl).snapshot(w),
      ),
    );
    progressed ||= drain(w.stations, stations, (s) =>
      w.versioned(TrainStationSnapshot, s.snapshot(w)),
    );
    progressed ||= drain(w.railroads, railroads, (r) =>
      w.versioned(RailroadSnapshot, r.snapshot(w)),
    );
    progressed ||= drain(w.clusters, clusters, (c) =>
      w.versioned(ClusterSnapshot, c.snapshot(w)),
    );
  }

  return {
    magic: SNAPSHOT_MAGIC,
    format: SNAPSHOT_FORMAT_VERSION,
    gitCommit: opts.gitCommit ?? "",
    gameID: opts.gameID ?? null,
    tick: g.ticks(),
    // Canonical (schema) key order, which is what a restored game holds.
    gameConfig: GameConfigSchema.parse(g.config().gameConfig()),
    game: gameState,
    map: w.versioned(GameMapSnapshot, (g.map() as GameMapImpl).snapshot()),
    miniMap: w.versioned(
      GameMapSnapshot,
      (g.miniMap() as GameMapImpl).snapshot(),
    ),
    players,
    units,
    attacks,
    alliances,
    allianceRequests,
    stations,
    railroads,
    clusters,
    execs,
  };
}

export interface SnapshotHeader {
  format: number;
  gitCommit: string;
  gameID: string | null;
  tick: number;
  gameConfig: GameConfig;
}

function decodeRoot(bytes: Uint8Array): Root {
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

/** Reads what a restore needs to load first: the config and the map. */
export function readSnapshotHeader(bytes: Uint8Array): SnapshotHeader {
  const root = decodeRoot(bytes);
  return {
    format: root.format,
    gitCommit: root.gitCommit,
    gameID: root.gameID,
    tick: root.tick,
    gameConfig: GameConfigSchema.parse(root.gameConfig),
  };
}

export interface RestoreDeps {
  config: (gameConfig: GameConfig) => Config;
  /** Freshly loaded maps for header.gameConfig; they are mutated. */
  gameMap: GameMap;
  miniGameMap: GameMap;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
}

/**
 * Rebuilds a game from a snapshot. The game continues from the stored tick:
 * call executeNextTick as usual, without re-running GameRunner.init.
 */
export function restoreGame(bytes: Uint8Array, deps: RestoreDeps): Game {
  const root = decodeRoot(bytes);
  const gameConfig = GameConfigSchema.parse(root.gameConfig);
  const config = deps.config(gameConfig);

  const state = readVersioned(GameSnapshot, root.game);
  (deps.gameMap as GameMapImpl).restoreSnapshot(
    readVersioned(GameMapSnapshot, root.map),
  );
  (deps.miniGameMap as GameMapImpl).restoreSnapshot(
    readVersioned(GameMapSnapshot, root.miniMap),
  );

  const humans = state.humans.map(newPlayerInfo);
  const nations = state.nations.map(
    (n) =>
      new Nation(
        n.spawnCell ? newCell(n.spawnCell) : undefined,
        newPlayerInfo(n.playerInfo),
      ),
  );
  const game = new GameImpl(
    humans,
    nations,
    deps.gameMap,
    deps.miniGameMap,
    config,
    new StatsImpl(),
    deps.teamGameSpawnAreas,
    true,
  );

  // Pass 1: an empty shell for every object, so references resolve.
  const players = root.players.map((p) => readVersioned(PlayerSnapshot, p));
  const playerShells = players.map((p) => {
    const shell = Object.create(PlayerImpl.prototype) as PlayerImpl;
    game.addRestoredPlayer(shell, p.info.id, p.smallID);
    return shell;
  });

  const shells = <S, T>(
    records: unknown[],
    type: SnapshotType<S>,
    proto: object,
  ): { data: S[]; objs: T[] } => {
    const data = records.map((r) => readVersioned(type, r));
    return { data, objs: data.map(() => Object.create(proto) as T) };
  };
  const units = shells<unknown, UnitImpl>(
    root.units,
    UnitSnapshot,
    UnitImpl.prototype,
  );
  const attacks = shells<unknown, AttackImpl>(
    root.attacks,
    AttackSnapshot,
    AttackImpl.prototype,
  );
  const alliances = shells<unknown, AllianceImpl>(
    root.alliances,
    AllianceSnapshot,
    AllianceImpl.prototype,
  );
  const requests = shells<unknown, AllianceRequestImpl>(
    root.allianceRequests,
    AllianceRequestSnapshot,
    AllianceRequestImpl.prototype,
  );
  const stations = shells<unknown, TrainStation>(
    root.stations,
    TrainStationSnapshot,
    TrainStation.prototype,
  );
  const railroads = shells<unknown, Railroad>(
    root.railroads,
    RailroadSnapshot,
    Railroad.prototype,
  );
  const clusters = shells<unknown, Cluster>(
    root.clusters,
    ClusterSnapshot,
    Cluster.prototype,
  );
  const execData = root.execs.map((rec) => {
    const type = execTypes.get(rec.t);
    if (type === undefined) {
      throw new SnapshotError(`unknown execution type ${rec.t}`);
    }
    return { type, data: readVersioned(type, rec) };
  });
  const execs = execData.map(
    ({ type }) => Object.create(type.cls().prototype) as Execution,
  );

  const r = new SnapshotReader(game, {
    units: units.objs as Unit[],
    attacks: attacks.objs as Attack[],
    alliances: alliances.objs as MutableAlliance[],
    allianceRequests: requests.objs,
    execs,
    stations: stations.objs,
    railroads: railroads.objs,
    clusters: clusters.objs,
    playerIds: new Map(players.map((p) => [p.smallID, p.info.id])),
  });

  // Pass 2: fill every shell. Players first, so PlayerInfo identity and
  // ownership are in place for everything that follows.
  players.forEach((p, i) => playerShells[i].restoreSnapshot(p, r));
  const fill = <
    T extends { restoreSnapshot(s: never, r: SnapshotReader): void },
  >(t: {
    data: unknown[];
    objs: T[];
  }) => t.objs.forEach((o, i) => o.restoreSnapshot(t.data[i] as never, r));
  fill(units);
  fill(attacks);
  fill(alliances);
  fill(requests);
  fill(stations);
  fill(railroads);
  fill(clusters);
  execData.forEach(({ data }, i) => {
    (
      execs[i] as unknown as {
        restoreSnapshot(s: unknown, r: SnapshotReader): void;
      }
    ).restoreSnapshot(data, r);
  });
  game.restoreState(state, r);

  // Tile ownership lives in the players' tile lists, not the map snapshot.
  const map = deps.gameMap;
  for (const p of playerShells) {
    const id = p.smallID();
    for (const tile of p.tiles()) map.setOwnerID(tile, id);
  }
  return game;
}

/** gzip, via CompressionStream (browser, worker and Node 18+). */
export function compressSnapshot(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeBytes(bytes, new CompressionStream("gzip"));
}

export function decompressSnapshot(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeBytes(bytes, new DecompressionStream("gzip"));
}

async function pipeBytes(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const reader = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  })
    .pipeThrough(transform)
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
