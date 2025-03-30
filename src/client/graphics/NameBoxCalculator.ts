import { Game, Player, Cell } from "../../core/game/Game";
import { NameViewData } from "../../core/game/Game";
import { calculateBoundingBox, within } from "../../core/Util";

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

function calculateRotation(player: Player, game: Game): number {
  const totalTiles = player.numTilesOwned();
  if (totalTiles === 0) return 0;

  const step = Math.max(1, Math.floor(totalTiles / 100));

  let sumX = 0;
  let sumY = 0;
  let sampleCount = 0;

  for (const tile of player.tiles()) {
    if (sampleCount % step === 0) {
      const cell = game.cell(tile);
      sumX += cell.x;
      sumY += cell.y;
      sampleCount++;
    }
  }

  if (sampleCount === 0) return 0;

  const centerX = sumX / sampleCount;
  const centerY = sumY / sampleCount;

  let sumXX = 0;
  let sumYY = 0;
  let sumXY = 0;

  sampleCount = 0;
  for (const tile of player.tiles()) {
    if (sampleCount % step === 0) {
      const cell = game.cell(tile);
      const x = cell.x - centerX;
      const y = cell.y - centerY;

      sumXX += x * x;
      sumYY += y * y;
      sumXY += x * y;
      sampleCount++;
    }
  }

  if (sumXX + sumYY < 1) return 0;

  const damp = 0.1;
  const theta = (damp * Math.atan2(2 * sumXY, sumXX - sumYY)) / 2;

  const rotationDeg = theta * (180 / Math.PI);

  const maxRotation = 30;
  return Math.max(-maxRotation, Math.min(maxRotation, rotationDeg));
}

export function placeName(game: Game, player: Player): NameViewData {
  const boundingBox =
    player.largestClusterBoundingBox ??
    calculateBoundingBox(game, player.borderTiles());

  let scalingFactor = 1;
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

  const fontSize = calculateFontSize(largestRectangle, player.name());
  center = new Cell(center.x, center.y - fontSize / 3);

  const rotation = calculateRotation(player, game);

  return {
    x: Math.ceil(center.x),
    y: Math.ceil(center.y),
    size: fontSize,
    rotation: rotation,
  };
}

export function createGrid(
  game: Game,
  player: Player,
  boundingBox: { min: Point; max: Point },
  scalingFactor: number,
): boolean[][] {
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
  const grid: boolean[][] = Array(width)
    .fill(null)
    .map(() => Array(height).fill(false));

  for (let x = scaledBoundingBox.min.x; x <= scaledBoundingBox.max.x; x++) {
    for (let y = scaledBoundingBox.min.y; y <= scaledBoundingBox.max.y; y++) {
      const cell = new Cell(x * scalingFactor, y * scalingFactor);
      if (game.isOnMap(cell)) {
        const tile = game.ref(cell.x, cell.y);
        grid[x - scaledBoundingBox.min.x][y - scaledBoundingBox.min.y] =
          game.isLake(tile) || game.owner(tile) === player; // TODO: okay if lake
      }
    }
  }

  return grid;
}

export function findLargestInscribedRectangle(grid: boolean[][]): Rectangle {
  const rows = grid[0].length;
  const cols = grid.length;
  const heights: number[] = new Array(cols).fill(0);
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[col][row]) {
        heights[col]++;
      } else {
        heights[col] = 0;
      }
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
