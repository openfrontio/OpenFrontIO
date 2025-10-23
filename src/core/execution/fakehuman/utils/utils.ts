import { Cell, Game, Player } from "../../../game/Game";
import { TileRef } from "../../../game/GameMap";
import { PseudoRandom } from "../../../PseudoRandom";
import { calculateBoundingBox } from "../../../Util";

/**
 * Sample a random array of territory tiles
 * @param game Game instance
 * @param player Player whose territory to sample from
 * @param random Random number generator
 * @param numTiles Number of tiles to sample
 * @returns Array of tile references
 */
export function randTerritoryTileArray(
  game: Game,
  player: Player,
  random: PseudoRandom,
  numTiles: number,
): TileRef[] {
  const boundingBox = calculateBoundingBox(game, player.borderTiles());
  const tiles: TileRef[] = [];

  for (let i = 0; i < numTiles; i++) {
    const tile = randTerritoryTile(game, player, random, boundingBox);
    if (tile !== null) {
      tiles.push(tile);
    }
  }

  return tiles;
}

/**
 * Sample a random array of coastal tiles
 * @param game Game instance
 * @param player Player whose territory to sample from
 * @param random Random number generator
 * @param numTiles Number of tiles to sample
 * @returns Array of tile references
 */
export function randCoastalTileArray(
  game: Game,
  player: Player,
  random: PseudoRandom,
  numTiles: number,
): TileRef[] {
  const tiles = Array.from(player.borderTiles()).filter((t) =>
    game.isOceanShore(t),
  );
  return Array.from(arraySampler(tiles, numTiles, random));
}

/**
 * Sample a random territory tile
 * @param game Game instance
 * @param player Player whose territory to sample from
 * @param random Random number generator
 * @param boundingBox Optional bounding box to limit search area
 * @returns Random tile reference or null if none found
 */
export function randTerritoryTile(
  game: Game,
  player: Player,
  random: PseudoRandom,
  boundingBox: { min: Cell; max: Cell } | null = null,
): TileRef | null {
  boundingBox ??= calculateBoundingBox(game, player.borderTiles());

  for (let i = 0; i < 100; i++) {
    const randX = random.nextInt(boundingBox.min.x, boundingBox.max.x);
    const randY = random.nextInt(boundingBox.min.y, boundingBox.max.y);

    if (!game.isOnMap(new Cell(randX, randY))) {
      continue;
    }

    const randTile = game.ref(randX, randY);
    if (game.owner(randTile) === player) {
      return randTile;
    }
  }

  return null;
}

/**
 * Sample elements from an array without replacement
 * @param array Source array
 * @param sampleSize Number of elements to sample
 * @param random Random number generator
 * @returns Generator yielding sampled elements
 */
export function* arraySampler<T>(
  array: T[],
  sampleSize: number,
  random: PseudoRandom,
): Generator<T> {
  if (array.length <= sampleSize) {
    // Return all elements
    yield* array;
  } else {
    // Sample `sampleSize` elements
    const remaining = new Set<T>(array);
    while (sampleSize--) {
      const t = random.randFromSet(remaining);
      remaining.delete(t);
      yield t;
    }
  }
}

/**
 * Find a random boat target within distance
 * @param game Game instance
 * @param player Player making the attack
 * @param random Random number generator
 * @param tile Starting tile
 * @param dist Maximum distance to search
 * @returns Target tile or null if none found
 */
export function randomBoatTarget(
  game: Game,
  player: Player,
  random: PseudoRandom,
  tile: TileRef,
  dist: number,
): TileRef | null {
  const x = game.x(tile);
  const y = game.y(tile);

  for (let i = 0; i < 500; i++) {
    const randX = random.nextInt(x - dist, x + dist);
    const randY = random.nextInt(y - dist, y + dist);

    if (!game.isValidCoord(randX, randY)) {
      continue;
    }

    const randTile = game.ref(randX, randY);
    if (!game.isLand(randTile)) {
      continue;
    }

    const owner = game.owner(randTile);
    if (!owner.isPlayer()) {
      return randTile;
    }

    if (!owner.isFriendly(player)) {
      return randTile;
    }
  }

  return null;
}

/**
 * Calculate the center of a player's territory
 * @param game Game instance
 * @param target Player whose territory to analyze
 * @returns Center tile or null if no territory
 */
export function calculateTerritoryCenter(
  game: Game,
  target: Player,
): TileRef | null {
  const tiles = Array.from(target.tiles());
  if (tiles.length === 0) return null;

  let sumX = 0;
  let sumY = 0;
  for (const tile of tiles) {
    sumX += game.x(tile);
    sumY += game.y(tile);
  }

  const centerX = sumX / tiles.length;
  const centerY = sumY / tiles.length;

  // Find closest tile to center
  let closestTile: TileRef | null = null;
  let closestDistanceSquared = Infinity;

  for (const tile of tiles) {
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
