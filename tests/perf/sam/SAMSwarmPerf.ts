/**
 * Dedicated SAM Swarm Performance Benchmark.
 *
 * Stresses the SAM predictive targeting system (Behavior B), dynamic range calculation,
 * and zero-allocation swarm caching under extreme saturation:
 *   - 50 SAM launchers with continuous upgrade transitions
 *   - 300+ simultaneous in-flight missiles (Atom Bombs, Hydrogen Bombs, MIRVs)
 *   - Reports matching FullGamePerf: Per-tick wall time (mean/p50/p95/p99/max, slowest ticks),
 *     Time by Execution class table, and GC pause statistics.
 *
 * Usage:
 *   npx tsx tests/perf/sam/SAMSwarmPerf.ts [--ticks 200] [--sams 50] [--missiles 10]
 */
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { SAMLauncherExecution } from "../../../src/core/execution/SAMLauncherExecution";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import {
  genTerrainFromBin,
  MapManifest,
} from "../../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { GcTracker, summarizeGcEvents } from "../fullgame/GcProfiler";
import {
  CpuProfiler,
  ExecutionProfiler,
  summarizeCpuProfile,
  TickStats,
} from "../fullgame/Profiler";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function parseArgs(args: string[]) {
  let ticks = 1000;
  let sams = 100;
  let missilesPerTick = 25;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ticks" && args[i + 1]) ticks = parseInt(args[++i], 10);
    else if (args[i] === "--sams" && args[i + 1])
      sams = parseInt(args[++i], 10);
    else if (args[i] === "--missiles" && args[i + 1])
      missilesPerTick = parseInt(args[++i], 10);
  }
  return { ticks, sams, missilesPerTick };
}

async function runBenchmark(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const TICKS = opts.ticks;
  const SAM_COUNT = opts.sams;
  const MISSILES_PER_TICK = opts.missilesPerTick;
  const budgetMs = 100;

  console.debug = () => {}; // silence per-tick debug logging

  // Load big_plains map
  const mapPath = path.join(__dirname, "../../testdata/maps/big_plains");
  const mapBin = fs.readFileSync(path.join(mapPath, "map.bin"));
  const map4xBin = fs.readFileSync(path.join(mapPath, "map4x.bin"));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(mapPath, "manifest.json"), "utf8"),
  ) as MapManifest;

  const gameMap = await genTerrainFromBin(manifest.map, mapBin);
  const miniMap = await genTerrainFromBin(manifest.map4x, map4xBin);

  const gameConfig: GameConfig = {
    gameMap: GameMapType.World,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: true,
    infiniteTroops: false,
    instantBuild: true,
    randomSpawn: false,
  };

  const config = new Config(gameConfig, new UserSettings(), false);
  const defenderInfo = new PlayerInfo("def", PlayerType.Human, null, "def");
  const attackerInfo = new PlayerInfo("atk", PlayerType.Human, null, "atk");
  const game = createGame(
    [defenderInfo, attackerInfo],
    [],
    gameMap,
    miniMap,
    config,
  );
  game.endSpawnPhase();

  const defender = game.player("def")!;
  const attacker = game.player("atk")!;

  // Attach Execution Profiler
  const execProfiler = new ExecutionProfiler();
  execProfiler.attach(game);

  // Attach GC tracker
  let gcTracker: GcTracker | null = null;
  try {
    gcTracker = new GcTracker();
  } catch {
    // perf_hooks GC observer may not be supported on all Node environments
  }

  // Build grid of SAM launchers
  const sams: Unit[] = [];
  const startX = 30;
  const startY = 30;

  for (let i = 0; i < SAM_COUNT; i++) {
    const x = startX + (i % 10) * 8;
    const y = startY + Math.floor(i / 10) * 8;
    const tile = game.ref(x, y);
    const sam = defender.buildUnit(UnitType.SAMLauncher, tile, {});
    for (let l = 1; l < 1 + (i % 4); l++) {
      sam.increaseLevel();
    }
    const exec = new SAMLauncherExecution(defender, tile, sam);
    game.addExecution(exec);
    sams.push(sam);
  }

  const cpuProfiler = new CpuProfiler();
  await cpuProfiler.start();

  const tickStats = new TickStats();
  let totalMissilesSpawned = 0;
  let heapPeak = process.memoryUsage().heapUsed;

  const wallStart = performance.now();

  for (let tick = 1; tick <= TICKS; tick++) {
    // 1. Rolling upgrades across SAM array
    if (tick % 5 === 0) {
      const samIdx = (tick / 5) % SAM_COUNT;
      sams[samIdx].increaseLevel();
    }

    // 2. Spawn incoming missile waves
    for (let m = 0; m < MISSILES_PER_TICK; m++) {
      const fromX = 0 + (m % 5) * 5;
      const fromY = 10 + ((m * 7) % 60);
      const toX = 80 + (m % 5) * 5;
      const toY = fromY;

      const nukeType =
        m % 3 === 0
          ? UnitType.HydrogenBomb
          : m % 3 === 1
            ? UnitType.MIRVWarhead
            : UnitType.AtomBomb;

      const trajectory: { tile: number; targetable: boolean }[] = [];
      for (let step = fromX; step <= toX; step += 6) {
        trajectory.push({ tile: game.ref(step, fromY), targetable: true });
      }

      attacker.buildUnit(nukeType, game.ref(fromX, fromY), {
        targetTile: game.ref(toX, toY),
        trajectory,
      });
      totalMissilesSpawned++;
    }

    // 3. Execute tick & measure timing
    const t0 = performance.now();
    game.executeNextTick();
    const dt = performance.now() - t0;
    tickStats.record(tick, dt);

    const mem = process.memoryUsage().heapUsed;
    if (mem > heapPeak) heapPeak = mem;
  }

  const profile = await cpuProfiler.stop();
  const totalWallMs = performance.now() - wallStart;
  const summary = tickStats.summarize(budgetMs);
  const gcEvents = gcTracker ? await gcTracker.stop() : [];

  // ── Print FullGamePerf-Style Report ──

  console.log(`\n${"=".repeat(72)}`);
  console.log(
    `SAM Swarm Perf: ${SAM_COUNT} SAM Launchers, ${TICKS} ticks, ${totalMissilesSpawned} missiles`,
  );
  console.log("=".repeat(72));

  console.log(`\n--- Game state at end ---`);
  console.log(`Ticks executed:   ${game.ticks()}`);
  console.log(`SAM Launchers:    ${sams.length} (${SAM_COUNT} active)`);
  console.log(`Total Units:      ${game.units().length}`);
  console.log(`Peak heap:        ${fmtMB(heapPeak)} MB`);

  console.log(`\n--- Per-tick wall time ---`);
  console.log(
    `Total: ${fmtMs(summary.totalMs)}ms sim time over ${fmtMs(totalWallMs)}ms ` +
      `wall (${(summary.count / (totalWallMs / 1000)).toFixed(0)} ticks/sec)`,
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
      rows.map((r) => [
        r.name,
        fmtMs(r.totalMs),
        grandTotal > 0 ? ((r.totalMs * 100) / grandTotal).toFixed(1) : "0.0",
        fmtMs(r.tickMs),
        fmtMs(r.initMs),
        String(r.tickCalls),
        String(r.instances),
      ]),
    ),
  );
  console.log(
    `(execution total ${fmtMs(grandTotal)}ms; remainder of tick time is unit movement, hashing, and tile updates)`,
  );

  if (gcEvents.length > 0) {
    const gc = summarizeGcEvents(gcEvents);
    console.log(`\n--- GC (benchmark phase) ---`);
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
        `${((gc.all.totalMs * 100) / totalWallMs).toFixed(1)}% of benchmark wall time`,
    );
  }

  if (profile) {
    const projectRoot = path.resolve(__dirname, "../../..");
    const fns = summarizeCpuProfile(profile, projectRoot);
    console.log(`\n--- Top functions by self time (V8 sampling profiler) ---`);
    console.log(
      table(
        ["self ms", "%", "function", "location"],
        fns
          .slice(0, 15)
          .map((f) => [
            fmtMs(f.selfMs),
            f.selfPct.toFixed(1),
            f.functionName,
            f.location,
          ]),
      ),
    );
  }
}

runBenchmark().catch((err) => {
  console.error(err);
  process.exit(1);
});
