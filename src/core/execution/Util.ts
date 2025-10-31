import { Game, Player } from "../game/Game";
import { euclDistFN, GameMap, TileRef } from "../game/GameMap";

export function getSpawnTiles(gm: GameMap, tile: TileRef): TileRef[] {
  return Array.from(gm.bfs(tile, euclDistFN(tile, 4, true))).filter(
    (t) => !gm.hasOwner(t) && gm.isLand(t),
  );
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

export function closestTwoTiles(
  gm: GameMap,
  x: Iterable<TileRef>,
  y: Iterable<TileRef>,
): { x: TileRef; y: TileRef } | null {
  const xSorted = Array.from(x).sort((a, b) => gm.x(a) - gm.x(b));
  const ySorted = Array.from(y).sort((a, b) => gm.x(a) - gm.x(b));

  if (xSorted.length === 0 || ySorted.length === 0) {
    return null;
  }

  let i = 0;
  let j = 0;
  let minDistance = Infinity;
  let result = { x: xSorted[0], y: ySorted[0] };

  while (i < xSorted.length && j < ySorted.length) {
    const currentX = xSorted[i];
    const currentY = ySorted[j];

    const distance =
      Math.abs(gm.x(currentX) - gm.x(currentY)) +
      Math.abs(gm.y(currentX) - gm.y(currentY));

    if (distance < minDistance) {
      minDistance = distance;
      result = { x: currentX, y: currentY };
    }

    // If we're at the end of X, must move Y forward
    if (i === xSorted.length - 1) {
      j++;
    }
    // If we're at the end of Y, must move X forward
    else if (j === ySorted.length - 1) {
      i++;
    }
    // Otherwise, move whichever pointer has smaller x value
    else if (gm.x(currentX) < gm.x(currentY)) {
      i++;
    } else {
      j++;
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
