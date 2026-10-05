/**
 * Tick-by-tick simulation trace for the src/core package split (#1701).
 *
 * Runs a fixed set of games headless through createGameRunner and writes one
 * JSONL line per tick:
 *   - tick
 *   - hash: the engine's own state hash, on ticks where it emits one
 *   - updates: sha256 of the tick's GameUpdateViewData, serialized canonically
 *     (sorted keys, bigints as strings, typed arrays as tagged raw bytes),
 *     minus the wall-clock fields
 *   - snapshot: every 100 ticks, sha256 of the full snapshotGame bytes
 *
 * Usage:
 *   npx tsx scripts/split-packages/tick-trace.ts --out .tick-baseline/
 *   npx tsx scripts/split-packages/tick-trace.ts --compare .tick-baseline/
 *   [--only <game name>]
 *
 * Prod records are fetched once into .tick-records/ (gitignored).
 */
import { createHash, Hash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
} from "../../src/core/game/GameUpdates";
import { createGameRunner } from "../../src/core/GameRunner";
import { GameStartInfo, Turn } from "../../src/core/Schemas";
import {
  decompressGameRecord,
  toWireGameStartInfo,
} from "../../src/core/SharedUtil";
import { GameRecord } from "../../src/core/WireSchemas";
import { NodeGameMapLoader } from "../../tests/perf/fullgame/NodeGameMapLoader";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const RECORDS_DIR = path.join(ROOT, ".tick-records");
const SNAPSHOT_EVERY = 100;
const SYNTHETIC_TICKS = 6000;

interface TraceGame {
  name: string;
  load(): Promise<{ gameStart: GameStartInfo; turns: Turn[] }>;
}

function recordGame(name: string, gameID: string): TraceGame {
  return {
    name,
    async load() {
      const file = path.join(RECORDS_DIR, `${gameID}.json`);
      if (!fs.existsSync(file)) {
        const res = await fetch(`https://api.openfront.io/game/${gameID}`, {
          // The API serves a Cloudflare challenge to non-browser agents.
          headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" },
        });
        if (!res.ok) throw new Error(`fetch ${gameID}: HTTP ${res.status}`);
        fs.mkdirSync(RECORDS_DIR, { recursive: true });
        fs.writeFileSync(file, await res.text());
      }
      const record = decompressGameRecord(
        JSON.parse(fs.readFileSync(file, "utf8")) as GameRecord,
      );
      const info = record.info;
      const gameStart = toWireGameStartInfo({
        gameID: info.gameID,
        lobbyCreatedAt: info.lobbyCreatedAt,
        config: info.config,
        players: info.players,
        tribes: info.tribes,
      });
      return { gameStart, turns: record.turns };
    },
  };
}

function nationsOnlyGame(name: string, gameMap: GameMapType): TraceGame {
  return {
    name,
    async load() {
      const gameStart: GameStartInfo = {
        gameID: `trace${name}`.slice(0, 20),
        lobbyCreatedAt: 0,
        config: {
          gameMap,
          gameMapSize: GameMapSize.Normal,
          gameMode: GameMode.FFA,
          gameType: GameType.Private,
          difficulty: Difficulty.Hard,
          nations: "default",
          donateGold: false,
          donateTroops: false,
          bots: 100,
          infiniteGold: false,
          infiniteTroops: false,
          instantBuild: false,
          randomSpawn: false,
        },
        players: [],
      };
      const turns: Turn[] = [];
      for (let i = 0; i < SYNTHETIC_TICKS; i++) {
        turns.push({ turnNumber: i, intents: [] });
      }
      return { gameStart, turns };
    },
  };
}

const GAMES: TraceGame[] = [
  recordGame("1v1", "dYgXAeSUug"),
  recordGame("team", "dEKTPuqCtD"),
  recordGame("ffa", "dFHzwiiARh"),
  nationsOnlyGame("nations-europe", GameMapType.Europe),
  nationsOnlyGame("nations-world", GameMapType.World),
];

interface TraceLine {
  tick: number;
  hash?: number;
  updates: string;
  snapshot?: string;
}

// Wall-clock fields: they differ between runs of identical simulations.
const VOLATILE_KEYS = new Set(["tickExecutionDuration", "pendingTurns"]);

function feed(h: Hash, v: unknown): void {
  if (v === null) return void h.update("n");
  switch (typeof v) {
    case "undefined":
      return void h.update("u");
    case "boolean":
      return void h.update(v ? "T" : "F");
    case "number":
      return void h.update(`#${Object.is(v, -0) ? "-0" : String(v)};`);
    case "bigint":
      return void h.update(`b${v.toString()};`);
    case "string":
      return void h.update(`s${v.length}:${v}`);
    case "object":
      break;
    default:
      throw new Error(`cannot hash ${typeof v}`);
  }
  if (ArrayBuffer.isView(v)) {
    h.update(`t${v.constructor.name}${v.byteLength}:`);
    return void h.update(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  if (Array.isArray(v)) {
    h.update(`[${v.length}`);
    for (const x of v) feed(h, x);
    return void h.update("]");
  }
  if (v instanceof Map) {
    h.update(`M${v.size}`);
    for (const [k, x] of v) {
      feed(h, k);
      feed(h, x);
    }
    return;
  }
  if (v instanceof Set) {
    h.update(`S${v.size}`);
    for (const x of v) feed(h, x);
    return;
  }
  const keys = Object.keys(v).sort();
  h.update(`{${keys.length}`);
  for (const k of keys) {
    if (VOLATILE_KEYS.has(k)) continue;
    h.update(`k${k.length}:${k}`);
    feed(h, (v as Record<string, unknown>)[k]);
  }
  h.update("}");
}

function sha(v: unknown): string {
  const h = createHash("sha256");
  feed(h, v);
  return h.digest("hex").slice(0, 32);
}

async function traceGame(
  game: TraceGame,
  onLine: (line: TraceLine, gu: GameUpdateViewData) => boolean,
): Promise<number> {
  const { gameStart, turns } = await game.load();
  const mapLoader = new NodeGameMapLoader(path.join(ROOT, "resources/maps"));
  let pending: GameUpdateViewData | null = null;
  let error: string | null = null;
  const runner = await createGameRunner(
    gameStart,
    undefined,
    mapLoader,
    (gu: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in gu) error = `${gu.errMsg}\n${gu.stack ?? ""}`;
      else pending = gu;
    },
  );
  let ticks = 0;
  for (const turn of turns) {
    runner.addTurn(turn);
    if (!runner.executeNextTick()) {
      throw new Error(`${game.name}: tick ${ticks} failed: ${error}`);
    }
    const gu = pending as GameUpdateViewData | null;
    if (gu === null) throw new Error(`${game.name}: no update emitted`);
    pending = null;
    const line: TraceLine = { tick: gu.tick, updates: sha(gu) };
    const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
    if (hashes.length > 0) line.hash = hashes[hashes.length - 1].hash;
    if (gu.tick % SNAPSHOT_EVERY === 0) {
      line.snapshot = createHash("sha256")
        .update(runner.snapshot())
        .digest("hex")
        .slice(0, 32);
    }
    ticks++;
    if (!onLine(line, gu)) break;
  }
  return ticks;
}

function parseArgs(argv: string[]) {
  let out: string | null = null;
  let compare: string | null = null;
  let only: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--compare") compare = argv[++i];
    else if (argv[i] === "--only") only = argv[++i];
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if ((out === null) === (compare === null)) {
    throw new Error("usage: tick-trace (--out <dir> | --compare <dir>)");
  }
  return { out, compare, only };
}

async function main() {
  const { out, compare, only } = parseArgs(process.argv.slice(2));
  console.debug = () => {};
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  const log = (msg: string) => process.stdout.write(msg + "\n");
  let failed = false;

  for (const game of GAMES) {
    if (only !== null && game.name !== only) continue;
    const start = performance.now();
    if (out !== null) {
      fs.mkdirSync(out, { recursive: true });
      const lines: string[] = [];
      const ticks = await traceGame(game, (line) => {
        lines.push(JSON.stringify(line));
        return true;
      });
      fs.writeFileSync(
        path.join(out, `${game.name}.jsonl`),
        lines.join("\n") + "\n",
      );
      log(
        `${game.name}: wrote ${ticks} ticks in ` +
          `${((performance.now() - start) / 1000).toFixed(1)}s`,
      );
      continue;
    }

    const expected = fs
      .readFileSync(path.join(compare!, `${game.name}.jsonl`), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as TraceLine);
    let i = 0;
    let mismatch: string | null = null;
    const ticks = await traceGame(game, (line, gu) => {
      const want = expected[i++];
      if (want === undefined) {
        mismatch = `tick ${line.tick}: trace is longer than the baseline`;
        return false;
      }
      for (const field of ["tick", "hash", "updates", "snapshot"] as const) {
        if (line[field] !== want[field]) {
          const types = Object.entries(gu.updates)
            .filter(([, list]) => (list as unknown[]).length > 0)
            .map(([type]) => GameUpdateType[Number(type)])
            .join(", ");
          mismatch =
            `tick ${line.tick}: ${field} differs ` +
            `(baseline ${want[field]}, now ${line[field]}); ` +
            `update types this tick: ${types || "none"}`;
          return false;
        }
      }
      return true;
    });
    if (mismatch === null && ticks !== expected.length) {
      mismatch = `ran ${ticks} ticks, baseline has ${expected.length}`;
    }
    const secs = ((performance.now() - start) / 1000).toFixed(1);
    if (mismatch !== null) {
      failed = true;
      log(`${game.name}: FAIL ${mismatch}`);
    } else {
      log(`${game.name}: OK, ${ticks} ticks identical (${secs}s)`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
