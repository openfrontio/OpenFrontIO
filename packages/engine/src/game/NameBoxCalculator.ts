import { NameViewData } from "@openfront/engine-api/game/GameTypes";
import { calculateBoundingBox } from "@openfront/engine-lib/Util";
import { Game, Player } from "./Game";

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Spawn region diameter (see getSpawnTiles in SpawnExecution — euclidean
// radius 4). Used to size spawn-phase names directly off the spawn tile,
// instead of waiting on cluster recomputation.
const SPAWN_REGION_DIAMETER = 8;
const MAX_HISTOGRAM_COLS = 8192;

let cachedHeights = new Int32Array(MAX_HISTOGRAM_COLS);
let cachedStack = new Int32Array(MAX_HISTOGRAM_COLS);
const scratchRowRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

function ensureBufferSize(requiredSize: number): void {
  if (requiredSize <= cachedHeights.length) return;
  let newCap = cachedHeights.length;
  while (newCap < requiredSize) newCap *= 2;
  cachedHeights = new Int32Array(newCap);
  cachedStack = new Int32Array(newCap);
}

function getScalingFactor(width: number, height: number): number {
  const size = Math.min(width, height);
  if (size < 25) return 1;
  if (size < 50) return 2;
  if (size < 100) return 4;
  if (size < 250) return 8;
  if (size < 500) return 16;
  return 32;
}

/**
 * Place a player's name during the spawn phase using their currently-selected
 * spawn tile. Tracks re-rolls immediately, since spawnTile updates the same
 * tick the player picks a new location.
 */
export function placeSpawnName(game: Game, player: Player): NameViewData {
  const spawnTile = player.spawnTile();
  if (spawnTile === undefined) {
    return { x: 0, y: 0, size: 0 };
  }
  const fontSize = calculateFontSize(
    {
      x: 0,
      y: 0,
      width: SPAWN_REGION_DIAMETER,
      height: SPAWN_REGION_DIAMETER,
    },
    player.displayName(),
  );
  return {
    x: Math.ceil(game.x(spawnTile)),
    y: Math.ceil(game.y(spawnTile) - fontSize / 3),
    size: fontSize,
  };
}

export function placeName(game: Game, player: Player): NameViewData {
  const bb =
    player.largestClusterBoundingBox ??
    calculateBoundingBox(game, player.borderTiles());

  const sf = getScalingFactor(bb.max.x - bb.min.x, bb.max.y - bb.min.y);
  const minX = Math.floor(bb.min.x / sf);
  const maxX = Math.floor(bb.max.x / sf);
  const minY = Math.floor(bb.min.y / sf);
  const maxY = Math.floor(bb.max.y / sf);
  const cols = maxX - minX + 1;
  const rows = maxY - minY + 1;

  const grid = createGrid(game, player, bb, sf);
  const rect = findLargestInscribedRectangle(grid, cols, rows);
  rect.x *= sf;
  rect.y *= sf;
  rect.width *= sf;
  rect.height *= sf;

  const fontSize = calculateFontSize(rect, player.displayName());
  const cx = Math.floor(rect.x + rect.width / 2 + bb.min.x);
  const cy = Math.floor(rect.y + rect.height / 2 + bb.min.y) - fontSize / 3;

  return { x: Math.ceil(cx), y: Math.ceil(cy), size: fontSize };
}

function isNameBoxTile(
  game: Game,
  player: Player,
  wx: number,
  wy: number,
): boolean {
  if (!game.isValidCoord(wx, wy)) return false;
  const tile = game.ref(wx, wy);
  return (
    game.isShore(tile) ||
    (game.isOcean(tile) && game.magnitude(tile) < 10) ||
    game.owner(tile) === player ||
    game.hasFallout(tile)
  );
}

export function createGrid(
  game: Game,
  player: Player,
  boundingBox: { min: Point; max: Point },
  scalingFactor: number,
): Uint8Array {
  const minX = Math.floor(boundingBox.min.x / scalingFactor);
  const minY = Math.floor(boundingBox.min.y / scalingFactor);
  const maxX = Math.floor(boundingBox.max.x / scalingFactor);
  const maxY = Math.floor(boundingBox.max.y / scalingFactor);
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width <= 0 || height <= 0) return new Uint8Array(0);

  const grid = new Uint8Array(width * height);
  for (let y = minY; y <= maxY; y++) {
    const rowOffset = (y - minY) * width;
    const wy = y * scalingFactor;
    for (let x = minX; x <= maxX; x++) {
      if (isNameBoxTile(game, player, x * scalingFactor, wy)) {
        grid[rowOffset + (x - minX)] = 1;
      }
    }
  }
  return grid;
}

function findLargestInscribedRectangleLegacy(grid: boolean[][]): Rectangle {
  const cols = grid.length;
  const rows = cols > 0 ? (grid[0]?.length ?? 0) : 0;
  if (cols === 0 || rows === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const flat = new Uint8Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (grid[c]?.[r]) flat[r * cols + c] = 1;
    }
  }
  return findLargestInscribedRectangle(flat, cols, rows);
}

function scanGridRows(grid: Uint8Array, cols: number, rows: number): Rectangle {
  let bestX = 0,
    bestY = 0,
    bestW = 0,
    bestH = 0,
    maxArea = 0;

  for (let r = 0; r < rows; r++) {
    const rowOffset = r * cols;
    for (let c = 0; c < cols; c++) {
      cachedHeights[c] = grid[rowOffset + c] ? cachedHeights[c] + 1 : 0;
    }
    largestRectangleInHistogram(cachedHeights, cols, scratchRowRect);
    const { width: w, height: h, x } = scratchRowRect;
    if (w * h > maxArea) {
      maxArea = w * h;
      bestX = x;
      bestY = r - h + 1;
      bestW = w;
      bestH = h;
    }
  }
  return { x: bestX, y: bestY, width: bestW, height: bestH };
}

export function findLargestInscribedRectangle(
  grid: Uint8Array | boolean[][],
  colsParam?: number,
  rowsParam?: number,
): Rectangle {
  if (Array.isArray(grid)) return findLargestInscribedRectangleLegacy(grid);
  const cols = colsParam ?? 0;
  const rows = rowsParam ?? (cols > 0 ? (grid.length / cols) | 0 : 0);
  if (cols <= 0 || rows <= 0) return { x: 0, y: 0, width: 0, height: 0 };

  ensureBufferSize(cols + 1);
  cachedHeights.fill(0, 0, cols);
  return scanGridRows(grid, cols, rows);
}

function assignRectangle(
  x: number,
  y: number,
  w: number,
  h: number,
  out?: Rectangle,
): Rectangle {
  if (out !== undefined) {
    out.x = x;
    out.y = y;
    out.width = w;
    out.height = h;
    return out;
  }
  return { x, y, width: w, height: h };
}

export function largestRectangleInHistogram(
  widths: ArrayLike<number>,
  length: number = widths.length,
  out?: Rectangle,
): Rectangle {
  ensureBufferSize(length + 1);
  let stackSize = 0,
    maxArea = 0,
    bestX = 0,
    bestW = 0,
    bestH = 0;

  for (let i = 0; i <= length; i++) {
    const h = i === length ? 0 : widths[i];
    while (stackSize > 0 && h < widths[cachedStack[stackSize - 1]]) {
      const height = widths[cachedStack[--stackSize]];
      const width = stackSize === 0 ? i : i - cachedStack[stackSize - 1] - 1;
      if (height * width > maxArea) {
        maxArea = height * width;
        bestX = stackSize === 0 ? 0 : cachedStack[stackSize - 1] + 1;
        bestW = width;
        bestH = height;
      }
    }
    cachedStack[stackSize++] = i;
  }

  return assignRectangle(bestX, 0, bestW, bestH, out);
}

export function calculateFontSize(rectangle: Rectangle, name: string): number {
  // This is a simplified calculation. You might want to adjust it based on your specific font and rendering system.
  const widthConstrained = (rectangle.width / name.length) * 2;
  const heightConstrained = rectangle.height / 3;
  return Math.min(widthConstrained, heightConstrained);
}
