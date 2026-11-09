import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { Cell } from "@openfront/engine-api/game/GameTypes";
import { UnitLike } from "@openfront/engine-api/game/ReadViews";
import { exp } from "./DetMath";
import { TileSet } from "./game/TileSet";

export function manhattanDistWrapped(
  c1: Cell,
  c2: Cell,
  width: number,
): number {
  // Calculate x distance
  let dx = Math.abs(c1.x - c2.x);
  // Check if wrapping around the x-axis is shorter
  dx = Math.min(dx, width - dx);

  // Calculate y distance (no wrapping for y-axis)
  const dy = Math.abs(c1.y - c2.y);

  // Return the sum of x and y distances
  return dx + dy;
}

export function within(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function distSort(
  gm: GameMap,
  target: TileRef,
): (a: TileRef, b: TileRef) => number {
  return (a: TileRef, b: TileRef) => {
    return gm.manhattanDist(a, target) - gm.manhattanDist(b, target);
  };
}

export function distSortUnit(
  gm: GameMap,
  target: UnitLike | TileRef,
): (a: UnitLike, b: UnitLike) => number {
  const targetRef = typeof target === "number" ? target : target.tile();

  return (a: UnitLike, b: UnitLike) => {
    return (
      gm.manhattanDist(a.tile(), targetRef) -
      gm.manhattanDist(b.tile(), targetRef)
    );
  };
}

/**
 * Finds minimum, by score, with single pass search
 * Faster than array.reduce()
 */
export function findMinimumBy<T>(
  values: readonly T[],
  score: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestScore = Infinity;

  if (isCandidate === undefined) {
    for (let i = 0, len = values.length; i < len; i++) {
      const value = values[i];
      const currentScore = score(value);
      if (currentScore < bestScore) {
        bestScore = currentScore;
        best = value;
      }
    }
    return best;
  }

  for (let i = 0, len = values.length; i < len; i++) {
    const value = values[i];
    if (!isCandidate(value)) continue;

    const currentScore = score(value);
    if (currentScore < bestScore) {
      bestScore = currentScore;
      best = value;
    }
  }

  return best;
}

/**
 * Finds closest by fast. Example usage:
 * findClosestBy(
 *       this.units(UnitType.MissileSilo),
 *       (silo) => mg.manhattanDist(silo.tile(), tile),
 *       (silo) => !silo.isInCooldown() && !silo.isUnderConstruction(),
 *     )
 */
export function findClosestBy<T>(
  values: readonly T[],
  distance: (value: T) => number,
  isCandidate?: (value: T) => boolean,
): T | null {
  return findMinimumBy(values, distance, isCandidate);
}

export function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function calculateBoundingBox(
  gm: GameMap,
  borderTiles: Iterable<TileRef>,
): { min: Cell; max: Cell } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  const visit = (tile: TileRef) => {
    const x = gm.x(tile);
    const y = gm.y(tile);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  // Indexed/forEach paths: for..of over a large Set (player border sets)
  // allocates an iterator-result object per element.
  if (Array.isArray(borderTiles)) {
    for (let i = 0; i < borderTiles.length; i++) {
      visit(borderTiles[i]);
    }
  } else if (borderTiles instanceof Set || borderTiles instanceof TileSet) {
    borderTiles.forEach(visit);
  } else {
    for (const tile of borderTiles) {
      visit(tile);
    }
  }

  return { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
}

export function boundingBoxTiles(
  gm: GameMap,
  center: TileRef,
  radius: number,
): TileRef[] {
  const tiles: TileRef[] = [];

  const centerX = gm.x(center);
  const centerY = gm.y(center);

  const minX = centerX - radius;
  const maxX = centerX + radius;
  const minY = centerY - radius;
  const maxY = centerY + radius;

  // Top and bottom edges (full width)
  for (let x = minX; x <= maxX; x++) {
    if (gm.isValidCoord(x, minY)) {
      tiles.push(gm.ref(x, minY));
    }
    if (gm.isValidCoord(x, maxY) && minY !== maxY) {
      tiles.push(gm.ref(x, maxY));
    }
  }

  // Left and right edges (exclude corners already added)
  for (let y = minY + 1; y < maxY; y++) {
    if (gm.isValidCoord(minX, y)) {
      tiles.push(gm.ref(minX, y));
    }
    if (gm.isValidCoord(maxX, y) && minX !== maxX) {
      tiles.push(gm.ref(maxX, y));
    }
  }

  return tiles;
}

export function getMode<T>(counts: Map<T, number>): T | null {
  let mode: T | null = null;
  let maxCount = 0;

  for (const [item, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      mode = item;
    }
  }

  return mode;
}

export function calculateBoundingBoxCenter(
  gm: GameMap,
  borderTiles: Iterable<TileRef>,
): Cell {
  const { min, max } = calculateBoundingBox(gm, borderTiles);
  return boundingBoxCenter({ min, max });
}

export function boundingBoxCenter(box: { min: Cell; max: Cell }): Cell {
  return new Cell(
    box.min.x + Math.floor((box.max.x - box.min.x) / 2),
    box.min.y + Math.floor((box.max.y - box.min.y) / 2),
  );
}

export function inscribed(
  outer: { min: Cell; max: Cell },
  inner: { min: Cell; max: Cell },
): boolean {
  return (
    outer.min.x <= inner.min.x &&
    outer.min.y <= inner.min.y &&
    outer.max.x >= inner.max.x &&
    outer.max.y >= inner.max.y
  );
}

export function assertNever(x: never): never {
  throw new Error("Unexpected value: " + x);
}

export function toInt(num: number): bigint {
  if (num === Infinity) {
    return BigInt(Number.MAX_SAFE_INTEGER);
  }
  if (num === -Infinity) {
    return BigInt(Number.MIN_SAFE_INTEGER);
  }
  return BigInt(Math.floor(num));
}

export function maxInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

export function minInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
export function withinInt(num: bigint, min: bigint, max: bigint): bigint {
  const atLeastMin = maxInt(num, min);
  return minInt(atLeastMin, max);
}

export function sigmoid(
  value: number,
  decayRate: number,
  midpoint: number,
): number {
  return 1 / (1 + exp(-decayRate * (value - midpoint)));
}

// Longest label a featured lobby may show in the browser. Long enough for
// "Europe — Official OpenFront Masters Scrims", short enough that one row
// cannot crowd out the rest of the list. Lives here rather than in Schemas so
// the sanitiser that enforces it has no import back into Schemas — that edge
// would close a require cycle.
export const LOBBY_LABEL_MAX = 48;
