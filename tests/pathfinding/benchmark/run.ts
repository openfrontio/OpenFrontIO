#!/usr/bin/env node

/**
 * Benchmark pathfinding adapters on various scenarios
 *
 * Usage:
 *   npx tsx tests/pathfinding/benchmark/run.ts [<scenario> [<adapter>]]
 *   npx tsx tests/pathfinding/benchmark/run.ts --synthetic <map-name> [<adapter>]
 *   npx tsx tests/pathfinding/benchmark/run.ts --synthetic --all [<adapter>]
 *
 * Examples:
 *   npx tsx tests/pathfinding/benchmark/run.ts
 *   npx tsx tests/pathfinding/benchmark/run.ts default legacy
 *   npx tsx tests/pathfinding/benchmark/run.ts --synthetic --all
 *   npx tsx tests/pathfinding/benchmark/run.ts --synthetic iceland legacy
 */

import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  type BenchmarkResult,
  calculateStats,
  getAdapter,
  getScenario,
  measureExecutionTime,
  measurePathLength,
  printHeader,
  printRow,
} from "../utils";

const currentFile = fileURLToPath(import.meta.url);
const pathfindingDir = dirname(currentFile);
const syntheticScenariosDir = join(pathfindingDir, "scenarios", "synthetic");

interface RunOptions {
  silent?: boolean;
  iterations?: number;
}

const DEFAULT_ADAPTER = "default";
const DEFAULT_SCENARIO = "default";
const DEFAULT_ITERATIONS = 10;

async function runScenario(
  adapterName: string,
  scenarioName: string,
  options: RunOptions = {},
) {
  const { game, routes, initTime } = await getScenario(
    scenarioName,
    adapterName,
  );
  const adapter = getAdapter(game, adapterName);
  const { silent = false } = options;

  if (!silent) {
    console.log(`Date: ${new Date().toISOString()}`);
    console.log(`Benchmarking: ${adapterName}`);
    console.log(`Scenario: ${scenarioName}`);
    console.log(`Routes: ${routes.length}`);
    console.log(``);
  }

  // =============================================================================

  if (!silent) {
    printHeader("METRIC 1: INITIALIZATION TIME");
  }

  const initializationTime = initTime;

  if (!silent) {
    console.log(`Initialization time: ${initializationTime.toFixed(2)}ms`);
    console.log(``);
  }

  // =============================================================================

  if (!silent) {
    printHeader("METRIC 2: PATH DISTANCE");
    printRow(["Route", "Path Length"], [40, 12]);
  }

  const results: BenchmarkResult[] = [];

  for (const route of routes) {
    const pathLength = measurePathLength(adapter, route);
    results.push({ route: route.name, pathLength, executionTime: null });
    if (!silent) {
      printRow(
        [route.name, pathLength !== null ? `${pathLength} tiles` : "FAILED"],
        [40, 12],
      );
    }
  }

  const { totalDistance, successfulRoutes, totalRoutes } =
    calculateStats(results);

  if (!silent) {
    console.log(``);
    console.log(`Total distance: ${totalDistance} tiles`);
    console.log(`Routes completed: ${successfulRoutes} / ${totalRoutes}`);
    console.log(``);
  }

  // =============================================================================

  if (!silent) {
    printHeader("METRIC 3: PATHFINDING TIME");
    printRow(["Route", "Time"], [40, 12]);
  }

  for (const route of routes) {
    const result = results.find((r) => r.route === route.name);

    if (result && result.pathLength !== null) {
      const execTime = measureExecutionTime(
        adapter,
        route,
        options.iterations ?? DEFAULT_ITERATIONS,
      );
      result.executionTime = execTime;

      if (!silent) {
        printRow([route.name, `${execTime!.toFixed(2)}ms`], [40, 12]);
      }
    } else {
      if (!silent) {
        printRow([route.name, "FAILED"], [40, 12]);
      }
    }
  }

  const stats = calculateStats(results);

  if (!silent) {
    console.log(``);
    console.log(`Total time: ${stats.totalTime.toFixed(2)}ms`);
    console.log(`Average time: ${stats.avgTime.toFixed(2)}ms`);
    console.log(
      `Routes benchmarked: ${stats.timedRoutes} / ${stats.totalRoutes}`,
    );
    console.log(``);

    // =============================================================================

    printHeader("SUMMARY");

    console.log(`Adapter: ${adapterName}`);
    console.log(`Scenario: ${scenarioName}`);
    console.log(``);

    if (stats.successfulRoutes < stats.totalRoutes) {
      console.log(
        `Warning: Only ${stats.successfulRoutes} out of ${stats.totalRoutes} routes were completed successfully!`,
      );
      console.log(``);
    }

    console.log("Scores:");
    console.log(`  Initialization: ${initializationTime.toFixed(2)}ms`);
    console.log(`  Pathfinding: ${stats.totalTime.toFixed(2)}ms`);
    console.log(`  Distance: ${totalDistance} tiles`);
    console.log(``);
  } else {
    // Silent mode - just print a summary line
    const status = stats.successfulRoutes < stats.totalRoutes ? "⚠️ " : "✅";
    console.log(
      `${status} ${scenarioName.padEnd(35)} | Init: ${initializationTime.toFixed(2).padStart(8)}ms | Path: ${stats.totalTime.toFixed(2).padStart(9)}ms | Dist: ${totalDistance.toString().padStart(7)} tiles | Routes: ${stats.successfulRoutes}/${stats.totalRoutes}`,
    );
  }

  return {
    initializationTime,
    totalTime: stats.totalTime,
    totalDistance: totalDistance,
  };
}

function printUsage() {
  console.log(`
Usage:
  npx tsx tests/pathfinding/benchmark/run.ts [<scenario> [<adapter>]]
  npx tsx tests/pathfinding/benchmark/run.ts --synthetic <map-name> [<adapter>]
  npx tsx tests/pathfinding/benchmark/run.ts --synthetic --all [<adapter>]

Arguments:
  <scenario>    Name of the scenario to benchmark (default: "default" -> giantworldmap with handpicked ports)
  <adapter>     Name of the pathfinding adapter to use (default: "default" -> HPA*)
  --silent      Minimize output, only print summary lines
  --synthetic   Run synthetic scenarios
  --all         Run all synthetic scenarios (requires --synthetic)

Examples:
  npx tsx tests/pathfinding/benchmark/run.ts
  npx tsx tests/pathfinding/benchmark/run.ts default legacy
  npx tsx tests/pathfinding/benchmark/run.ts --synthetic --all
  npx tsx tests/pathfinding/benchmark/run.ts --synthetic iceland legacy

Available synthetic scenarios:
  Run 'ls tests/pathfinding/benchmark/scenarios/synthetic' to see all available scenarios
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const isSynthetic = args.includes("--synthetic");
  const isAll = args.includes("--all");
  const isSilent = args.includes("--silent");
  const nonFlagArgs = args.filter((arg) => !arg.startsWith("--"));

  if (isSynthetic) {
    if (isAll) {
      // Run all synthetic scenarios
      const adapterName = nonFlagArgs[0] || DEFAULT_ADAPTER;

      // Find all synthetic scenario files
      const scenarioFiles = readdirSync(syntheticScenariosDir)
        .filter((file) => file.endsWith(".ts"))
        .map((file) => file.replace(".ts", ""))
        .sort();

      console.log(
        `Running ${scenarioFiles.length} synthetic scenarios with ${adapterName} adapter...`,
      );
      console.log(``);

      const results: {
        initializationTime: number;
        totalTime: number;
        totalDistance: number;
      }[] = [];

      for (let i = 0; i < scenarioFiles.length; i++) {
        const mapName = scenarioFiles[i];
        const scenarioName = `synthetic/${mapName}`;
        const result = await runScenario(adapterName, scenarioName, {
          silent: true,
          iterations: 1,
        });
        results.push(result);
      }

      console.log(``);
      console.log(`Completed ${scenarioFiles.length} scenarios`);
      console.log(
        `Total Initialization Time: ${results.reduce((sum, r) => sum + r.initializationTime, 0).toFixed(2)}ms`,
      );
      console.log(
        `Total Pathfinding Time: ${results.reduce((sum, r) => sum + r.totalTime, 0).toFixed(2)}ms`,
      );
      console.log(
        `Total Distance: ${results.reduce((sum, r) => sum + r.totalDistance, 0)} tiles`,
      );
    } else if (nonFlagArgs.length >= 1) {
      // Run single synthetic scenario
      const mapName = nonFlagArgs[0];
      const adapterName = nonFlagArgs[1] || DEFAULT_ADAPTER;
      const scenarioName = `synthetic/${mapName}`;

      await runScenario(adapterName, scenarioName, { silent: isSilent });
    } else {
      console.error("Error: --synthetic requires a map name or --all flag");
      printUsage();
      process.exit(1);
    }
  } else {
    // Standard mode with positional arguments
    const scenarioName = nonFlagArgs[0] || DEFAULT_SCENARIO;
    const adapterName = nonFlagArgs[1] || DEFAULT_ADAPTER;

    await runScenario(adapterName, scenarioName, { silent: isSilent });
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
