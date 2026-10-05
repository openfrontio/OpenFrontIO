import { performance } from "node:perf_hooks";
import { PlayerType, UnitType } from "../../src/core/game/Game";
import type { RailPathFinderService } from "../../src/core/game/RailNetworkImpl";
import { playerInfo, setup } from "../util/Setup";

const WARMUP_QUERIES = 50;
const MEASURED_QUERIES = 500;

interface Measurement {
  name: string;
  implementation: "legacy-independent" | "sequential-shadow";
  structures: number;
  pathsPerQuery: number;
  pathfinderCallsPerQuery: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  operationsPerSecond: number;
  approximateHeapBytesPerQuery: number;
}

const scenarios = [
  { name: "typical", structures: 2 },
  { name: "busy", structures: 5 },
  { name: "dense", structures: 20 },
] as const;

function percentile(sorted: number[], fraction: number): number {
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

async function measureScenario(
  name: string,
  structureCount: number,
): Promise<Measurement[]> {
  const game = await setup("plains", {}, [
    playerInfo("preview-player", PlayerType.Human),
  ]);
  const player = game.player("preview-player")!;

  const positions: Array<readonly [number, number]> = [];
  for (let y = 5; y <= 77 && positions.length < structureCount; y += 18) {
    for (let x = 5; x <= 77 && positions.length < structureCount; x += 18) {
      positions.push([x, y]);
    }
  }
  for (const [x, y] of positions) {
    player.buildUnit(UnitType.City, game.ref(x, y), {});
  }

  // Move over several neighboring tiles so the benchmark exercises the same
  // changing-input pattern as a player dragging a factory ghost around.
  const cursorTiles = [
    game.ref(42, 42),
    game.ref(43, 42),
    game.ref(44, 43),
    game.ref(45, 44),
    game.ref(46, 45),
    game.ref(47, 46),
    game.ref(48, 47),
    game.ref(49, 48),
  ];

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

  const measure = (
    implementation: Measurement["implementation"],
    queryAt: (tile: number) => number,
  ): Measurement => {
    let cursor = 0;
    const query = () => queryAt(cursorTiles[cursor++ % cursorTiles.length]);
    for (let i = 0; i < WARMUP_QUERIES; i++) query();
    pathfinderCalls = 0;
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const samples = new Array<number>(MEASURED_QUERIES);
    let totalPaths = 0;
    for (let i = 0; i < MEASURED_QUERIES; i++) {
      const start = performance.now();
      totalPaths += query();
      samples[i] = performance.now() - start;
    }
    const heapAfter = process.memoryUsage().heapUsed;

    samples.sort((a, b) => a - b);
    const totalMs = samples.reduce((sum, sample) => sum + sample, 0);
    const meanMs = totalMs / samples.length;
    return {
      name,
      implementation,
      structures: structureCount,
      pathsPerQuery: round(totalPaths / MEASURED_QUERIES),
      pathfinderCallsPerQuery: round(pathfinderCalls / MEASURED_QUERIES),
      meanMs: round(meanMs),
      medianMs: round(percentile(samples, 0.5)),
      p95Ms: round(percentile(samples, 0.95)),
      maxMs: round(samples[samples.length - 1]),
      operationsPerSecond: Math.round(1000 / meanMs),
      approximateHeapBytesPerQuery: Math.round(
        (heapAfter - heapBefore) / MEASURED_QUERIES,
      ),
    };
  };

  return [
    measure("legacy-independent", legacyQuery),
    measure(
      "sequential-shadow",
      (tile) => network.computeGhostRailPaths(UnitType.Factory, tile).length,
    ),
  ];
}

const results: Measurement[] = [];
for (const scenario of scenarios) {
  results.push(...(await measureScenario(scenario.name, scenario.structures)));
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

console.log("Rail preview performance (moving-cursor core queries)");
console.table(results);
console.log(
  "Sequential planner difference from the legacy independent preview",
);
console.table(comparisons);
console.log(JSON.stringify({ results, comparisons }, null, 2));
console.log(
  "Heap bytes/query is an approximate allocation proxy; run Node with --expose-gc for a cleaner comparison.",
);
