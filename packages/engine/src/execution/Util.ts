import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { ReadonlyTileSet } from "@openfront/engine-api/game/ReadViews";
import { euclDistFN } from "@openfront/engine-lib/game/GameMapImpl";
import { Game, Player } from "../game/Game";

export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid: true,
): TileRef[] | null;
export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid?: false,
): TileRef[];
export function getSpawnTiles(
  gm: GameMap,
  tile: TileRef,
  requireAllValid = false,
): TileRef[] | null {
  const spawnTiles = Array.from(gm.bfs(tile, euclDistFN(tile, 4, true)));

  const isInvalid = (t: TileRef) =>
    gm.hasOwner(t) || !gm.isLand(t) || gm.isImpassable(t);

  if (!requireAllValid) {
    return spawnTiles.filter((t) => !isInvalid(t));
  }

  if (spawnTiles.some(isInvalid)) {
    return null;
  }

  return spawnTiles;
}

export function closestTile(
  gm: GameMap,
  refs: Iterable<TileRef>,
  tile: TileRef,
): [TileRef | null, number] {
  let minDistance = Infinity;
  let minRef: TileRef | null = null;
  for (const ref of refs) {
    const distance = gm.manhattanDist(ref, tile);
    if (distance < minDistance) {
      minDistance = distance;
      minRef = ref;
    }
  }
  return [minRef, minDistance];
}

/**
 * Manhattan distance from `tile` to the nearest member of `tiles`, or Infinity
 * when `tiles` is empty. Same value as closestTile()[1] without the sort and
 * copies of closestTwoTiles(); use when only the distance matters.
 */
export function nearestTileDist(
  gm: GameMap,
  tiles: Iterable<TileRef>,
  tile: TileRef,
): number {
  let best = Infinity;
  for (const t of tiles) {
    const d = gm.manhattanDist(t, tile);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Manhattan distance from `tile` to the nearest member of `tiles` when that
 * distance is at most `cap`, otherwise Infinity. Walks Manhattan rings of
 * growing radius around `tile` instead of scanning the whole set, so the
 * cost is O(cap^2) membership checks rather than O(|tiles|) — for "distance
 * to my border, clamped at the spacing constant" that is a few hundred
 * lookups instead of thousands. Exact: a ring is only reached after every
 * closer ring came up empty.
 */
function isTileSetLike(
  tiles: ReadonlyTileSet | Iterable<TileRef>,
): tiles is ReadonlyTileSet {
  return typeof (tiles as ReadonlyTileSet).has === "function";
}

export function nearestTileDistCapped(
  gm: GameMap,
  tiles: ReadonlyTileSet | Iterable<TileRef>,
  tile: TileRef,
  cap: number,
): number {
  if (!isTileSetLike(tiles)) {
    // Plain iterable (tests hand in arrays): fall back to the linear scan.
    const d = nearestTileDist(gm, tiles, tile);
    return d <= cap ? d : Infinity;
  }
  if (tiles.size === 0) return Infinity;
  if (tiles.has(tile)) return 0;
  const w = gm.width();
  const h = gm.height();
  const cx = gm.x(tile);
  const cy = gm.y(tile);
  for (let d = 1; d <= cap; d++) {
    for (let dx = -d; dx <= d; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      const dy = d - Math.abs(dx);
      const y1 = cy - dy;
      if (y1 >= 0 && tiles.has(y1 * w + x)) return d;
      if (dy !== 0) {
        const y2 = cy + dy;
        if (y2 < h && tiles.has(y2 * w + x)) return d;
      }
    }
  }
  return Infinity;
}

export function closestTwoTiles(
  gm: GameMap,
  x: Iterable<TileRef>,
  y: Iterable<TileRef>,
): { x: TileRef; y: TileRef } | null {
  // Coordinates inlined (ref = y * width + x): the sort comparator and the
  // sweep below run over every border tile of both players.
  const w = gm.width();
  const xSorted = Array.from(x).sort((a, b) => (a % w) - (b % w));
  const ySorted = Array.from(y).sort((a, b) => (a % w) - (b % w));

  if (xSorted.length === 0 || ySorted.length === 0) {
    return null;
  }

  let minDistance = Infinity;
  let result = { x: xSorted[0], y: ySorted[0] };

  let lo = 0;
  for (const cx of xSorted) {
    const cxX = cx % w;
    const cxY = (cx / w) | 0;

    while (lo < ySorted.length && cxX - (ySorted[lo] % w) >= minDistance) {
      lo++;
    }

    for (let j = lo; j < ySorted.length; j++) {
      const cy = ySorted[j];
      const cyX = cy % w;
      const dx = cyX - cxX;
      if (dx >= minDistance) {
        break;
      }
      const cyY = (cy / w) | 0;
      const dist = (dx < 0 ? -dx : dx) + Math.abs(cxY - cyY);
      if (dist < minDistance) {
        minDistance = dist;
        result = { x: cx, y: cy };
        if (minDistance === 0) return result;
      }
    }
  }

  return result;
}

/**
 * Calculates the center of a player's territory using geometric approach.
 * Uses the bounding box center and verifies ownership, falling back to nearest border tile if necessary.
 *
 * @param game - The game instance
 * @param target - The player whose territory center to calculate
 * @returns The tile reference for the territory center, or null if no valid center found
 */
export function calculateTerritoryCenter(
  game: Game,
  target: Player,
): TileRef | null {
  const borderTiles = target.borderTiles();
  if (borderTiles.size === 0) return null;

  // Calculate bounding box center in a single pass through border tiles
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;

  for (const tile of borderTiles) {
    const x = game.x(tile);
    const y = game.y(tile);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const centerX = Math.floor((minX + maxX) / 2);
  const centerY = Math.floor((minY + maxY) / 2);

  const centerTile = game.ref(centerX, centerY);

  // Verify ownership of the center tile
  if (game.owner(centerTile) === target) {
    return centerTile;
  }

  // Fall back to nearest border tile if center is not owned
  let closestTile: TileRef | null = null;
  let closestDistanceSquared = Infinity;

  for (const tile of borderTiles) {
    const dx = game.x(tile) - centerX;
    const dy = game.y(tile) - centerY;
    const distSquared = dx * dx + dy * dy;

    if (distSquared < closestDistanceSquared) {
      closestDistanceSquared = distSquared;
      closestTile = tile;
    }
  }

  return closestTile;
}
