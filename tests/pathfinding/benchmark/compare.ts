#!/usr/bin/env node

/**
 * Compare pathfinding adapters side-by-side
 *
 * Usage:
 *   npx tsx tests/pathfinding/benchmark/compare.ts <scenario> <adapters>
 *   npx tsx tests/pathfinding/benchmark/compare.ts --synthetic <map-name> <adapters>
 *
 * Examples:
 *   npx tsx tests/pathfinding/benchmark/compare.ts default hpa,legacy
 *   npx tsx tests/pathfinding/benchmark/compare.ts --synthetic giantworldmap hpa,legacy,a.optimized
 */

import {
  type BenchmarkResult,
  calculateStats,
  getAdapter,
  getScenario,
  measureExecutionTime,
  measurePathLength,
} from "../utils";

interface AdapterResults {
  adapter: string;
  initTime: number;
  totalTime: number;
  totalDistance: number;
  successfulRoutes: number;
  totalRoutes: number;
}

const DEFAULT_ITERATIONS = 1;

async function runBenchmark(
  scenarioName: string,
  adapterName: string,
): Promise<AdapterResults> {
  const { game, routes, initTime } = await getScenario(
    scenarioName,
    adapterName,
  );
  const adapter = getAdapter(game, adapterName);

  const results: BenchmarkResult[] = [];

  // Measure path lengths
  for (const route of routes) {
    const pathLength = measurePathLength(adapter, route);
    results.push({ route: route.name, pathLength, executionTime: null });
  }

  // Measure execution times
  for (const route of routes) {
    const result = results.find((r) => r.route === route.name);
    if (result && result.pathLength !== null) {
      const execTime = measureExecutionTime(adapter, route, DEFAULT_ITERATIONS);
      result.executionTime = execTime;
    }
  }

  const stats = calculateStats(results);

  return {
    adapter: adapterName,
    initTime,
    totalTime: stats.totalTime,
    totalDistance: stats.totalDistance,
    successfulRoutes: stats.successfulRoutes,
    totalRoutes: stats.totalRoutes,
  };
}

const TABLE_HEADERS = [
  "Adapter",
  "Init (ms)",
  "Path (ms)",
  "Distance",
  "Routes",
];

const TABLE_WIDTHS = [20, 12, 12, 12, 10];

function printTableHeader(scenarioName: string) {
  console.log(`\nResults: ${scenarioName}`);
  console.log("=".repeat(70));
  console.log(TABLE_HEADERS.map((h, i) => h.padEnd(TABLE_WIDTHS[i])).join(" "));
  console.log("-".repeat(70));
}

function printTableRow(r: AdapterResults) {
  const row = [
    r.adapter,
    r.initTime.toFixed(2),
    r.totalTime.toFixed(2),
    r.totalDistance.toString(),
    `${r.successfulRoutes}/${r.totalRoutes}`,
  ];
  console.log(row.map((c, i) => c.padEnd(TABLE_WIDTHS[i])).join(" "));
}

function printTableFooter() {
  console.log("-".repeat(70));
}

function printUsage() {
  console.log(`
Usage:
  npx tsx tests/pathfinding/benchmark/compare.ts <scenario> <adapters>
  npx tsx tests/pathfinding/benchmark/compare.ts --synthetic <map-name> <adapters>

Arguments:
  <scenario>    Name of the scenario (default: "default")
  <adapters>    Comma-separated list of adapters to compare (e.g., "hpa,legacy,a.optimized")

Examples:
  npx tsx tests/pathfinding/benchmark/compare.ts default hpa,legacy
  npx tsx tests/pathfinding/benchmark/compare.ts --synthetic giantworldmap hpa,legacy,a.optimized

Available adapters:
  hpa          - Hierarchical pathfinding (no cache)
  hpa.cached   - Hierarchical pathfinding (with cache)
  legacy       - Legacy A* algorithm
  a.optimized  - Optimized A* algorithm
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const isSynthetic = args.includes("--synthetic");
  const nonFlagArgs = args.filter((arg) => !arg.startsWith("--"));

  if (nonFlagArgs.length < 2) {
    console.error("Error: requires <scenario> and <adapters> arguments");
    printUsage();
    process.exit(1);
  }

  const scenarioArg = nonFlagArgs[0];
  const adaptersArg = nonFlagArgs[1];
  const adapters = adaptersArg.split(",").map((a) => a.trim());

  if (adapters.length < 1) {
    console.error("Error: at least one adapter required");
    process.exit(1);
  }

  const scenarioName = isSynthetic ? `synthetic/${scenarioArg}` : scenarioArg;

  console.log(
    `Comparing ${adapters.length} adapters on scenario: ${scenarioName}`,
  );
  console.log(`Adapters: ${adapters.join(", ")}`);
  console.log("");

  printTableHeader(scenarioName);

  for (const adapter of adapters) {
    try {
      const result = await runBenchmark(scenarioName, adapter);
      printTableRow(result);
    } catch (error) {
      console.log(`${adapter.padEnd(TABLE_WIDTHS[0])} FAILED: ${error}`);
    }
  }

  printTableFooter();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
