/**
 * Rail ghost-preview CPU benchmark (engine side).
 *
 * Usage:
 *   npx tsx tests/perf/RailPreviewPerf.ts
 *
 * Measures RailNetwork.computeGhostRailPaths, the worker-side cost of the build
 * preview's rail ghost, as the client calls it: once per game update while a
 * structure ghost is up. "moving" drags the cursor over more distinct tiles
 * than the preview memo remembers, so every query plans afresh; "parked"
 * repeats one tile, the common case of a player reading the preview.
 *
 * The script depends only on the public RailNetwork API, so the same file runs
 * against another checkout (e.g. main) for a before/after comparison.
 */
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { FactoryExecution } from "@openfront/engine/execution/FactoryExecution";
import type { RailPathFinderService } from "@openfront/engine/game/RailNetworkImpl";
import { performance } from "node:perf_hooks";
import { playerInfo, setup } from "../util/Setup";

const WARMUP_QUERIES = 20;
const MEASURED_QUERIES = 200;
/** More distinct tiles than the preview memo (32 entries) remembers. */
const MOVING_CURSOR_TILES = 48;

interface Scenario {
  name: string;
  map: string;
  /** Map side in tiles; cities are laid on a grid across it. */
  size: number;
  /** Grid spacing of the Cities laid across the map. */
  citySpacing: number;
  /** Cap on the number of cities; undefined for the whole grid. */
  cities?: number;
  /**
   * Grid spacing of Factories whose executions run before measuring, so a
   * live rail network with stations exists. Undefined: no network yet.
   */
  factorySpacing?: number;
  /** The structure being previewed. */
  ghost: UnitType.Factory | UnitType.City;
}

const scenarios: Scenario[] = [
  {
    name: "plains, 2 cities",
    map: "plains",
    size: 80,
    citySpacing: 18,
    cities: 2,
    ghost: UnitType.Factory,
  },
  {
    name: "plains, 5 cities",
    map: "plains",
    size: 80,
    citySpacing: 18,
    cities: 5,
    ghost: UnitType.Factory,
  },
  {
    name: "plains, 20 cities",
    map: "plains",
    size: 80,
    citySpacing: 18,
    cities: 20,
    ghost: UnitType.Factory,
  },
  {
    name: "big_plains, cities 20 apart",
    map: "big_plains",
    size: 200,
    citySpacing: 20,
    ghost: UnitType.Factory,
  },
  {
    name: "big_plains, cities 12 apart",
    map: "big_plains",
    size: 200,
    citySpacing: 12,
    ghost: UnitType.Factory,
  },
  {
    name: "big_plains, late-game network, city ghost",
    map: "big_plains",
    size: 200,
    citySpacing: 12,
    factorySpacing: 48,
    ghost: UnitType.City,
  },
];

interface Measurement {
  scenario: string;
  cursor: "moving" | "parked";
  /** Distinct tiles the cursor visits (1 when parked). */
  cursorTiles: number;
  structures: number;
  stations: number;
  rails: number;
  pathsPerQuery: number;
  pathfinderCallsPerQuery: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

async function measureScenario(scenario: Scenario): Promise<Measurement[]> {
  const game = await setup(scenario.map, {}, [
    playerInfo("preview-player", PlayerType.Human),
  ]);
  const player = game.player("preview-player")!;
  const limit = scenario.cities ?? Infinity;

  let structures = 0;
  for (
    let y = 5;
    y < scenario.size && structures < limit;
    y += scenario.citySpacing
  ) {
    for (
      let x = 5;
      x < scenario.size && structures < limit;
      x += scenario.citySpacing
    ) {
      player.buildUnit(UnitType.City, game.ref(x, y), {});
      structures++;
    }
  }
  if (scenario.factorySpacing !== undefined) {
    const step = scenario.factorySpacing;
    for (let y = 11; y < scenario.size; y += step) {
      for (let x = 11; x < scenario.size; x += step) {
        const factory = player.buildUnit(UnitType.Factory, game.ref(x, y), {});
        game.addExecution(new FactoryExecution(factory));
        structures++;
      }
    }
    // Station executions connect on their first ticks.
    for (let i = 0; i < 20; i++) game.executeNextTick();
  }

  const network = game.railNetwork();
  const stations = network.stationManager().getAll();
  const rails = new Set<unknown>();
  for (const station of stations) {
    for (const rail of station.getRailroads()) rails.add(rail);
  }

  const cursorTiles = pickCursorTiles(game, scenario);

  const networkInternals = network as unknown as {
    pathService: RailPathFinderService;
  };
  const realPathService = networkInternals.pathService;
  let pathfinderCalls = 0;
  networkInternals.pathService = {
    findTilePath(from, to) {
      pathfinderCalls++;
      return realPathService.findTilePath(from, to);
    },
    findStationsPath(from, to) {
      return realPathService.findStationsPath(from, to);
    },
  };

  const measure = (cursor: Measurement["cursor"]): Measurement => {
    let step = 0;
    const query = () => {
      const tile =
        cursor === "moving"
          ? cursorTiles[step++ % cursorTiles.length]
          : cursorTiles[0];
      return network.computeGhostRailPaths(scenario.ghost, tile).length;
    };
    for (let i = 0; i < WARMUP_QUERIES; i++) query();
    pathfinderCalls = 0;
    const samples = new Array<number>(MEASURED_QUERIES);
    let totalPaths = 0;
    for (let i = 0; i < MEASURED_QUERIES; i++) {
      const start = performance.now();
      totalPaths += query();
      samples[i] = performance.now() - start;
    }

    samples.sort((a, b) => a - b);
    const totalMs = samples.reduce((sum, sample) => sum + sample, 0);
    return {
      scenario: scenario.name,
      cursor,
      cursorTiles: cursor === "moving" ? cursorTiles.length : 1,
      structures,
      stations: stations.size,
      rails: rails.size,
      pathsPerQuery: round(totalPaths / MEASURED_QUERIES),
      pathfinderCallsPerQuery: round(pathfinderCalls / MEASURED_QUERIES),
      meanMs: round(totalMs / samples.length),
      medianMs: round(percentile(samples, 0.5)),
      p95Ms: round(percentile(samples, 0.95)),
      maxMs: round(samples[samples.length - 1]),
    };
  };

  return [measure("moving"), measure("parked")];
}

/**
 * Tiles the cursor visits. A factory ghost can go anywhere, so it sweeps two
 * rows through the middle of the map. A city ghost only previews rails where
 * a factory is in range and no rail is close enough to snap onto, so those
 * tiles are picked from a sparse scan of the map.
 */
function pickCursorTiles(
  game: Awaited<ReturnType<typeof setup>>,
  scenario: Scenario,
): number[] {
  const tiles: number[] = [];
  if (scenario.ghost === UnitType.Factory) {
    const center = Math.floor(scenario.size / 2) + 2;
    const half = MOVING_CURSOR_TILES / 2;
    for (let i = 0; i < half; i++) {
      tiles.push(game.ref(center - half / 2 + i, center));
    }
    for (let i = 0; i < half; i++) {
      tiles.push(game.ref(center + half / 2 - 1 - i, center + 1));
    }
    return tiles;
  }

  // Every tile that previews a rail, then an even spread over them. On a
  // dense network few tiles qualify; the table reports how many were used.
  const network = game.railNetwork();
  const maxRange = game.config().trainStationMaxRange();
  const candidates: number[] = [];
  for (let y = 10; y < scenario.size - 10; y++) {
    for (let x = 10; x < scenario.size - 10; x++) {
      const tile = game.ref(x, y);
      if (network.overlappingRailroads(UnitType.City, tile).length > 0)
        continue;
      if (!game.hasUnitNearby(tile, maxRange, UnitType.Factory)) continue;
      candidates.push(tile);
    }
  }
  if (candidates.length === 0) {
    throw new Error(`${scenario.name}: no tile previews a city rail`);
  }
  const stride = Math.max(
    1,
    Math.floor(candidates.length / MOVING_CURSOR_TILES),
  );
  for (
    let i = 0;
    i < candidates.length && tiles.length < MOVING_CURSOR_TILES;
    i += stride
  ) {
    tiles.push(candidates[i]);
  }
  return tiles;
}

const results: Measurement[] = [];
for (const scenario of scenarios) {
  results.push(...(await measureScenario(scenario)));
}

console.log(
  `Rail ghost preview: computeGhostRailPaths per query (${process.cwd()}, node ${process.version})`,
);
console.table(results);
console.log(JSON.stringify(results, null, 2));
