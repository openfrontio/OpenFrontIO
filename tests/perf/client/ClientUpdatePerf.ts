/**
 * Main-thread (client-side) performance harness for the worker → client
 * update pipeline.
 *
 * The simulation runs at 10Hz in a Web Worker; each tick the main thread
 * synchronously runs structured-clone deserialization, GameView.update()
 * (tile apply + player/unit state + FrameData derivations), and
 * WebGLFrameBuilder.update() (player sync + GPU upload dispatch). On low-end
 * devices that burst blows the 16.7ms frame budget → a visible stutter every
 * 100ms. This harness measures that burst headlessly:
 *
 *   sim      — GameRunner.executeNextTick() (worker-side, for context)
 *   clone    — structuredClone of GameUpdateViewData with the same transfer
 *              list Worker.worker.ts uses. Serialize+deserialize both run
 *              here, so this is an upper bound on the main-thread share of
 *              the real postMessage cost.
 *   view     — the real client GameView.update(gu), including populateFrame()
 *   builder  — the real WebGLFrameBuilder.update() against a no-op GL stub.
 *              CPU work inside the WebGL view's update*() methods (instance
 *              buffer building etc.) is NOT included — that needs a browser
 *              profile.
 *
 * HUD layer ticks (GameRenderer.tick) are DOM-bound and not measured.
 *
 * Prints a deterministic "View hash" over the end-of-run FrameData/view state
 * so client-side optimizations can be verified to not change view behavior
 * (the analogue of the sim harness's "Final hash").
 *
 * Usage:
 *   npm run perf:client -- [--map world] [--ticks 1800] [--bots 400]
 *                          [--seed perf-default] [--top 30] [--no-cpu-profile]
 */
import "./Shims"; // must be first: browser-global shims for client code

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GameView } from "../../../src/client/view/GameView";
import { WebGLFrameBuilder } from "../../../src/client/WebGLFrameBuilder";
import { Config } from "../../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../src/core/game/Game";
import {
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
} from "../../../src/core/game/GameUpdates";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { createGameRunner } from "../../../src/core/GameRunner";
import { GameConfig, GameStartInfo } from "../../../src/core/Schemas";
import type { WorkerClient } from "../../../src/core/worker/WorkerClient";
import { NodeGameMapLoader } from "../fullgame/NodeGameMapLoader";
import {
  CpuProfiler,
  summarizeCpuProfile,
  TickStats,
} from "../fullgame/Profiler";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const MAX_SPAWN_TURNS = 1000;
/** One 60Hz frame. A tick burst above this drops at least one frame. */
const FRAME_BUDGET_MS = 16.7;

// ── CLI ──

interface Options {
  map: GameMapType;
  ticks: number;
  bots: number;
  nations: "default" | "disabled" | number;
  seed: string;
  top: number;
  cpuProfile: boolean;
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
    cpuProfile: true,
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
      case "--no-cpu-profile":
        opts.cpuProfile = false;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

// ── No-op GL view stub ──
//
// Counts calls and payload sizes so the report shows what the GPU layer
// would have received, without doing any work. Any WebGLFrameBuilder call to
// a method not stubbed here throws — that's intentional (fail loudly when
// the upload surface grows).

function createGlStub() {
  const counts = new Map<string, number>();
  let unitsSeen = 0;
  let namesSeen = 0;
  let changedTilesSeen = 0;
  const bump = (name: string, by = 1) =>
    counts.set(name, (counts.get(name) ?? 0) + by);
  const noop = (name: string) => () => bump(name);

  const view = {
    // WebGLFrameBuilder syncs
    addPlayers: (players: unknown[]) => bump("addPlayers", players.length),
    updatePalette: noop("updatePalette"),
    setPlayerSkin: noop("setPlayerSkin"),
    setPlayerSpawn: noop("setPlayerSpawn"),
    setLocalPlayerID: noop("setLocalPlayerID"),
    setLocalRailColor: noop("setLocalRailColor"),
    updateSpawnOverlay: noop("updateSpawnOverlay"),
    initSkinAtlas: noop("initSkinAtlas"),
    applyTerrainDelta: (refs: number[]) =>
      bump("applyTerrainDelta", refs.length),
    // uploadFrameData dispatch targets (FrameUploadTarget)
    uploadTileAndTrailState: noop("uploadTileAndTrailState"),
    uploadLiveDelta: (_: unknown, changed: unknown[]) => {
      bump("uploadLiveDelta");
      changedTilesSeen += changed.length;
    },
    uploadLiveTrailDelta: noop("uploadLiveTrailDelta"),
    applyFullTiles: noop("applyFullTiles"),
    applyDelta: noop("applyDelta"),
    uploadRailroadState: noop("uploadRailroadState"),
    applyRailroadDust: noop("applyRailroadDust"),
    updateUnits: (units: ReadonlyMap<number, unknown>) => {
      bump("updateUnits");
      unitsSeen += units.size;
    },
    updateStructures: noop("updateStructures"),
    applyDeadUnits: noop("applyDeadUnits"),
    applyConquestEvents: noop("applyConquestEvents"),
    applyBonusEvents: noop("applyBonusEvents"),
    updateAttackRings: noop("updateAttackRings"),
    updateNukeTelegraphs: noop("updateNukeTelegraphs"),
    updateNames: (names: ReadonlyMap<string, unknown>) => {
      bump("updateNames");
      namesSeen += names.size;
    },
    updateRelations: noop("updateRelations"),
    setSAMAllianceClusters: noop("setSAMAllianceClusters"),
  };
  return {
    view,
    counts,
    stats: () => ({ unitsSeen, namesSeen, changedTilesSeen }),
  };
}

// ── View-state hash (determinism check for client-side optimizations) ──

class Fnv32 {
  private h = 0x811c9dc5;

  mixByte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }

  mixU32(n: number): void {
    this.mixByte(n);
    this.mixByte(n >>> 8);
    this.mixByte(n >>> 16);
    this.mixByte(n >>> 24);
  }

  mixString(s: string): void {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      this.mixByte(c);
      this.mixByte(c >>> 8);
    }
  }

  digest(): string {
    return this.h.toString(16).padStart(8, "0");
  }
}

const jsonReplacer = (_key: string, value: unknown) =>
  typeof value === "bigint" ? `${value}n` : value;

/**
 * Deterministic hash over the renderer-facing view state: the tile texture
 * buffer plus FrameData's derived structures and per-player/per-unit state.
 * Map iteration order is insertion order, which is deterministic given a
 * deterministic simulation.
 */
function computeViewHash(gameView: GameView): string {
  const fnv = new Fnv32();
  const frame = gameView.frameData();

  const tileState = gameView.tileStateBuffer();
  for (let i = 0; i < tileState.length; i++) {
    fnv.mixU32(tileState[i]);
  }

  fnv.mixU32(frame.relationSize);
  for (let i = 0; i < frame.relationMatrix.length; i++) {
    fnv.mixByte(frame.relationMatrix[i]);
  }

  for (const [id, entry] of frame.names) {
    fnv.mixString(id);
    fnv.mixU32(entry.x);
    fnv.mixU32(entry.y);
    fnv.mixU32(entry.size);
  }
  for (const [sid, status] of frame.playerStatus) {
    fnv.mixU32(sid);
    fnv.mixString(JSON.stringify(status, jsonReplacer));
  }
  for (const [sid, cluster] of frame.allianceClusters) {
    fnv.mixU32(sid);
    fnv.mixU32(cluster);
  }
  for (const state of gameView.unitStates().values()) {
    fnv.mixString(JSON.stringify(state, jsonReplacer));
  }
  for (const state of gameView.playerStates().values()) {
    fnv.mixString(JSON.stringify(state, jsonReplacer));
  }
  return fnv.digest();
}

// ── Report formatting ──

function fmtMs(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(2);
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

  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );

  // Worker side: the exact pipeline Worker.worker.ts runs.
  let currentGu: GameUpdateViewData | null = null;
  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;
  const runner = await createGameRunner(
    gameStart,
    undefined,
    mapLoader,
    (gu) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      currentGu = gu;
    },
  );

  // Client side: own Config + own map load, mirroring createClientGame (the
  // real client and worker each load their own copy of the map).
  const clientConfig = new Config(gameConfig, null, false);
  const clientMapData = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    mapLoader,
  );
  const gameView = new GameView(
    {} as unknown as WorkerClient, // only stored; async query methods unused here
    clientConfig,
    clientMapData,
    undefined, // no local client — bots-only game, myPlayer stays null
    "perf-harness",
    null,
    gameStart.gameID,
    gameStart.players,
  );
  const glStub = createGlStub();
  const builder = new WebGLFrameBuilder(
    glStub.view as unknown as ConstructorParameters<
      typeof WebGLFrameBuilder
    >[0],
  );

  // Per-stage stats. "total" is clone+view+builder — the main-thread burst.
  const stats = {
    sim: new TickStats(),
    clone: new TickStats(),
    view: new TickStats(),
    builder: new TickStats(),
    total: new TickStats(),
  };
  const tilePairsByTick = new Map<number, number>();
  let totalTilePairs = 0;
  let maxTilePairs = 0;
  let unitUpdatesTotal = 0;
  let playerUpdatesTotal = 0;

  let turnNumber = 0;
  const runTick = (recordInto: typeof stats): boolean => {
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });

    currentGu = null;
    let start = performance.now();
    const ok = runner.executeNextTick();
    const simMs = performance.now() - start;
    if (!ok || fatalError !== undefined || currentGu === null) {
      return false;
    }
    const gu: GameUpdateViewData = currentGu;
    const tick = gu.tick;
    recordInto.sim.record(tick, simMs);

    const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
    if (hashes.length > 0) {
      lastHash = hashes[hashes.length - 1];
    }

    const pairs = gu.packedTileUpdates.length / 2;
    tilePairsByTick.set(tick, pairs);
    totalTilePairs += pairs;
    maxTilePairs = Math.max(maxTilePairs, pairs);
    unitUpdatesTotal += gu.updates[GameUpdateType.Unit].length;
    playerUpdatesTotal += gu.updates[GameUpdateType.Player].length;

    // Same transfer list as Worker.worker.ts sendGameUpdateBatch().
    const transfers: Transferable[] = [gu.packedTileUpdates.buffer];
    if (gu.packedMotionPlans) {
      transfers.push(gu.packedMotionPlans.buffer);
    }
    if (gu.packedPlayerUpdates) {
      transfers.push(gu.packedPlayerUpdates.buffer);
    }
    if (gu.packedAttackUpdates) {
      transfers.push(gu.packedAttackUpdates.buffer);
    }
    start = performance.now();
    const cloned = structuredClone(gu, { transfer: transfers });
    const cloneMs = performance.now() - start;
    recordInto.clone.record(tick, cloneMs);

    // Same call chain as the ClientGameRunner worker.start() callback.
    start = performance.now();
    gameView.update(cloned);
    const viewMs = performance.now() - start;
    recordInto.view.record(tick, viewMs);

    start = performance.now();
    builder.update(gameView);
    const builderMs = performance.now() - start;
    recordInto.builder.record(tick, builderMs);

    recordInto.total.record(tick, cloneMs + viewMs + builderMs);
    return true;
  };

  // Spawn phase (full pipeline, reported separately).
  const spawnStats = {
    sim: new TickStats(),
    clone: new TickStats(),
    view: new TickStats(),
    builder: new TickStats(),
    total: new TickStats(),
  };
  const spawnStart = performance.now();
  while (runner.game.inSpawnPhase()) {
    if (turnNumber >= MAX_SPAWN_TURNS) {
      throw new Error(`spawn phase did not end after ${MAX_SPAWN_TURNS} turns`);
    }
    if (!runTick(spawnStats)) {
      throw new Error(`game errored during spawn phase:\n${fatalError}`);
    }
  }
  const spawnTurns = turnNumber;
  const spawnClientMs = spawnStats.total.summarize(FRAME_BUDGET_MS).totalMs;
  console.log(
    `Spawn phase done: ${spawnTurns} turns in ` +
      `${fmtMs(performance.now() - spawnStart)}ms wall ` +
      `(${fmtMs(spawnClientMs)}ms client-side), ` +
      `${runner.game.players().filter((p) => p.isAlive()).length} players spawned.`,
  );

  // Main game phase, under the CPU profiler.
  const cpuProfiler = opts.cpuProfile ? new CpuProfiler() : null;
  if (cpuProfiler) {
    await cpuProfiler.start();
  }
  const gamePhaseStart = performance.now();
  let heapPeak = 0;
  for (let i = 0; i < opts.ticks; i++) {
    if (!runTick(stats)) {
      console.error(
        `game errored at tick ${runner.game.ticks()}:\n${fatalError}`,
      );
      process.exitCode = 1;
      break;
    }
    if (i % 50 === 0) {
      heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
    }
  }
  const gamePhaseMs = performance.now() - gamePhaseStart;
  const profile = cpuProfiler ? await cpuProfiler.stop() : null;

  // ── Report ──

  const summaries = {
    sim: stats.sim.summarize(FRAME_BUDGET_MS),
    clone: stats.clone.summarize(FRAME_BUDGET_MS),
    view: stats.view.summarize(FRAME_BUDGET_MS),
    builder: stats.builder.summarize(FRAME_BUDGET_MS),
    total: stats.total.summarize(FRAME_BUDGET_MS),
  };
  const n = summaries.total.count;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Client update perf: ${opts.map}, ${n} game ticks`);
  console.log("=".repeat(72));

  console.log(`\n--- Game state at end ---`);
  console.log(`Ticks executed:   ${runner.game.ticks()} (${spawnTurns} spawn)`);
  console.log(
    `Players alive:    ${runner.game.players().filter((p) => p.isAlive()).length}` +
      ` / ${runner.game.players().length}`,
  );
  console.log(`View units:       ${gameView.units().length}`);
  console.log(
    `Sim final hash:   ${lastHash ? `${lastHash.hash} (tick ${lastHash.tick})` : "n/a"}`,
  );
  console.log(`View hash:        ${computeViewHash(gameView)}`);
  console.log(`Peak heap:        ${(heapPeak / 1024 / 1024).toFixed(0)} MB`);

  console.log(
    `\n--- Main-thread cost per tick (game phase, ${fmtMs(gamePhaseMs)}ms wall) ---`,
  );
  const stageRows: [string, (typeof summaries)["total"]][] = [
    ["clone (serialize+deserialize)", summaries.clone],
    ["GameView.update", summaries.view],
    ["WebGLFrameBuilder.update", summaries.builder],
    ["TOTAL main-thread burst", summaries.total],
    ["(sim tick, worker-side)", summaries.sim],
  ];
  console.log(
    table(
      [
        "stage",
        "mean",
        "p50",
        "p95",
        "p99",
        "max",
        "total ms",
        `>${FRAME_BUDGET_MS}ms`,
      ],
      stageRows.map(([name, s]) => [
        name,
        fmtMs(s.meanMs),
        fmtMs(s.p50Ms),
        fmtMs(s.p95Ms),
        fmtMs(s.p99Ms),
        fmtMs(s.maxMs),
        fmtMs(s.totalMs),
        `${s.overBudget} / ${s.count}`,
      ]),
    ),
  );
  console.log(
    `\nSlowest bursts: ` +
      summaries.total.slowest
        .map(
          (s) =>
            `#${s.tick} (${fmtMs(s.ms)}ms, ${tilePairsByTick.get(s.tick) ?? 0} tiles)`,
        )
        .join(", "),
  );

  console.log(`\n--- Update payload (game phase) ---`);
  const glStats = glStub.stats();
  console.log(
    `Tile updates:     ${totalTilePairs} pairs total, ` +
      `mean ${(totalTilePairs / Math.max(1, n)).toFixed(0)}/tick, max ${maxTilePairs}/tick`,
  );
  console.log(
    `Unit updates:     ${unitUpdatesTotal} total, ` +
      `mean ${(unitUpdatesTotal / Math.max(1, n)).toFixed(1)}/tick`,
  );
  console.log(
    `Player updates:   ${playerUpdatesTotal} total, ` +
      `mean ${(playerUpdatesTotal / Math.max(1, n)).toFixed(1)}/tick`,
  );
  console.log(
    `GPU dispatch:     updateUnits saw ${glStats.unitsSeen} unit-entries, ` +
      `updateNames saw ${glStats.namesSeen} name-entries, ` +
      `uploadLiveDelta saw ${glStats.changedTilesSeen} tiles ` +
      `(all across whole run; per-entry CPU cost not measured — see header)`,
  );

  if (profile) {
    console.log(
      `\n--- Top client-side functions by self time (V8 sampling profiler) ---`,
    );
    console.log(
      `(%, of the whole game phase including the sim — client work is the` +
        ` clone/view/builder share above)`,
    );
    const fns = summarizeCpuProfile(profile, PROJECT_ROOT).filter(
      (f) =>
        f.location.startsWith("src/client") ||
        f.functionName.includes("structuredClone") ||
        f.functionName.includes("deserialize") ||
        f.functionName.includes("serialize"),
    );
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
      `client-${opts.map.replace(/\W+/g, "_")}-${opts.seed}.cpuprofile`,
    );
    fs.writeFileSync(outFile, JSON.stringify(profile));
    console.log(
      `\nCPU profile written to ${path.relative(PROJECT_ROOT, outFile)}` +
        ` (open in Chrome DevTools > Performance; sim frames included — ` +
        `filter by src/client)`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
