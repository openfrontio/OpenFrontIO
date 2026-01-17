import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Game } from "../../../../src/core/game/Game.js";
import { DebugSpan } from "../../../../src/core/utilities/DebugSpan.js";
import { setupFromPath } from "../../utils.js";

// Available comparison adapters
// Note: "hpa.cached" runs same algorithm without debug overhead for fair timing comparison
export const COMPARISON_ADAPTERS = [
  "hpa.cached",
  "hpa",
  "a.baseline",
  "a.generic",
  "a.full",
];

export interface MapInfo {
  name: string;
  displayName: string;
}

export interface GraphBuildData {
  nodes: any[];
  edges: any[];
  nodesCount: number;
  edgesCount: number;
  clustersCount: number;
  buildTime: number;
}

export interface MapCache {
  game: Game;
  graphBuildData: GraphBuildData | null;
}

const cache = new Map<string, MapCache>();

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
 * Extract graph build data from DebugSpan
 */
function extractGraphBuildData(): GraphBuildData | null {
  const span = DebugSpan.getLastSpan();
  if (!span || span.name !== "AbstractGraphBuilder:build") {
    return null;
  }

  return {
    nodes: (span.data.nodes as any[]) || [],
    edges: (span.data.edges as any[]) || [],
    nodesCount: (span.data.nodesCount as number) || 0,
    edgesCount: (span.data.edgesCount as number) || 0,
    clustersCount: (span.data.clustersCount as number) || 0,
    buildTime: span.duration || 0,
  };
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

  // Enable DebugSpan to capture graph build data
  DebugSpan.enable();

  // Use the existing setupFromPath utility to load the map
  const game = await setupFromPath(mapsDir, mapName, { disableNavMesh: false });

  // Capture graph build data from DebugSpan
  const graphBuildData = extractGraphBuildData();
  DebugSpan.disable();

  const cacheEntry: MapCache = { game, graphBuildData };

  // Store in cache
  cache.set(mapName, cacheEntry);

  return cacheEntry;
}

/**
 * Get map metadata for client
 */
export async function getMapMetadata(mapName: string) {
  const { game, graphBuildData } = await loadMap(mapName);

  // Extract map data
  const mapData: number[] = [];
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      mapData.push(game.isWater(tile) ? 1 : 0);
    }
  }

  const graph = game.miniWaterGraph();
  const miniMap = game.miniMap();
  const clusterSize = graph?.clusterSize ?? 0;

  // Use graphBuildData from DebugSpan if available, otherwise fall back to direct access
  let allNodes: Array<{ id: number; x: number; y: number }>;
  let edges: Array<{
    fromId: number;
    toId: number;
    from: number[];
    to: number[];
    cost: number;
  }>;

  if (graphBuildData) {
    // Convert nodes from DebugSpan data (AbstractNode format)
    allNodes = graphBuildData.nodes.map((node: any) => ({
      id: node.id,
      x: miniMap.x(node.tile),
      y: miniMap.y(node.tile),
    }));

    // Convert edges from DebugSpan data (AbstractEdge format)
    edges = graphBuildData.edges.map((edge: any) => {
      const nodeA = graphBuildData.nodes.find((n: any) => n.id === edge.nodeA);
      const nodeB = graphBuildData.nodes.find((n: any) => n.id === edge.nodeB);
      return {
        fromId: edge.nodeA,
        toId: edge.nodeB,
        from: nodeA
          ? [miniMap.x(nodeA.tile) * 2, miniMap.y(nodeA.tile) * 2]
          : [0, 0],
        to: nodeB
          ? [miniMap.x(nodeB.tile) * 2, miniMap.y(nodeB.tile) * 2]
          : [0, 0],
        cost: edge.cost,
      };
    });

    console.log(
      `Map ${mapName}: ${allNodes.length} nodes, ${edges.length} edges (from DebugSpan, built in ${graphBuildData.buildTime.toFixed(2)}ms)`,
    );
  } else if (graph) {
    // Fallback: extract directly from graph
    allNodes = graph.getAllNodes().map((node: any) => ({
      id: node.id,
      x: miniMap.x(node.tile),
      y: miniMap.y(node.tile),
    }));

    edges = [];
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
      `Map ${mapName}: ${allNodes.length} nodes, ${edges.length} edges (fallback)`,
    );
  } else {
    // No graph available
    allNodes = [];
    edges = [];
    console.log(`Map ${mapName}: no graph available`);
  }

  return {
    name: mapName,
    width: game.width(),
    height: game.height(),
    mapData,
    graphDebug: {
      allNodes,
      edges,
      clusterSize,
      buildTime: graphBuildData?.buildTime,
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
