import {Game, Player, Tile, Cell} from '../../core/game/Game';
import {calculateBoundingBox, within} from '../../core/Util';

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


export function placeName(game: Game, player: Player): [position: Cell, fontSize: number] {
    const boundingBox = calculateBoundingBox(player.borderTiles());

    const rawScalingFactor = (boundingBox.max.x - boundingBox.min.x) / 50
    const scalingFactor = within(Math.floor(rawScalingFactor), 1, 100)

    const grid = createGrid(game, player, boundingBox, scalingFactor);
    const largestRectangle = findLargestInscribedRectangle(grid);
    largestRectangle.x = largestRectangle.x * scalingFactor
    largestRectangle.y = largestRectangle.y * scalingFactor
    largestRectangle.width = largestRectangle.width * scalingFactor
    largestRectangle.height = largestRectangle.height * scalingFactor

    let center = new Cell(
        Math.floor(largestRectangle.x + largestRectangle.width / 2 + boundingBox.min.x),
        Math.floor(largestRectangle.y + largestRectangle.height / 2 + boundingBox.min.y),
    )

    const fontSize = calculateFontSize(largestRectangle, player.name());
    center = new Cell(center.x, center.y - fontSize / 3)

    return [center, fontSize]
}

export function createGrid(game: Game, player: Player, boundingBox: {min: Point; max: Point}, scalingFactor: number): boolean[][] {
    const scaledBoundingBox: {min: Point; max: Point} = {
        min: {
            x: Math.floor(boundingBox.min.x / scalingFactor),
            y: Math.floor(boundingBox.min.y / scalingFactor)
        },
        max: {
            x: Math.floor(boundingBox.max.x / scalingFactor),
            y: Math.floor(boundingBox.max.y / scalingFactor)
        }
    }


    const width = scaledBoundingBox.max.x - scaledBoundingBox.min.x + 1;
    const height = scaledBoundingBox.max.y - scaledBoundingBox.min.y + 1;
    const grid: boolean[][] = Array(width).fill(null).map(() => Array(height).fill(false));


    for (let x = scaledBoundingBox.min.x; x <= scaledBoundingBox.max.x; x++) {
        for (let y = scaledBoundingBox.min.y; y <= scaledBoundingBox.max.y; y++) {
            const cell = new Cell(x * scalingFactor, y * scalingFactor);
            if (game.isOnMap(cell)) {
                const tile = game.tile(cell);
                grid[x - scaledBoundingBox.min.x][y - scaledBoundingBox.min.y] = tile.isLake() || tile.owner() === player; // TODO: okay if lake
            }
        }
    }

    return grid;
}

export function findLargestInscribedRectangle(grid: boolean[][]): Rectangle {
    const rows = grid[0].length;
    const cols = grid.length;
    const heights: number[] = new Array(cols).fill(0);
    let largestRect: Rectangle = {x: 0, y: 0, width: 0, height: 0};

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (grid[col][row]) {
                heights[col]++;
            } else {
                heights[col] = 0;
            }
        }

        const rectForRow = largestRectangleInHistogram(heights);

        if (rectForRow.width * rectForRow.height > largestRect.width * largestRect.height) {
            largestRect = {
                x: rectForRow.x,
                y: row - rectForRow.height + 1,
                width: rectForRow.width,
                height: rectForRow.height
            };
        }
    }

    return largestRect;
}

export function largestRectangleInHistogram(widths: number[]): Rectangle {
    const stack: number[] = [];
    let maxArea = 0;
    let largestRect: Rectangle = {x: 0, y: 0, width: 0, height: 0};

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
                    height: height
                };
            }
        }

        stack.push(i);
    }

    return largestRect;
}

export function calculateFontSize(rectangle: Rectangle, name: string): number {
    // This is a simplified calculation. You might want to adjust it based on your specific font and rendering system.
    const widthConstrained = rectangle.width / name.length * 2;
    const heightConstrained = rectangle.height / 3;
    return Math.min(widthConstrained, heightConstrained);
}
