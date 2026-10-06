/**
 * End-Game High-Unit-Density Performance Benchmark.
 *
 * Models a massive late-game FFA scenario with 4 players:
 * - Each player has:
 *   - 100 Cities
 *   - 50 Factories connected to cities via rail networks
 *   - 2 Level-50 Ports spawning high-capacity trade ships
 *   - 15 Warships patrolling coastal water
 *   - 50 Level-1 SAM launchers + 1 Level-30 SAM launcher
 *   - 10 Missile Silos
 * - 120-tick pre-roll warm-up: ensures rail networks are fully populated with
 *   moving trains, ports have launched trade ships, and warships are patrolling.
 * - At tick 120: synchronized combat launch:
 *   - P1 and P2 launch MIRVs at each other's cities (separating mid-flight)
 *   - P3 and P4 launch Hydrogen Bombs at each other's cities
 *   - 204 SAM batteries detect the incoming swarm and fire interceptor missiles
 * - Measures worker sim tick time, structuredClone transfer, GameView.update,
 *   and WebGLFrameBuilder.update over the peak burst flight window.
 *
 * Usage:
 *   npx tsx tests/perf/client/EndGameUpdatePerf.ts [--ticks 270] [--preroll 120] [--map world]
 */

import "./Shims"; // must be first: browser-global shims for client code

import { TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { GameConfig, GameStartInfo } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { CityExecution } from "@openfront/engine/execution/CityExecution";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import { MirvExecution } from "@openfront/engine/execution/MIRVExecution";
import { MissileSiloExecution } from "@openfront/engine/execution/MissileSiloExecution";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { PortExecution } from "@openfront/engine/execution/PortExecution";
import { SAMLauncherExecution } from "@openfront/engine/execution/SAMLauncherExecution";
import { WarshipExecution } from "@openfront/engine/execution/WarshipExecution";
import { Player, Unit } from "@openfront/engine/game/Game";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import path from "path";
import { fileURLToPath } from "url";
import { GameView } from "../../../src/client/view/GameView";
import { WebGLFrameBuilder } from "../../../src/client/WebGLFrameBuilder";
import type { WorkerClient } from "../../../src/client/WorkerClient";
import { NodeGameMapLoader } from "../fullgame/NodeGameMapLoader";
import { TickStats } from "../fullgame/Profiler";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const FRAME_BUDGET_MS = 16.7;

interface Options {
  map: GameMapType;
  totalTicks: number;
  prerollTicks: number;
  seed: string;
}

function parseArgs(args: string[]): Options {
  let map = GameMapType.World;
  let totalTicks = 270;
  let prerollTicks = 120;
  let seed = "perf-endgame";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--map" && i + 1 < args.length) {
      const key = Object.keys(GameMapType).find(
        (k) => k.toLowerCase() === args[++i].toLowerCase(),
      );
      if (key) map = GameMapType[key as keyof typeof GameMapType];
    } else if (arg === "--ticks" && i + 1 < args.length) {
      totalTicks = parseInt(args[++i], 10);
    } else if (arg === "--preroll" && i + 1 < args.length) {
      prerollTicks = parseInt(args[++i], 10);
    } else if (arg === "--seed" && i + 1 < args.length) {
      seed = args[++i];
    }
  }

  return { map, totalTicks, prerollTicks, seed };
}

function createGlStub() {
  const counts = new Map<string, number>();
  let unitsSeen = 0;
  let namesSeen = 0;
  let changedTilesSeen = 0;
  const bump = (name: string, by = 1) =>
    counts.set(name, (counts.get(name) ?? 0) + by);
  const noop = (name: string) => () => bump(name);

  const view = {
    addPlayers: (players: unknown[]) => bump("addPlayers", players.length),
    updatePalette: noop("updatePalette"),
    setPlayerSkin: noop("setPlayerSkin"),
    setPlayerSpawn: noop("setPlayerSpawn"),
    setLocalPlayerID: noop("setLocalPlayerID"),
    setLocalRailColor: noop("setLocalRailColor"),
    updateSpawnOverlay: noop("updateSpawnOverlay"),
    initSkinAtlas: noop("initSkinAtlas"),
    applyTerrainRects: (rects: unknown[]) =>
      bump("applyTerrainRects", rects.length),
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
    updateSmallPlayerGlow: noop("updateSmallPlayerGlow"),
    updateSpiralRibbons: noop("updateSpiralRibbons"),
  };
  return {
    view,
    counts,
    stats: () => ({ unitsSeen, namesSeen, changedTilesSeen }),
  };
}

class Fnv32 {
  private h = 0x811c9dc5;
  mixByte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }
  mixU32(u: number): void {
    this.mixByte(u);
    this.mixByte(u >>> 8);
    this.mixByte(u >>> 16);
    this.mixByte(u >>> 24);
  }
  mixString(s: string): void {
    for (let i = 0; i < s.length; i++) {
      this.mixU32(s.charCodeAt(i));
    }
  }
  digest(): string {
    return (this.h >>> 0).toString(16).padStart(8, "0");
  }
}

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
  for (const state of gameView.unitStates().values()) {
    fnv.mixString(JSON.stringify(state));
  }
  return fnv.digest();
}

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

interface PlayerSetup {
  player: Player;
  cities: Unit[];
  ports: Unit[];
  silos: Unit[];
}

function seedPlayerTerritory(
  game: any,
  player: Player,
  centerTile: TileRef,
  targetTileCount = 2000,
): TileRef[] {
  const owned: TileRef[] = [];
  const queue: TileRef[] = [centerTile];
  const visited = new Set<TileRef>([centerTile]);

  (player as any).addGold(1_000_000_000_000n);
  (player as any).addTroops(100_000_000);

  while (queue.length > 0 && owned.length < targetTileCount) {
    const curr = queue.shift()!;
    if (game.isLand(curr) && !game.isImpassable(curr)) {
      (player as any).conquer(curr);
      owned.push(curr);

      const neighbors = game.neighbors(curr);
      for (const next of neighbors) {
        if (
          !visited.has(next) &&
          game.isLand(next) &&
          !game.isImpassable(next)
        ) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
  }

  return owned;
}

function setupPlayerEndGame(
  game: any,
  player: Player,
  territory: TileRef[],
): PlayerSetup {
  const cities: Unit[] = [];
  const ports: Unit[] = [];
  const silos: Unit[] = [];

  const landTiles = territory.filter(
    (t) => game.isLand(t) && !game.isImpassable(t),
  );
  const shoreTiles = landTiles.filter((t) => game.isShore(t));

  const occupiedTiles = new Set<TileRef>();

  // 1. Ports (2 Level-50 ports)
  for (let i = 0; i < Math.min(2, shoreTiles.length); i++) {
    const tile = shoreTiles[i];
    try {
      const port = (player as any).buildUnit(UnitType.Port, tile, {});
      occupiedTiles.add(tile);
      for (let lvl = 1; lvl < 50; lvl++) {
        port.increaseLevel();
      }
      game.addExecution(new PortExecution(port));
      ports.push(port);
    } catch (err: any) {
      console.warn("Port build error:", err?.message ?? err);
    }
  }

  // 2. Warships (15 warships in water)
  let warshipsSpawned = 0;
  for (const port of ports) {
    const neighbors = game.neighbors(port.tile());
    for (const w of neighbors) {
      if (game.isWater(w) && !occupiedTiles.has(w) && warshipsSpawned < 15) {
        try {
          const warship = (player as any).buildUnit(UnitType.Warship, w, {
            patrolTile: w,
          });
          occupiedTiles.add(w);
          game.addExecution(new WarshipExecution(warship));
          warshipsSpawned++;
        } catch {
          // ignore
        }
      }
    }
  }

  // 3. Cities (100 cities)
  const cityInterval = Math.max(1, Math.floor(landTiles.length / 150));
  let tileIdx = 0;
  while (cities.length < 100 && tileIdx < landTiles.length) {
    const tile = landTiles[tileIdx];
    tileIdx += cityInterval;
    if (!occupiedTiles.has(tile)) {
      try {
        const city = (player as any).buildUnit(UnitType.City, tile, {});
        occupiedTiles.add(tile);
        game.addExecution(new CityExecution(city));
        cities.push(city);
      } catch {
        // ignore
      }
    }
  }

  // 4. Factories (50 factories connected to nearby cities)
  let factoriesSpawned = 0;
  for (let i = 0; i < cities.length && factoriesSpawned < 50; i++) {
    const cityTile = cities[i].tile();
    const neighbors = game.neighbors(cityTile);
    const freeLand = neighbors.find(
      (n: TileRef) =>
        game.isLand(n) &&
        !game.isImpassable(n) &&
        game.owner(n) === player &&
        !occupiedTiles.has(n),
    );
    if (freeLand) {
      try {
        const factory = (player as any).buildUnit(
          UnitType.Factory,
          freeLand,
          {},
        );
        occupiedTiles.add(freeLand);
        game.addExecution(new FactoryExecution(factory));
        factoriesSpawned++;
      } catch {
        // ignore
      }
    }
  }

  // 5. SAM Launchers (50 Level-1 SAMs + 1 Level-30 SAM)
  let samSpawned = 0;
  for (let i = 0; i < landTiles.length && samSpawned < 51; i += 7) {
    const tile = landTiles[i];
    if (!occupiedTiles.has(tile)) {
      try {
        const sam = (player as any).buildUnit(UnitType.SAMLauncher, tile, {});
        occupiedTiles.add(tile);
        if (samSpawned === 0) {
          for (let lvl = 1; lvl < 30; lvl++) {
            sam.increaseLevel();
          }
        }
        game.addExecution(new SAMLauncherExecution(player, null, sam));
        samSpawned++;
      } catch {
        // ignore
      }
    }
  }

  // 6. Missile Silos (10 silos)
  let silosSpawned = 0;
  for (let i = 2; i < landTiles.length && silosSpawned < 10; i += 13) {
    const tile = landTiles[i];
    if (!occupiedTiles.has(tile)) {
      try {
        const silo = (player as any).buildUnit(UnitType.MissileSilo, tile, {});
        occupiedTiles.add(tile);
        game.addExecution(new MissileSiloExecution(silo));
        silos.push(silo);
        silosSpawned++;
      } catch {
        // ignore
      }
    }
  }

  return { player, cities, ports, silos };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.debug = () => {};

  const gameConfig: GameConfig = {
    gameMap: opts.map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    spawnImmunityDuration: 0,
  };

  const playersList = [
    { clientID: "P1", username: "Player 1", clanTag: null },
    { clientID: "P2", username: "Player 2", clanTag: null },
    { clientID: "P3", username: "Player 3", clanTag: null },
    { clientID: "P4", username: "Player 4", clanTag: null },
  ];

  const gameStart: GameStartInfo = {
    gameID: opts.seed,
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: playersList,
  };

  console.log(
    `[EndGameUpdatePerf] Initializing 4-player end-game setup on "${opts.map}"...`,
  );

  const mapLoader = new NodeGameMapLoader(
    path.join(PROJECT_ROOT, "resources/maps"),
  );

  let currentGu: GameUpdateViewData | null;
  let lastHash: HashUpdate | undefined;
  let fatalError: string | undefined;

  const mapFiles = await loadMapFiles(
    mapLoader,
    gameConfig.gameMap,
    gameConfig.gameMapSize,
  );
  const runner = await createGameRunner(
    gameStart,
    undefined,
    mapFiles,
    (gu: GameUpdateViewData | ErrorUpdate) => {
      if ("errMsg" in gu) {
        fatalError = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      currentGu = gu;
    },
  );

  const clientConfig = new Config(gameConfig, false);
  const clientMapData = await loadTerrainMap(mapFiles);
  const gameView = new GameView(
    {} as unknown as WorkerClient,
    clientConfig,
    clientMapData,
    undefined,
    "perf-harness",
    null,
    gameStart.gameID,
    gameStart.players,
  );
  const glStub = createGlStub();
  const builder = new WebGLFrameBuilder(glStub.view as any);

  (runner.game.config() as any).mirvLaunchCooldown = () => 0;
  (clientConfig as any).mirvLaunchCooldown = () => 0;

  runner.game.endSpawnPhase();

  const players = runner.game.allPlayers().filter((p: Player) => p.isPlayer());
  const mapW = runner.game.map().width();
  const mapH = runner.game.map().height();

  function findShoreInQuadrant(
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
  ): TileRef {
    for (let y = Math.floor(yMin); y < Math.floor(yMax); y += 3) {
      for (let x = Math.floor(xMin); x < Math.floor(xMax); x += 3) {
        const ref = runner.game.ref(x, y);
        if (runner.game.isShore(ref) && !runner.game.isImpassable(ref)) {
          return ref;
        }
      }
    }
    for (let y = Math.floor(yMin); y < Math.floor(yMax); y += 5) {
      for (let x = Math.floor(xMin); x < Math.floor(xMax); x += 5) {
        const ref = runner.game.ref(x, y);
        if (runner.game.isLand(ref) && !runner.game.isImpassable(ref)) {
          return ref;
        }
      }
    }
    return runner.game.ref(
      Math.floor((xMin + xMax) / 2),
      Math.floor((yMin + yMax) / 2),
    );
  }

  const centers = [
    findShoreInQuadrant(mapW * 0.15, mapW * 0.4, mapH * 0.15, mapH * 0.45),
    findShoreInQuadrant(mapW * 0.6, mapW * 0.85, mapH * 0.15, mapH * 0.45),
    findShoreInQuadrant(mapW * 0.2, mapW * 0.45, mapH * 0.55, mapH * 0.85),
    findShoreInQuadrant(mapW * 0.55, mapW * 0.85, mapH * 0.55, mapH * 0.85),
  ];

  const setups: PlayerSetup[] = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    const territory = seedPlayerTerritory(runner.game, p, centers[i], 2200);
    const setup = setupPlayerEndGame(runner.game, p, territory);
    setups.push(setup);
    console.log(
      `  - ${p.displayName?.() ?? p.name() ?? `Player ${i + 1}`}: ${setup.cities.length} cities, ${setup.ports.length} ports, ` +
        `${setup.silos.length} silos, territory: ${territory.length} tiles`,
    );
  }

  console.log(
    `\n=== Phase 1: Pre-Roll Warm-up (${opts.prerollTicks} ticks) ===\n` +
      `Saturating rail tracks with trains, sea lanes with trade ships, and naval patrols...`,
  );

  let turnNumber = 0;
  const prerollStart = performance.now();
  for (let tick = 0; tick < opts.prerollTicks; tick++) {
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });
    currentGu = null;
    runner.executeNextTick();
    if (fatalError) throw new Error(fatalError);

    if (currentGu) {
      const gu: GameUpdateViewData = currentGu;
      const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes && hashes.length > 0) {
        lastHash = hashes[hashes.length - 1];
      }

      const transfers: Transferable[] = [gu.packedTileUpdates.buffer];
      if (gu.packedMotionPlans) transfers.push(gu.packedMotionPlans.buffer);
      if (gu.packedPlayerUpdates) transfers.push(gu.packedPlayerUpdates.buffer);
      if (gu.packedAttackUpdates) transfers.push(gu.packedAttackUpdates.buffer);
      if (gu.packedUnitUpdates) transfers.push(gu.packedUnitUpdates.buffer);

      const cloned = structuredClone(gu, { transfer: transfers });
      gameView.update(cloned);
      builder.update(gameView);
    }
  }

  console.log(
    `Pre-roll done in ${fmtMs(performance.now() - prerollStart)}ms. Active units on board: ` +
      `${runner.game.units().length} units.`,
  );

  // Phase 2: Combat Launch
  console.log(
    `\n=== Phase 2: Combat Launch & Peak Measurement ===\n` +
      `Launching 20 MIRVs (P1 <-> P2) and 20 Hydrogen Bombs (P3 <-> P4)...`,
  );

  const p1 = setups[0];
  const p2 = setups[1];
  const p3 = setups[2];
  const p4 = setups[3];

  // P1 <-> P2: MIRVs (1 each, will separate into multiple sub-warheads)
  runner.game.addExecution(new MirvExecution(p1.player, p2.cities[0].tile()));
  runner.game.addExecution(new MirvExecution(p2.player, p1.cities[0].tile()));

  // P3 <-> P4: Hydrogen Bombs
  for (let i = 0; i < Math.min(10, p4.cities.length); i++) {
    runner.game.addExecution(
      new NukeExecution(UnitType.HydrogenBomb, p3.player, p4.cities[i].tile()),
    );
  }
  for (let i = 0; i < Math.min(10, p3.cities.length); i++) {
    runner.game.addExecution(
      new NukeExecution(UnitType.HydrogenBomb, p4.player, p3.cities[i].tile()),
    );
  }

  // Stats
  const stats = {
    sim: new TickStats(),
    clone: new TickStats(),
    view: new TickStats(),
    builder: new TickStats(),
    total: new TickStats(),
  };

  let maxUnits = 0;
  let maxBurstMs = 0;
  let maxBurstTick = 0;
  let unitUpdatesTotal = 0;
  let tileUpdatesTotal = 0;

  const measureTicks = opts.totalTicks - opts.prerollTicks;
  console.log(
    `Recording next ${measureTicks} ticks through flight and interception...`,
  );

  for (let i = 0; i < measureTicks; i++) {
    const currentTick = opts.prerollTicks + i;
    runner.addTurn({ turnNumber: turnNumber++, intents: [] });
    currentGu = null;

    let start = performance.now();
    runner.executeNextTick();
    const simMs = performance.now() - start;
    stats.sim.record(currentTick, simMs);

    if (fatalError) throw new Error(fatalError);
    if (!currentGu) continue;

    const gu: GameUpdateViewData = currentGu;
    tileUpdatesTotal += gu.packedTileUpdates.length / 2;
    if (gu.updates[GameUpdateType.Unit]) {
      unitUpdatesTotal += gu.updates[GameUpdateType.Unit].length;
    }
    const hashes = gu.updates[GameUpdateType.Hash] as HashUpdate[];
    if (hashes && hashes.length > 0) {
      lastHash = hashes[hashes.length - 1];
    }

    const currentUnitCount = runner.game.units().length;
    if (currentUnitCount > maxUnits) maxUnits = currentUnitCount;

    const transfers: Transferable[] = [gu.packedTileUpdates.buffer];
    if (gu.packedMotionPlans) transfers.push(gu.packedMotionPlans.buffer);
    if (gu.packedPlayerUpdates) transfers.push(gu.packedPlayerUpdates.buffer);
    if (gu.packedAttackUpdates) transfers.push(gu.packedAttackUpdates.buffer);
    if (gu.packedUnitUpdates) transfers.push(gu.packedUnitUpdates.buffer);

    start = performance.now();
    const cloned = structuredClone(gu, { transfer: transfers });
    const cloneMs = performance.now() - start;
    stats.clone.record(currentTick, cloneMs);

    start = performance.now();
    gameView.update(cloned);
    const viewMs = performance.now() - start;
    stats.view.record(currentTick, viewMs);

    start = performance.now();
    builder.update(gameView);
    const builderMs = performance.now() - start;
    stats.builder.record(currentTick, builderMs);

    const burstMs = cloneMs + viewMs + builderMs;
    stats.total.record(currentTick, burstMs);

    if (burstMs > maxBurstMs) {
      maxBurstMs = burstMs;
      maxBurstTick = currentTick;
    }
  }

  // Summary
  const sTotal = stats.total.summarize(FRAME_BUDGET_MS);
  const sClone = stats.clone.summarize(FRAME_BUDGET_MS);
  const sView = stats.view.summarize(FRAME_BUDGET_MS);
  const sBuilder = stats.builder.summarize(FRAME_BUDGET_MS);
  const sSim = stats.sim.summarize(100);

  const viewHash = computeViewHash(gameView);

  console.log("\n" + "=".repeat(72));
  console.log("End-Game High-Unit Performance Results");
  console.log("=".repeat(72));

  console.log(`\n--- Peak Load State ---`);
  console.log(`Peak concurrent units on board: ${maxUnits}`);
  console.log(`Total tile updates: ${tileUpdatesTotal}`);
  console.log(`Total unit updates: ${unitUpdatesTotal}`);
  console.log(
    `Peak burst latency: ${fmtMs(maxBurstMs)}ms on tick #${maxBurstTick}`,
  );
  console.log(
    `Sim final hash: ${lastHash ? `${lastHash.hash} (tick ${lastHash.tick})` : "n/a"} | View hash: ${viewHash}`,
  );

  console.log(
    `\n--- Main-Thread Burst per Tick (${sTotal.count} measured ticks) ---`,
  );
  const rows = [
    [
      "clone (serialize+deserialize)",
      fmtMs(sClone.meanMs),
      fmtMs(sClone.p50Ms),
      fmtMs(sClone.p95Ms),
      fmtMs(sClone.p99Ms),
      fmtMs(sClone.maxMs),
      fmtMs(sClone.totalMs),
      `${sClone.overBudget} / ${sClone.count}`,
    ],
    [
      "GameView.update",
      fmtMs(sView.meanMs),
      fmtMs(sView.p50Ms),
      fmtMs(sView.p95Ms),
      fmtMs(sView.p99Ms),
      fmtMs(sView.maxMs),
      fmtMs(sView.totalMs),
      `${sView.overBudget} / ${sView.count}`,
    ],
    [
      "WebGLFrameBuilder.update",
      fmtMs(sBuilder.meanMs),
      fmtMs(sBuilder.p50Ms),
      fmtMs(sBuilder.p95Ms),
      fmtMs(sBuilder.p99Ms),
      fmtMs(sBuilder.maxMs),
      fmtMs(sBuilder.totalMs),
      `${sBuilder.overBudget} / ${sBuilder.count}`,
    ],
    [
      "TOTAL main-thread burst",
      fmtMs(sTotal.meanMs),
      fmtMs(sTotal.p50Ms),
      fmtMs(sTotal.p95Ms),
      fmtMs(sTotal.p99Ms),
      fmtMs(sTotal.maxMs),
      fmtMs(sTotal.totalMs),
      `${sTotal.overBudget} / ${sTotal.count}`,
    ],
    [
      "(sim tick, worker-side)",
      fmtMs(sSim.meanMs),
      fmtMs(sSim.p50Ms),
      fmtMs(sSim.p95Ms),
      fmtMs(sSim.p99Ms),
      fmtMs(sSim.maxMs),
      fmtMs(sSim.totalMs),
      `${sSim.overBudget} / ${sSim.count}`,
    ],
  ];

  console.log(
    table(
      ["stage", "mean", "p50", "p95", "p99", "max", "total ms", ">16.7ms"],
      rows,
    ),
  );

  console.log(`\nSlowest bursts:`);
  for (const item of sTotal.slowest.slice(0, 5)) {
    console.log(`  - Tick #${item.tick}: ${fmtMs(item.ms)}ms`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
