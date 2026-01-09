import { readdirSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Game } from "../../../../src/core/game/Game.js";
import { TileRef } from "../../../../src/core/game/GameMap.js";
import { NavMesh } from "../../../../src/core/pathfinding/navmesh/NavMesh.js";
import { setupFromPath } from "../../utils.js";

export interface MapInfo {
  name: string;
  displayName: string;
}

export interface MapCache {
  game: Game;
  navMesh: NavMesh;
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
  const game = await setupFromPath(mapsDir, mapName);

  // Initialize NavMesh
  const navMesh = new NavMesh(game, { cachePaths: config.cachePaths });
  navMesh.initialize();

  const cacheEntry: MapCache = { game, navMesh };

  // Store in cache
  cache.set(mapName, cacheEntry);

  return cacheEntry;
}

/**
 * Get map metadata for client
 */
export async function getMapMetadata(mapName: string) {
  const { game, navMesh } = await loadMap(mapName);

  // Extract map data
  const mapData: number[] = [];
  for (let y = 0; y < game.height(); y++) {
    for (let x = 0; x < game.width(); x++) {
      const tile = game.ref(x, y);
      mapData.push(game.isWater(tile) ? 1 : 0);
    }
  }

  // Extract static graph data from NavMesh
  const miniMap = game.miniMap();
  const navMeshGraph = (navMesh as any).graph;

  // Convert gateways from Map to array
  const gatewaysArray = Array.from(navMeshGraph.gateways.values());
  const allGateways = gatewaysArray.map((gw: any) => ({
    id: gw.id,
    x: miniMap.x(gw.tile),
    y: miniMap.y(gw.tile),
  }));

  // Create a lookup map from gateway ID to gateway for edge conversion
  const gatewayById = new Map(gatewaysArray.map((gw: any) => [gw.id, gw]));

  // Convert edges from Map<gatewayId, Edge[]> to flat array
  // The edges Map has gateway IDs as keys, and arrays of edges as values
  const allEdges: any[] = [];
  for (const edgeArray of navMeshGraph.edges.values()) {
    allEdges.push(...edgeArray);
  }

  // Deduplicate edges (they're bidirectional, so each edge appears twice)
  const seenEdges = new Set<string>();
  const edges = allEdges
    .filter((edge: any) => {
      const edgeKey =
        edge.from < edge.to
          ? `${edge.from}-${edge.to}`
          : `${edge.to}-${edge.from}`;
      if (seenEdges.has(edgeKey)) return false;
      seenEdges.add(edgeKey);
      return true;
    })
    .map((edge: any) => {
      const fromGateway = gatewayById.get(edge.from);
      const toGateway = gatewayById.get(edge.to);

      return {
        fromId: edge.from,
        toId: edge.to,
        from: fromGateway
          ? [miniMap.x(fromGateway.tile) * 2, miniMap.y(fromGateway.tile) * 2]
          : [0, 0],
        to: toGateway
          ? [miniMap.x(toGateway.tile) * 2, miniMap.y(toGateway.tile) * 2]
          : [0, 0],
        cost: edge.cost,
        path: edge.path
          ? edge.path.map((tile: TileRef) => [game.x(tile), game.y(tile)])
          : null,
      };
    });

  console.log(
    `Map ${mapName}: ${allGateways.length} gateways, ${edges.length} edges`,
  );

  const sectorSize = navMeshGraph.sectorSize;

  return {
    name: mapName,
    width: game.width(),
    height: game.height(),
    mapData,
    graphDebug: {
      allGateways,
      edges,
      sectorSize,
    },
  };
}

/**
 * Clear map cache
 */
export function clearCache() {
  cache.clear();
}
