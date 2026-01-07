import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { Game, Difficulty, GameMapSize, GameMapType, GameMode, GameType, PlayerInfo } from '../../src/core/game/Game';
import { TileRef } from '../../src/core/game/GameMap';
import { PathFinder, PathFinders } from '../../src/core/pathfinding/PathFinder';
import { createGame } from '../../src/core/game/GameImpl';
import { genTerrainFromBin, MapManifest } from '../../src/core/game/TerrainMapLoader';
import { UserSettings } from '../../src/core/game/UserSettings';
import { GameConfig } from '../../src/core/Schemas';
import { TestConfig } from '../util/TestConfig';

export type BenchmarkRoute = {
  name: string,
  from: TileRef,
  to: TileRef,
}

export type BenchmarkResult = {
  route: string;
  executionTime: number | null;
  pathLength: number | null;
}

export type BenchmarkSummary = {
  totalRoutes: number;
  successfulRoutes: number;
  timedRoutes: number;
  totalDistance: number;
  totalTime: number;
  avgTime: number;
}

export function getAdapter(
  game: Game,
  name: string,
): PathFinder {
  switch (name) {
    case "legacy":
      return PathFinders.WaterLegacy(game, { iterations: 500_000, maxTries: 50 });
    case "default":
      return PathFinders.Water(game);
    default:
      throw new Error(`Unknown pathfinding adapter: ${name}`);
  }
}

export async function getScenario(
  scenarioName: string,
  adapterName: string = "default",
) {
  const scenario = await import(`./benchmark/scenarios/${scenarioName}.js`);
  const enableNavMesh = adapterName === "default";

  // Time game creation (includes NavMesh initialization for default adapter)
  const start = performance.now();
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.join(currentDir, "../..");
  const mapsDirectory = path.join(projectRoot, "resources/maps");
  const game = await setupFromPath(mapsDirectory, scenario.MAP_NAME, { disableNavMesh: !enableNavMesh });
  const initTime = performance.now() - start;

  const routes = scenario.ROUTES.map(
    ([fromName, toName]: [string, string]) => {
      const fromCoord: [number, number] = scenario.PORTS[fromName];
      const toCoord: [number, number] = scenario.PORTS[toName];

      return {
        name: `${fromName} → ${toName}`,
        from: game.ref(fromCoord[0], fromCoord[1]),
        to: game.ref(toCoord[0], toCoord[1]),
      };
    }
  );

  return {
    game,
    routes,
    initTime,
  };
}

export function measurePathLength(
  adapter: PathFinder,
  route: BenchmarkRoute,
): number | null {
  const path = adapter.findPath(route.from, route.to);
  return path ? path.length : null;
}

export function measureTime<T>(fn: () => T): { result: T; time: number } {
  const start = performance.now();
  const result = fn();
  const end = performance.now();
  return { result, time: end - start };
}

export function measureExecutionTime(
  adapter: PathFinder,
  route: BenchmarkRoute,
  executions: number = 1,
): number | null {
  const { time } = measureTime(() => {
    for (let i = 0; i < executions; i++) {
      adapter.findPath(route.from, route.to);
    }
  })

  return time / executions;
}

export function calculateStats(
  results: BenchmarkResult[]
): BenchmarkSummary {
  const successful = results.filter((r) => r.pathLength !== null);
  const timed = results.filter((r) => r.executionTime !== null);

  const totalDistance = successful.reduce((sum, r) => sum + r.pathLength!, 0);
  const totalTime = timed.reduce((sum, r) => sum + r.executionTime!, 0);
  const avgTime = timed.length > 0 ? totalTime / timed.length : 0;

  return {
    totalRoutes: results.length,
    successfulRoutes: successful.length,
    timedRoutes: timed.length,
    totalDistance,
    totalTime,
    avgTime,
  };
}

export function printRow(
  columns: (string | number)[], 
  widths: number[]
): void {
  const formatted = columns.map((col, i) => {
    const str = typeof col === 'number' ? col.toString() : col;
    return str.padEnd(widths[i]);
  });

  console.log(formatted.join(' '));
}

export function printSeparator(
  width: number = 80
): void {
  console.log('-'.repeat(width));
}

export function printHeader(
  title: string,
  width: number = 80
): void {
  printSeparator(width);
  console.log(title);
  printSeparator(width);
  console.log('');
}

export async function setupFromPath(
  mapDirectory: string,
  mapName: string,
  gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
): Promise<Game> {
  // Suppress console.debug for tests
  console.debug = () => {};

  // Load map files from specified directory
  const mapBinPath = path.join(mapDirectory, mapName, 'map.bin');
  const miniMapBinPath = path.join(mapDirectory, mapName, 'map4x.bin');
  const manifestPath = path.join(mapDirectory, mapName, 'manifest.json');

  // Check if files exist
  if (!fs.existsSync(mapBinPath)) {
    throw new Error(`Map not found: ${mapBinPath}`);
  }
  
  if (!fs.existsSync(miniMapBinPath)) {
    throw new Error(`Mini map not found: ${miniMapBinPath}`);
  }

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest not found: ${manifestPath}`);
  }

  const mapBinBuffer = fs.readFileSync(mapBinPath);
  const miniMapBinBuffer = fs.readFileSync(miniMapBinPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) satisfies MapManifest;

  const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
  const miniGameMap = await genTerrainFromBin(manifest.map4x, miniMapBinBuffer);

  // Configure the game
  const config = new TestConfig(
    new (await import('../util/TestServerConfig')).TestServerConfig(),
    {
      gameMap: GameMapType.Asia,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      disableNations: false,
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      ...gameConfig,
    },
    new UserSettings(),
    false,
  );

  return createGame(humans, [], gameMap, miniGameMap, config);
}
