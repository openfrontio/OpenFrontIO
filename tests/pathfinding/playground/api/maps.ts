import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Game } from "../../../../src/core/game/Game.js";
import { AStarWaterHierarchical } from "../../../../src/core/pathfinding/algorithms/AStar.WaterHierarchical.js";
import { setupFromPath } from "../../utils.js";

// Available comparison adapters
// Note: "hpa" runs same algorithm without debug overhead for fair timing comparison
export const COMPARISON_ADAPTERS = ["hpa", "a.baseline", "a.generic", "a.full"];

export interface MapInfo {
  name: string;
  displayName: string;
}

export interface MapCache {
  game: Game;
  hpaStar: AStarWaterHierarchical;
}

const cache = new Map<string, MapCache>();

/**
 * Global configuration for map loading
 */
let config = {
  cachePaths: true,
};

/**
 * Set configuration options
 */
export function setConfig(options: { cachePaths?: boolean }) {
  config = { ...config, ...options };
}

/**
 * Get the resources/maps directory path
 */
function getMapsDirectory(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../resources/maps",
  );
}

/**
 * Format map name to title case with proper spacing
 * Handles: underscores, camelCase, existing spaces, and parentheses
 */
function formatMapName(name: string): string {
  return (
    name
      // Replace underscores with spaces
      .replace(/_/g, " ")
      // Add space before capital letters (for camelCase)
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Convert to lowercase first
      .toLowerCase()
      // Capitalize first letter of string
      .replace(/^\w/, (char) => char.toUpperCase())
      // Capitalize after spaces and opening parentheses
      .replace(/(\s+|[(])\w/g, (match) => match.toUpperCase())
  );
}

/**
 * Get list of available maps by reading the resources/maps directory
 */
export function listMaps(): MapInfo[] {
  const mapsDir = getMapsDirectory();
  const maps: MapInfo[] = [];

  try {
    const entries = readdirSync(mapsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const name = entry.name;
        let displayName = formatMapName(name);

        // Try to read displayName from manifest.json
        try {
          const manifestPath = join(mapsDir, name, "manifest.json");
          const manifestData = JSON.parse(readFileSync(manifestPath, "utf-8"));
          if (manifestData.name) {
            displayName = formatMapName(manifestData.name);
          }
        } catch (e) {
          // If manifest doesn't exist or doesn't have name, use formatted folder name
          console.warn(
            `Could not read manifest for ${name}:`,
            e instanceof Error ? e.message : e,
          );
        }

        maps.push({ name, displayName });
      }
    }
  } catch (e) {
    console.error("Failed to read maps directory:", e);
  }

  return maps.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Load a map from cache or disk
 */
export async function loadMap(mapName: string): Promise<MapCache> {
  // Check cache first
  if (cache.has(mapName)) {
    return cache.get(mapName)!;
  }

  const mapsDir = getMapsDirectory();

  // Use the existing setupFromPath utility to load the map
  const game = await setupFromPath(mapsDir, mapName, { disableNavMesh: false });

  // Get pre-built graph from game
  const graph = game.miniWaterGraph();
  if (!graph) {
    throw new Error(`No water graph available for map: ${mapName}`);
  }

  // Initialize AStarWaterHierarchical with minimap and graph
  const hpaStar = new AStarWaterHierarchical(game.miniMap(), graph, {
    cachePaths: config.cachePaths,
  });

  const cacheEntry: MapCache = { game, hpaStar };

  // Store in cache
  cache.set(mapName, cacheEntry);

  return cacheEntry;
}

/**
 * Get map metadata for client
 */
export async function getMapMetadata(mapName: string) {
  const { game, hpaStar } = await loadMap(mapName);

  // Extract map data
  const mapData: number[] = [];
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      mapData.push(game.isWater(tile) ? 1 : 0);
    }
  }

  // Extract static graph data from GameMapHPAStar
  // Access internal graph via type casting (test code only)
  const graph = (hpaStar as any).graph;
  const miniMap = game.miniMap();

  // Convert nodes to client format
  const allNodes = graph.getAllNodes().map((node: any) => ({
    id: node.id,
    x: miniMap.x(node.tile),
    y: miniMap.y(node.tile),
  }));

  // Convert edges to client format
  const edges: Array<{
    fromId: number;
    toId: number;
    from: number[];
    to: number[];
    cost: number;
  }> = [];
  for (let i = 0; i < graph.edgeCount; i++) {
    const edge = graph.getEdge(i);
    if (!edge) continue;

    const nodeA = graph.getNode(edge.nodeA);
    const nodeB = graph.getNode(edge.nodeB);
    if (!nodeA || !nodeB) continue;

    edges.push({
      fromId: edge.nodeA,
      toId: edge.nodeB,
      from: [miniMap.x(nodeA.tile) * 2, miniMap.y(nodeA.tile) * 2],
      to: [miniMap.x(nodeB.tile) * 2, miniMap.y(nodeB.tile) * 2],
      cost: edge.cost,
    });
  }

  console.log(
    `Map ${mapName}: ${allNodes.length} nodes, ${edges.length} edges`,
  );

  const clusterSize = graph.clusterSize;

  return {
    name: mapName,
    width: game.width(),
    height: game.height(),
    mapData,
    graphDebug: {
      allNodes,
      edges,
      clusterSize,
    },
    adapters: COMPARISON_ADAPTERS,
  };
}

/**
 * Clear map cache
 */
export function clearCache() {
  cache.clear();
}
