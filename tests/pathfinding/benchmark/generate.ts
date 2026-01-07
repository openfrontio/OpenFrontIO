#!/usr/bin/env node

/**
 * Generate synthetic benchmark scenarios for pathfinding tests
 *
 * Usage:
 *   npx tsx tests/pathfinding/benchmark/generate.ts <map-name> [--force]
 *   npx tsx tests/pathfinding/benchmark/generate.ts --all [--force]
 *
 * Examples:
 *   npx tsx tests/pathfinding/benchmark/generate.ts iceland
 *   npx tsx tests/pathfinding/benchmark/generate.ts giantworldmap --force
 *   npx tsx tests/pathfinding/benchmark/generate.ts --all
 */

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { setupFromPath } from "../utils";

const currentFile = fileURLToPath(import.meta.url);
const pathfindingDir = dirname(currentFile);
const projectRoot = join(pathfindingDir, "../../..");
const mapsDirectory = join(projectRoot, "resources/maps");
const scenariosDir = join(pathfindingDir, "scenarios", "synthetic");

const NUM_PORTS = 200;
const NUM_ROUTES = 1000;
const ROUTES_PER_PORT = 5;

interface GenerationOptions {
  force: boolean;
  silent: boolean;
}

async function generateScenarioForMap(
  mapName: string,
  options: GenerationOptions
): Promise<'created' | 'skipped' | 'error'> {
  const outputPath = join(scenariosDir, `${mapName}.ts`);

  // Check if file exists and --force not provided
  if (existsSync(outputPath) && !options.force) {
    if (!options.silent) {
      console.log(`⚠️  ${mapName}: File already exists (use --force to overwrite)`);
    }

    return 'skipped';
  }

  try {
    const game = await setupFromPath(mapsDirectory, mapName);
    const map = game.map();

    // Find all water shoreline tiles
    const shorelinePorts: Array<[number, number]> = [];

    map.forEachTile((tile) => {
      if (map.isOcean(tile) && map.isShoreline(tile)) {
        shorelinePorts.push([map.x(tile), map.y(tile)]);
      }
    });

    if (shorelinePorts.length < 10) {
      console.log(`❌ ${mapName}: Not enough water shoreline tiles (minimum 10 required)`);
      return 'error';
    }

    // Select random ports
    const numPortsToSelect = Math.min(NUM_PORTS, shorelinePorts.length);
    const selectedPorts: Array<[number, number]> = [];
    const shuffled = shorelinePorts.sort(() => Math.random() - 0.5);
    for (let i = 0; i < numPortsToSelect; i++) {
      selectedPorts.push(shuffled[i]);
    }

    // Build ports array
    const ports: Port[] = selectedPorts.map((coord, index) => ({
      name: `Port${String(index + 1).padStart(3, "0")}`,
      coords: coord,
    }));

    // Build routes array
    const routes: Route[] = [];

    // Generate routes: each port connects to next N ports
    for (let i = 0; i < selectedPorts.length; i++) {
      for (let j = 1; j <= ROUTES_PER_PORT && i + j < selectedPorts.length; j++) {
        routes.push({
          from: `Port${String(i + 1).padStart(3, "0")}`,
          to: `Port${String(i + j + 1).padStart(3, "0")}`,
        });
      }
    }

    // Add extra routes to reach target (or as many as possible)
    const targetRoutes = Math.min(NUM_ROUTES, routes.length + 200);
    const additionalRoutesNeeded = targetRoutes - routes.length;
    if (additionalRoutesNeeded > 0) {
      let added = 0;
      for (let i = 0; i < selectedPorts.length && added < additionalRoutesNeeded; i++) {
        for (let j = ROUTES_PER_PORT + 1; j <= ROUTES_PER_PORT + 3 && i + j < selectedPorts.length && added < additionalRoutesNeeded; j++) {
          routes.push({
            from: `Port${String(i + 1).padStart(3, "0")}`,
            to: `Port${String(i + j + 1).padStart(3, "0")}`,
          });
          added++;
        }
      }
    }

    // Generate content from template
    const content = generateScenarioContent({
      mapName,
      ports,
      routes,
    });

    const routeCount = routes.length;

    // Ensure directory exists
    mkdirSync(scenariosDir, { recursive: true });

    // Write to file
    writeFileSync(outputPath, content);

    console.log(`✅ ${mapName} generated with ${numPortsToSelect} ports and ${routeCount} routes`);

    return 'created';
  } catch (error) {
    console.error(`❌ ${mapName}:`, error);
    return 'error';
  }
}

function printUsage() {
  console.log(`
Usage:
  npx tsx tests/pathfinding/benchmark/generate.ts <map-name> [--force]
  npx tsx tests/pathfinding/benchmark/generate.ts --all [--force]

Arguments:
  <map-name>    Name of the map to generate scenario for (e.g., iceland, giantworldmap)
  --all         Generate scenarios for all available maps
  --force       Overwrite existing scenario files

Examples:
  npx tsx tests/pathfinding/benchmark/generate.ts iceland
  npx tsx tests/pathfinding/benchmark/generate.ts giantworldmap --force
  npx tsx tests/pathfinding/benchmark/generate.ts --all

Available maps:
  Run 'ls resources/maps' to see all available maps
`);
}

// Parse command-line arguments
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const options: GenerationOptions = {
    force: args.includes("--force"),
    silent: args.includes("--all"),
  };

  const nonFlagArgs = args.filter((arg) => !arg.startsWith("--"));

  if (args.includes("--all")) {
    // Generate for all maps
    const maps = readdirSync(mapsDirectory, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .sort();

    console.log(`Generating synthetic scenarios for ${maps.length} maps...`);
    console.log(`Config: ${NUM_PORTS} ports, ${NUM_ROUTES} routes`);
    console.log(`Force overwrite: ${options.force}`);
    console.log(``);

    let createdCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const mapName of maps) {
      const result = await generateScenarioForMap(mapName, options);

      if (result === 'created') {
        createdCount++;
      } else if (result === 'skipped') {
        skippedCount++;
      } else if (result === 'error') {
        errorCount++;
      }
    }

    if (createdCount + errorCount > 0) {
      console.log(``);
    }
    
    console.log(`Created: ${createdCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);
  } else if (nonFlagArgs.length === 1) {
    // Generate for single map
    const mapName = nonFlagArgs[0];
    const mapPath = join(mapsDirectory, mapName);

    if (!existsSync(mapPath)) {
      console.error(`Map not found: ${mapName}`);
      process.exit(1);
    }

    console.log(`Generating synthetic scenario for ${mapName}...`);
    console.log(`Config: ${NUM_PORTS} ports, ${NUM_ROUTES} routes`);
    console.log(`Force overwrite: ${options.force}`);
    console.log(``);

    const result = await generateScenarioForMap(mapName, options);

    if (result === 'created') {
      console.log(``);
      console.log(`Scenario generated successfully!`);
      console.log(`You can now run: npx tsx tests/pathfinding/benchmark/run.ts --synthetic ${mapName}`);
    } else {
      process.exit(1);
    }
  } else {
    console.error(`Invalid arguments.`);
    printUsage();
    process.exit(1);
  }
}

// Run main function
main().catch((error) => {
  console.error(`Fatal error:`, error);
  process.exit(1);
});

/**
 * Template for generating synthetic benchmark scenarios
 */

interface Port {
  name: string;
  coords: [number, number];
}

interface Route {
  from: string;
  to: string;
}

interface TemplateParams {
  mapName: string;
  ports: Port[];
  routes: Route[];
}

function generateScenarioContent(params: TemplateParams): string {
  const { mapName, ports, routes } = params;

  let content = ``;

  // Simplified format - just data, no setup function
  content += `export const MAP_NAME = "${mapName}";\n\n`;

  // Generate PORTS object
  content += `export const PORTS: { [k: string]: [number, number] } = {\n`;
  ports.forEach((port) => {
    content += `  "${port.name}": [${port.coords[0]}, ${port.coords[1]}],\n`;
  });
  content += `};\n\n`;

  // Generate ROUTES array
  content += `export const ROUTES: Array<[keyof typeof PORTS, keyof typeof PORTS]> = [\n`;
  routes.forEach((route) => {
    content += `  ["${route.from}", "${route.to}"],\n`;
  });
  content += `];\n`;

  return content;
}
