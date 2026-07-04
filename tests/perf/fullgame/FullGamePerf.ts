/**
 * Full-game performance harness for src/core.
 *
 * Runs the real simulation pipeline (GameRunner + Executor + real Config,
 * nations from the map manifest, bots) headlessly on a production map for a
 * configurable number of ticks, then reports:
 *
 *   1. Per-tick wall-time stats (mean/p50/p95/p99/max, ticks over budget)
 *   2. Time per Execution class (AttackExecution, NationExecution, ...)
 *   3. Top functions by self time from the V8 sampling profiler, plus a
 *      .cpuprofile loadable in Chrome DevTools (Performance tab) as a
 *      flame graph.
 *   4. GC churn: GC pause counts/time by kind, allocation rate per
 *      time window across the game, and top allocating functions from the
 *      V8 sampling heap profiler (plus a .heapprofile loadable in Chrome
 *      DevTools > Memory > Allocation sampling).
 *
 * The run is deterministic for a given --seed/--map/--bots, and the final
 * game-state hash is printed so optimizations can be verified to not change
 * simulation behavior.
 *
 * Usage:
 *   npm run perf:game -- [--map world] [--ticks 1800] [--bots 400]
 *                        [--seed perf-default] [--top 30] [--window 1000]
 *                        [--no-cpu-profile] [--no-exec-profile]
 *                        [--no-gc-profile] [--no-alloc-profile]
 *                        [--footprint] [--snapshot-at 0,2000,12000]
 *
 * --footprint records the live heap (used heap after a forced full GC) at
 * every --window boundary; it requires NODE_OPTIONS=--expose-gc.
 * --snapshot-at writes .heapsnapshot files at the given game-phase ticks
 * (0 = right after the spawn phase) for offline attribution; summarize them
 * with tests/perf/fullgame/HeapSnapshotSummary.ts.
 */
import fs from "fs";
import v8 from "node:v8";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { GameUpdateType, HashUpdate } from "../../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../../src/core/GameRunner";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../../../src/core/Schemas";
import { simpleHash } from "../../../src/core/Util";
import {
  AllocationSampler,
  FootprintCheckpoint,
  GcTracker,
  HeapSampler,
  HeapWindow,
  summarizeAllocationProfile,
  summarizeGcEvents,
  takeFootprintCheckpoint,
} from "./GcProfiler";
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import {
  CpuProfiler,
  ExecutionProfiler,
  summarizeCpuProfile,
  TickStats,
} from "./Profiler";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MAX_SPAWN_TURNS = 1000;

// ── CLI ──

interface Options {
  map: GameMapType;
  ticks: number;
  bots: number;
  nations: "default" | "disabled" | number;
  seed: string;
  top: number;
  window: number;
  cpuProfile: boolean;
  execProfile: boolean;
  gcProfile: boolean;
  allocProfile: boolean;
  footprint: boolean;
  snapshotAt: number[];
  waterNukes: boolean;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) {
    const available = Object.keys(GameMapType)
      .map((k) => k.toLowerCase())
      .join(", ");
    throw new Error(`unknown map "${name}". Available: ${available}`);
  }
  return GameMapType[key as keyof typeof GameMapType];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    map: GameMapType.World,
    ticks: 1800,
    bots: 400,
    nations: "default",
    seed: "perf-default",
    top: 30,
    window: 1000,
    cpuProfile: true,
    execProfile: true,
    gcProfile: true,
    allocProfile: true,
    footprint: false,
    snapshotAt: [],
    waterNukes: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--map":
        opts.map = resolveMap(next());
        break;
      case "--ticks":
        opts.ticks = parseInt(next(), 10);
        break;
      case "--bots":
        opts.bots = parseInt(next(), 10);
        break;
      case "--nations": {
        const v = next();
        opts.nations =
          v === "default" || v === "disabled" ? v : parseInt(v, 10);
        break;
      }
      case "--seed":
        opts.seed = next();
        break;
      case "--top":
        opts.top = parseInt(next(), 10);
        break;
      case "--window":
        opts.window = parseInt(next(), 10);
        break;
      case "--no-cpu-profile":
        opts.cpuProfile = false;
        break;
      case "--no-exec-profile":
        opts.execProfile = false;
        break;
      case "--no-gc-profile":
        opts.gcProfile = false;
        break;
      case "--no-alloc-profile":
        opts.allocProfile = false;
        break;
      case "--footprint":
        opts.footprint = true;
        break;
      case "--snapshot-at":
        opts.snapshotAt = next()
          .split(",")
          .map((v) => parseInt(v, 10));
        break;
      case "--water-nukes":
        opts.waterNukes = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ── Report formatting ──

function fmtMs(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
}

function fmtMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? mb.toFixed(0) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, c) => cell.padEnd(widths[c])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w)))]
    .concat(rows.map(line))
    .join("\n");
}

// ── Main ──

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {}; // silence per-tick debug logging

  const gameConfig: GameConfig = {
    gameMap: opts.map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: opts.nations,
    donateGold: false,
    donateTroops: false,
    bots: opts.bots,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    waterNukes: opts.waterNukes ? true : undefined,
  };
  const gameStart: GameStartInfo = {
    gameID: opts.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  console.log(
    `Loading map "${opts.map}" (bots=${opts.bots}, nations=${opts.nations}, ` +
      `seed=${opts.seed}, ticks=${opts.ticks})...`,
  );

  // Mirrors createGameRunner(), but assembled by hand so the execution
  // profiler can be attached before GameRunner.init() adds the initial
  // executions (nations, bots, spawn timer, win check).
  const config = new Config(gameConfig, null, false);
  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );
  const terrain = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    mapLoader,
  );
  const random = new PseudoRandom(simpleHash(gameStart.gameID));
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    0,
    random,
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  const execProfiler = new ExecutionProfiler();
  if (opts.execProfile) {
    execProfiler.attach(game);
  }

  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) {
        lastHash = hashes[hashes.length - 1];
      }
    },
  );
  runner.init();

  const gcTracker = opts.gcProfile ? new GcTracker() : null;
  gcTracker?.start();
  const heapSampler = opts.gcProfile ? new HeapSampler() : null;

  const footprints: FootprintCheckpoint[] = [];
  const recordFootprint = (label: string): void => {
    if (!opts.footprint) return;
    const cp = takeFootprintCheckpoint(label);
    if (cp === null) {
      throw new Error(
        "--footprint requires the gc() global; run with NODE_OPTIONS=--expose-gc",
      );
    }
    footprints.push(cp);
  };
  const snapshotDir = path.join(PROJECT_ROOT, "tests/perf/output");
  const writeSnapshot = (label: string): void => {
    fs.mkdirSync(snapshotDir, { recursive: true });
    const file = path.join(
      snapshotDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}-${label}.heapsnapshot`,
    );
    console.log(`Writing heap snapshot ${path.relative(PROJECT_ROOT, file)}…`);
    v8.writeHeapSnapshot(file);
  };

  let turnNumber = 0;
  const runTick = (stats: TickStats): boolean => {
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });
    const tick = game.ticks();
    const start = performance.now();
    const ok = runner.executeNextTick();
    stats.record(tick, performance.now() - start);
    heapSampler?.tick();
    return ok && fatalError === undefined;
  };

  // Spawn phase (SpawnTimerExecution ends it after config.numSpawnPhaseTurns).
  const spawnStats = new TickStats();
  const spawnStart = performance.now();
  while (game.inSpawnPhase()) {
    if (turnNumber >= MAX_SPAWN_TURNS) {
      throw new Error(`spawn phase did not end after ${MAX_SPAWN_TURNS} turns`);
    }
    if (!runTick(spawnStats)) {
      throw new Error(`game errored during spawn phase:\n${fatalError}`);
    }
  }
  const spawnTurns = turnNumber;
  console.log(
    `Spawn phase done: ${spawnTurns} turns in ` +
      `${fmtMs(performance.now() - spawnStart)}ms, ` +
      `${game.players().filter((p) => p.isAlive()).length} players spawned.`,
  );

  heapSampler?.closeWindow("spawn");
  recordFootprint(`spawn (tick ${game.ticks() - 1})`);
  if (opts.snapshotAt.includes(0)) {
    writeSnapshot("tick0");
  }

  // Main game phase, under the CPU profiler and allocation sampler.
  const cpuProfiler = opts.cpuProfile ? new CpuProfiler() : null;
  if (cpuProfiler) {
    await cpuProfiler.start();
  }
  const allocSampler = opts.allocProfile ? new AllocationSampler() : null;
  if (allocSampler) {
    await allocSampler.start();
  }
  const gameStats = new TickStats();
  const gameStart_ = performance.now();
  let heapPeak = 0;
  let windowStartTick = game.ticks();
  for (let i = 0; i < opts.ticks; i++) {
    if (!runTick(gameStats)) {
      console.error(`game errored at tick ${game.ticks()}:\n${fatalError}`);
      process.exitCode = 1;
      break;
    }
    if (i % 50 === 0) {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }
    if ((i + 1) % opts.window === 0 || i === opts.ticks - 1) {
      heapSampler?.closeWindow(`${windowStartTick}-${game.ticks() - 1}`);
      windowStartTick = game.ticks();
      recordFootprint(`tick ${game.ticks() - 1}`);
    }
    if (opts.snapshotAt.includes(i + 1)) {
      writeSnapshot(`tick${i + 1}`);
    }
  }
  const gamePhaseMs = performance.now() - gameStart_;
  const profile = cpuProfiler ? await cpuProfiler.stop() : null;
  const allocProfile = allocSampler ? await allocSampler.stop() : null;
  const gcEvents = gcTracker ? await gcTracker.stop() : null;

  // ── Report ──

  const budgetMs = config.msPerTick();
  const summary = gameStats.summarize(budgetMs);
  const alive = game.players().filter((p) => p.isAlive());

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Full game perf: ${opts.map}, ${summary.count} game ticks`);
  console.log("=".repeat(72));

  console.log(`\n--- Game state at end ---`);
  console.log(`Ticks executed:   ${game.ticks()} (${spawnTurns} spawn)`);
  console.log(`Players alive:    ${alive.length} / ${game.players().length}`);
  console.log(`Units:            ${game.units().length}`);
  console.log(
    `Final hash:       ${lastHash ? `${lastHash.hash} (tick ${lastHash.tick})` : "n/a"}`,
  );
  console.log(`Peak heap:        ${(heapPeak / 1024 / 1024).toFixed(0)} MB`);

  console.log(`\n--- Per-tick wall time (game phase) ---`);
  console.log(
    `Total: ${fmtMs(summary.totalMs)}ms sim time over ${fmtMs(gamePhaseMs)}ms ` +
      `wall (${(summary.count / (gamePhaseMs / 1000)).toFixed(0)} ticks/sec)`,
  );
  console.log(
    `mean ${fmtMs(summary.meanMs)}ms | p50 ${fmtMs(summary.p50Ms)}ms | ` +
      `p95 ${fmtMs(summary.p95Ms)}ms | p99 ${fmtMs(summary.p99Ms)}ms | ` +
      `max ${fmtMs(summary.maxMs)}ms`,
  );
  console.log(
    `Over ${budgetMs}ms budget: ${summary.overBudget} / ${summary.count} ticks`,
  );
  console.log(
    `Slowest ticks: ` +
      summary.slowest.map((s) => `#${s.tick} (${fmtMs(s.ms)}ms)`).join(", "),
  );

  if (footprints.length > 0) {
    console.log(`\n--- Live-heap footprint (after forced full GC) ---`);
    console.log(
      table(
        ["checkpoint", "live MB", "total MB", "ext MB", "arrbuf MB", "rss MB"],
        footprints.map((cp) => [
          cp.label,
          fmtMB(cp.liveHeapBytes),
          fmtMB(cp.totalHeapBytes),
          fmtMB(cp.externalBytes),
          fmtMB(cp.arrayBuffersBytes),
          fmtMB(cp.rssBytes),
        ]),
      ),
    );
  }

  if (opts.execProfile) {
    console.log(`\n--- Time by Execution class ---`);
    const rows = execProfiler.report();
    const grandTotal = rows.reduce((a, r) => a + r.totalMs, 0);
    console.log(
      table(
        [
          "execution",
          "total ms",
          "%",
          "tick ms",
          "init ms",
          "ticks",
          "instances",
        ],
        rows
          .slice(0, opts.top)
          .map((r) => [
            r.name,
            fmtMs(r.totalMs),
            ((r.totalMs * 100) / grandTotal).toFixed(1),
            fmtMs(r.tickMs),
            fmtMs(r.initMs),
            String(r.tickCalls),
            String(r.instances),
          ]),
      ),
    );
    console.log(
      `(execution total ${fmtMs(grandTotal)}ms, includes spawn phase; ` +
        `remainder of tick time is player updates, hashing, and tile updates)`,
    );
  }

  if (gcEvents && heapSampler) {
    const gamePhaseEvents = gcEvents.filter((e) => e.startTime >= gameStart_);
    const gc = summarizeGcEvents(gamePhaseEvents);

    console.log(`\n--- GC (game phase) ---`);
    console.log(
      table(
        ["kind", "count", "total ms", "avg ms", "max ms"],
        (["minor", "major", "incremental", "weakcb", "all"] as const).map(
          (kind) => [
            kind,
            String(gc[kind].count),
            fmtMs(gc[kind].totalMs),
            fmtMs(gc[kind].count > 0 ? gc[kind].totalMs / gc[kind].count : 0),
            fmtMs(gc[kind].maxMs),
          ],
        ),
      ),
    );
    console.log(
      `GC time: ${fmtMs(gc.all.totalMs)}ms = ` +
        `${((gc.all.totalMs * 100) / gamePhaseMs).toFixed(1)}% of game-phase wall time`,
    );

    console.log(`\n--- Allocation & GC by window ---`);
    const windowRow = (w: HeapWindow): string[] => {
      const wgc = summarizeGcEvents(
        gcTracker!.eventsBetween(w.startTime, w.endTime),
      );
      return [
        w.label,
        fmtMB(w.allocatedBytes),
        w.ticks > 0 ? ((w.allocatedBytes / w.ticks) * 1e-3).toFixed(0) : "0",
        String(wgc.minor.count),
        fmtMs(wgc.minor.totalMs),
        String(wgc.major.count),
        fmtMs(wgc.major.totalMs),
        fmtMs(wgc.incremental.totalMs),
        fmtMB(w.heapUsedEnd),
      ];
    };
    console.log(
      table(
        [
          "ticks",
          "alloc MB",
          "KB/tick",
          "minor#",
          "minor ms",
          "major#",
          "major ms",
          "incr ms",
          "heap MB",
        ],
        heapSampler.all().map(windowRow),
      ),
    );
    console.log(
      `(alloc = sum of positive used-heap deltas between ticks; a lower bound on churn)`,
    );
  }

  if (allocProfile) {
    const { sites, totalBytes } = summarizeAllocationProfile(
      allocProfile,
      PROJECT_ROOT,
    );
    console.log(
      `\n--- Top allocating functions (game phase, sampled; ` +
        `~${fmtMB(totalBytes)} MB total incl. collected) ---`,
    );
    console.log(
      table(
        ["alloc MB", "%", "function", "location"],
        sites
          .slice(0, opts.top)
          .map((s) => [
            fmtMB(s.selfBytes),
            s.selfPct.toFixed(1),
            s.functionName,
            s.location,
          ]),
      ),
    );

    const outDir = path.join(PROJECT_ROOT, "tests/perf/output");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(
      outDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.heapprofile`,
    );
    fs.writeFileSync(outFile, JSON.stringify(allocProfile));
    console.log(
      `Heap profile written to ${path.relative(PROJECT_ROOT, outFile)}` +
        ` (open in Chrome DevTools > Memory > Allocation sampling)`,
    );
  }

  if (profile) {
    console.log(`\n--- Top functions by self time (V8 sampling profiler) ---`);
    const fns = summarizeCpuProfile(profile, PROJECT_ROOT);
    console.log(
      table(
        ["self ms", "%", "function", "location"],
        fns
          .slice(0, opts.top)
          .map((f) => [
            fmtMs(f.selfMs),
            f.selfPct.toFixed(1),
            f.functionName,
            f.location,
          ]),
      ),
    );

    const outDir = path.join(PROJECT_ROOT, "tests/perf/output");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(
      outDir,
      `fullgame-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.cpuprofile`,
    );
    fs.writeFileSync(outFile, JSON.stringify(profile));
    console.log(
      `\nCPU profile written to ${path.relative(PROJECT_ROOT, outFile)}` +
        ` (open in Chrome DevTools > Performance for a flame graph)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
