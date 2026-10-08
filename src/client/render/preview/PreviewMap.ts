/**
 * PreviewMap — the cosmetic preview plays out on the real Australia map
 * (medium / 4x resolution), owned entirely by one preview player, with a few
 * fixed scene locations picked on its terrain.
 *
 * Terrain bytes use the engine's layout: bit 7 land, bit 6 shoreline, bit 5
 * ocean, bits 0-4 magnitude — the same bytes TerrainPass and RailroadPass
 * consume in a match.
 */

import { computeRailTiles } from "../frame/RailroadCache";

/** Dimensions of resources/maps/australia/map4x.bin (checked at load). */
export const PREVIEW_MAP_W = 1000;
export const PREVIEW_MAP_H = 750;

/** Scene anchors on the map (tile coords). */
export const PREVIEW_SCENE = {
  /** Central Australia — skin anchor, nuke target, rail loop. */
  land: { x: 520, y: 380 },
  /** Great Australian Bight — warship / transport patrol. */
  ocean: { x: 400, y: 600 },
  /** Great Australian Bight's north shore: land to the north, sea south — buildings. */
  coast: { x: 400, y: 480 },
} as const;

export interface PreviewMapData {
  mapW: number;
  mapH: number;
  terrainBytes: Uint8Array;
  tileState: Uint16Array;
}

/**
 * Wrap raw map terrain in preview map data: every land tile is owned by the
 * preview player so skins, patterns and rails render over territory.
 */
export function buildPreviewMap(
  terrainBytes: Uint8Array,
  mapW = PREVIEW_MAP_W,
  mapH = PREVIEW_MAP_H,
): PreviewMapData {
  if (terrainBytes.length !== mapW * mapH) {
    throw new Error(
      `Preview map: expected ${mapW}x${mapH} terrain bytes, got ${terrainBytes.length}`,
    );
  }
  const tileState = new Uint16Array(mapW * mapH);
  for (let i = 0; i < tileState.length; i++) {
    if (terrainBytes[i] & 0x80) tileState[i] = 1;
  }
  return { mapW, mapH, terrainBytes, tileState };
}

export function previewTileRef(x: number, y: number): number {
  return y * PREVIEW_MAP_W + x;
}

/** Stations on the preview rail loop (tile coords): city west, factory east. */
export const PREVIEW_RAIL_STATIONS = {
  city: { x: PREVIEW_SCENE.land.x - 30, y: PREVIEW_SCENE.land.y },
  factory: { x: PREVIEW_SCENE.land.x + 30, y: PREVIEW_SCENE.land.y },
} as const;

export interface PreviewRailLoop {
  /** Ordered, closed path of tile refs the train follows. */
  path: number[];
  /** Per-tile rail orientation (0 = none, RailType + 1) for RailroadPass. */
  railroadState: Uint8Array;
}

let railLoop: PreviewRailLoop | undefined;

/**
 * Closed rectangular rail loop through both stations, encoded the way
 * RailroadCache encodes live rails for the GPU. Built once and shared.
 */
export function getPreviewRailLoop(): PreviewRailLoop {
  if (railLoop) return railLoop;
  const w = PREVIEW_MAP_W;
  const left = PREVIEW_RAIL_STATIONS.city.x;
  const right = PREVIEW_RAIL_STATIONS.factory.x;
  const top = PREVIEW_RAIL_STATIONS.city.y - 15;
  const bottom = PREVIEW_RAIL_STATIONS.city.y + 15;
  const path: number[] = [];
  for (let x = left; x < right; x++) path.push(top * w + x); // eastbound
  for (let y = top; y < bottom; y++) path.push(y * w + right); // southbound
  for (let x = right; x > left; x--) path.push(bottom * w + x); // westbound
  for (let y = bottom; y > top; y--) path.push(y * w + left); // northbound
  // Orientation needs a neighbor on both sides; wrap the loop so the corners
  // resolve instead of being treated as line ends.
  const n = path.length;
  const tiles = computeRailTiles([path[n - 1], ...path, path[0]], w).slice(
    1,
    n + 1,
  );
  const railroadState = new Uint8Array(w * PREVIEW_MAP_H);
  for (const rt of tiles) railroadState[rt.ref] = rt.type + 1;
  railLoop = { path, railroadState };
  return railLoop;
}
