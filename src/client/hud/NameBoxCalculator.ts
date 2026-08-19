import { Cell, Game, NameViewData, Player } from "../../core/game/Game";
import { calculateBoundingBox } from "../../core/Util";

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
  const boundingBox =
    player.largestClusterBoundingBox ??
    calculateBoundingBox(game, player.borderTiles());

  let scalingFactor: number;
  const width = boundingBox.max.x - boundingBox.min.x;
  const height = boundingBox.max.y - boundingBox.min.y;
  const size = Math.min(width, height);
  if (size < 25) {
    scalingFactor = 1;
  } else if (size < 50) {
    scalingFactor = 2;
  } else if (size < 100) {
    scalingFactor = 4;
  } else if (size < 250) {
    scalingFactor = 8;
  } else if (size < 500) {
    scalingFactor = 16;
  } else {
    scalingFactor = 32;
  }

  const grid = createGrid(game, player, boundingBox, scalingFactor);
  const largestRectangle = findLargestInscribedRectangle(grid);
  largestRectangle.x = largestRectangle.x * scalingFactor;
  largestRectangle.y = largestRectangle.y * scalingFactor;
  largestRectangle.width = largestRectangle.width * scalingFactor;
  largestRectangle.height = largestRectangle.height * scalingFactor;

  let center = new Cell(
    Math.floor(
      largestRectangle.x + largestRectangle.width / 2 + boundingBox.min.x,
    ),
    Math.floor(
      largestRectangle.y + largestRectangle.height / 2 + boundingBox.min.y,
    ),
  );

  const fontSize = calculateFontSize(largestRectangle, player.displayName());
  center = new Cell(center.x, center.y - fontSize / 3);

  return {
    x: Math.ceil(center.x),
    y: Math.ceil(center.y),
    size: fontSize,
  };
}

/**
 * Flat, x-major occupancy grid of a player's territory (1 = name can sit
 * here: owned tile, shore, shallow ocean, or fallout). A single Uint8Array
 * replaces the previous boolean[][] (one allocation per row + one boxed
 * boolean per cell), and coordinates are computed with plain arithmetic
 * instead of allocating a Cell per grid cell.
 */
export interface NameGrid {
  grid: Uint8Array;
  width: number;
  height: number;
}

export function createGrid(
  game: Game,
  player: Player,
  boundingBox: { min: Point; max: Point },
  scalingFactor: number,
): NameGrid {
  const scaledBoundingBox: { min: Point; max: Point } = {
    min: {
      x: Math.floor(boundingBox.min.x / scalingFactor),
      y: Math.floor(boundingBox.min.y / scalingFactor),
    },
    max: {
      x: Math.floor(boundingBox.max.x / scalingFactor),
      y: Math.floor(boundingBox.max.y / scalingFactor),
    },
  };

  const width = scaledBoundingBox.max.x - scaledBoundingBox.min.x + 1;
  const height = scaledBoundingBox.max.y - scaledBoundingBox.min.y + 1;
  const grid = new Uint8Array(width * height);
  const mapWidth = game.width();
  const mapHeight = game.height();

  let idx = 0;
  for (let gx = scaledBoundingBox.min.x; gx <= scaledBoundingBox.max.x; gx++) {
    const px = gx * scalingFactor;
    for (
      let gy = scaledBoundingBox.min.y;
      gy <= scaledBoundingBox.max.y;
      gy++
    ) {
      const py = gy * scalingFactor;
      if (px >= 0 && px < mapWidth && py >= 0 && py < mapHeight) {
        const tile = game.ref(px, py);
        if (
          game.isShore(tile) ||
          (game.isOcean(tile) && game.magnitude(tile) < 10) ||
          game.owner(tile) === player ||
          game.hasFallout(tile)
        ) {
          grid[idx] = 1;
        }
      }
      idx++;
    }
  }

  return { grid, width, height };
}

export function findLargestInscribedRectangle(grid: NameGrid): Rectangle {
  const data = grid.grid;
  const rows = grid.height;
  const cols = grid.width;
  const heights: number[] = new Array(cols).fill(0);
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let row = 0; row < rows; row++) {
    // Column-major scan with an incrementing pointer into the flat grid
    // (x-major layout: index = col * rows + row).
    let p = row;
    for (let col = 0; col < cols; col++) {
      if (data[p] !== 0) {
        heights[col]++;
      } else {
        heights[col] = 0;
      }
      p += rows;
    }

    const rectForRow = largestRectangleInHistogram(heights);

    if (
      rectForRow.width * rectForRow.height >
      largestRect.width * largestRect.height
    ) {
      largestRect = {
        x: rectForRow.x,
        y: row - rectForRow.height + 1,
        width: rectForRow.width,
        height: rectForRow.height,
      };
    }
  }

  return largestRect;
}

export function largestRectangleInHistogram(widths: number[]): Rectangle {
  const stack: number[] = [];
  let maxArea = 0;
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let i = 0; i <= widths.length; i++) {
    const h = i === widths.length ? 0 : widths[i];

    while (stack.length > 0 && h < widths[stack[stack.length - 1]]) {
      const height = widths[stack.pop()!];
      const width = stack.length === 0 ? i : i - stack[stack.length - 1] - 1;

      if (height * width > maxArea) {
        maxArea = height * width;
        largestRect = {
          x: stack.length === 0 ? 0 : stack[stack.length - 1] + 1,
          y: 0,
          width: width,
          height: height,
        };
      }
    }

    stack.push(i);
  }

  return largestRect;
}

export function calculateFontSize(rectangle: Rectangle, name: string): number {
  // This is a simplified calculation. You might want to adjust it based on your specific font and rendering system.
  const widthConstrained = (rectangle.width / name.length) * 2;
  const heightConstrained = rectangle.height / 3;
  return Math.min(widthConstrained, heightConstrained);
}
