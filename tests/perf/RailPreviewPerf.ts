/**
 * Rail ghost-preview CPU benchmark (engine side).
 *
 * Usage:
 *   npx tsx tests/perf/RailPreviewPerf.ts
 *
 * Compares three ways of answering "what rails would this build create?":
 *   legacy-independent  main's preview: up to five paths from the cursor tile
 *   sequential-shadow   the ghost planner, cursor moving one tile per query
 *   sequential-parked   the ghost planner, cursor parked on one tile (cache hits)
 */
import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import type { RailPathFinderService } from "@openfront/engine/game/RailNetworkImpl";
import { performance } from "node:perf_hooks";
import { playerInfo, setup } from "../util/Setup";

const WARMUP_QUERIES = 20;
const MEASURED_QUERIES = 200;

type Implementation =
  | "legacy-independent"
  | "sequential-shadow"
  | "sequential-parked";

interface Measurement {
  name: string;
  implementation: Implementation;
  structures: number;
  pathsPerQuery: number;
  pathfinderCallsPerQuery: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  operationsPerSecond: number;
}

interface Scenario {
  name: string;
  map: string;
  /** Map side in tiles; cities are laid on a grid across it. */
  size: number;
  spacing: number;
  /** Cap on the number of cities, undefined for the whole grid. */
  structures?: number;
}

const scenarios: Scenario[] = [
  { name: "typical", map: "plains", size: 80, spacing: 18, structures: 2 },
  { name: "busy", map: "plains", size: 80, spacing: 18, structures: 5 },
  { name: "dense", map: "plains", size: 80, spacing: 18, structures: 20 },
  { name: "big-plains/20", map: "big_plains", size: 200, spacing: 20 },
  { name: "big-plains/12", map: "big_plains", size: 200, spacing: 12 },
];

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
  const limit = scenario.structures ?? Infinity;

  let structures = 0;
  for (
    let y = 5;
    y < scenario.size && structures < limit;
    y += scenario.spacing
  ) {
    for (
      let x = 5;
      x < scenario.size && structures < limit;
      x += scenario.spacing
    ) {
      player.buildUnit(UnitType.City, game.ref(x, y), {});
      structures++;
    }
  }

  // Drag the cursor over more distinct tiles than the preview memo remembers
  // (32), so every moving query plans afresh like a player dragging a factory
  // ghost around; the parked run repeats one tile and should hit the memo.
  const center = Math.floor(scenario.size / 2) + 2;
  const cursorTiles: number[] = [];
  for (let i = 0; i < 24; i++)
    cursorTiles.push(game.ref(center - 12 + i, center));
  for (let i = 0; i < 24; i++) {
    cursorTiles.push(game.ref(center + 11 - i, center + 1));
  }

  const network = game.railNetwork();
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

  const legacyQuery = (tile: number) => {
    const minRangeSquared = game.config().trainStationMinRange() ** 2;
    const maxPathSize = game.config().railroadMaxSize();
    const neighbors = game.nearbyUnits(
      tile,
      game.config().trainStationMaxRange(),
      [UnitType.City, UnitType.Factory, UnitType.Port],
    );
    neighbors.sort((a, b) => a.distSquared - b.distSquared);
    let paths = 0;
    for (const neighbor of neighbors) {
      if (paths >= 5) break;
      if (neighbor.distSquared <= minRangeSquared) continue;
      const neighborStation = network
        .stationManager()
        .findStation(neighbor.unit);
      const target = neighborStation?.tile() ?? neighbor.unit.tile();
      const path =
        !neighborStation && neighbor.unit.type() === UnitType.City
          ? networkInternals.pathService.findTilePath(target, tile)
          : networkInternals.pathService.findTilePath(tile, target);
      if (path.length > 0 && path.length < maxPathSize) paths++;
    }
    return paths;
  };

  const ghostQuery = (tile: number) =>
    network.computeGhostRailPaths(UnitType.Factory, tile).length;

  const measure = (
    implementation: Implementation,
    queryAt: (tile: number) => number,
    cursor: "moving" | "parked",
  ): Measurement => {
    let step = 0;
    const query = () =>
      queryAt(
        cursor === "moving"
          ? cursorTiles[step++ % cursorTiles.length]
          : cursorTiles[0],
      );
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
    const meanMs = totalMs / samples.length;
    return {
      name: scenario.name,
      implementation,
      structures,
      pathsPerQuery: round(totalPaths / MEASURED_QUERIES),
      pathfinderCallsPerQuery: round(pathfinderCalls / MEASURED_QUERIES),
      meanMs: round(meanMs),
      medianMs: round(percentile(samples, 0.5)),
      p95Ms: round(percentile(samples, 0.95)),
      maxMs: round(samples[samples.length - 1]),
      operationsPerSecond: Math.round(1000 / meanMs),
    };
  };

  return [
    measure("legacy-independent", legacyQuery, "moving"),
    measure("sequential-shadow", ghostQuery, "moving"),
    measure("sequential-parked", ghostQuery, "parked"),
  ];
}

const results: Measurement[] = [];
for (const scenario of scenarios) {
  results.push(...(await measureScenario(scenario)));
}

const comparisons = scenarios.map(({ name }) => {
  const before = results.find(
    (result) =>
      result.name === name && result.implementation === "legacy-independent",
  )!;
  const after = results.find(
    (result) =>
      result.name === name && result.implementation === "sequential-shadow",
  )!;
  return {
    name,
    meanDifferencePercent: round(
      ((after.meanMs - before.meanMs) / before.meanMs) * 100,
    ),
    p95DifferencePercent: round(
      ((after.p95Ms - before.p95Ms) / before.p95Ms) * 100,
    ),
  };
});

console.log("Rail preview performance (core queries)");
console.table(results);
console.log(
  "Sequential planner (moving cursor) difference from the legacy independent preview",
);
console.table(comparisons);
console.log(JSON.stringify({ results, comparisons }, null, 2));
