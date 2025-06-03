import { Cell } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { SerialAStar } from "./SerialAStar";

export class MiniAStar implements AStar {
  private aStar: AStar;

  constructor(
    private gameMap: GameMap,
    private miniMap: GameMap,
    private src: TileRef | TileRef[],
    private dst: TileRef,
    iterations: number,
    maxTries: number,
  ) {
    const srcArray: TileRef[] = Array.isArray(src) ? src : [src];
    const miniSrc = srcArray.map((srcPoint) =>
      this.miniMap.ref(
        Math.floor(gameMap.x(srcPoint) / 2),
        Math.floor(gameMap.y(srcPoint) / 2),
      ),
    );

    const miniDst = this.miniMap.ref(
      Math.floor(gameMap.x(dst) / 2),
      Math.floor(gameMap.y(dst) / 2),
    );

    this.aStar = new SerialAStar(
      miniSrc,
      miniDst,
      iterations,
      maxTries,
      this.miniMap,
    );
  }

  compute(): PathFindResultType {
    return this.aStar.compute();
  }

  reconstructPath(): TileRef[] {
    let cellSrc: Cell | undefined;
    if (!Array.isArray(this.src)) {
      cellSrc = new Cell(this.gameMap.x(this.src), this.gameMap.y(this.src));
    }
    const cellDst = new Cell(
      this.gameMap.x(this.dst),
      this.gameMap.y(this.dst),
    );
    const upscaled = fixExtremes(
      upscalePath(
        this.aStar
          .reconstructPath()
          .map((tr) => new Cell(this.miniMap.x(tr), this.miniMap.y(tr))),
      ),
      cellDst,
      cellSrc,
    );
    return upscaled.map((c) => this.gameMap.ref(c.x, c.y));
  }
}

/**
 * Ensures that the upscaled path starts with `cellSrc` (if provided) and ends with `cellDst`.
 * If `cellSrc` or `cellDst` are missing or not at the correct positions,
 * the function adjusts the path accordingly by trimming or adding these cells.
 *
 * @param upscaled - The upscaled path as an array of Cells.
 * @param cellDst - The destination Cell that should be at the end of the path.
 * @param cellSrc - (Optional) The start Cell that should be at the beginning of the path.
 * @returns A new array of Cells with fixed start and end points.
 */
function fixExtremes(upscaled: Cell[], cellDst: Cell, cellSrc?: Cell): Cell[] {
  let fixedPath = upscaled;

  if (cellSrc !== undefined) {
    const srcIndex = findCell(fixedPath, cellSrc);
    if (srcIndex === -1) {
      // Start cell not found — prepend it to the path
      fixedPath = [cellSrc, ...fixedPath];
    } else if (srcIndex !== 0) {
      // Start cell found but not at start — trim all before it
      fixedPath = fixedPath.slice(srcIndex);
    }
  }

  const dstIndex = findCell(fixedPath, cellDst);
  if (dstIndex === -1) {
    // Destination cell not found — append it to the path
    fixedPath = [...fixedPath, cellDst];
  } else if (dstIndex !== fixedPath.length - 1) {
    // Destination cell found but not at end — trim all after it
    fixedPath = fixedPath.slice(0, dstIndex + 1);
  }

  return fixedPath;
}

/**
 * Upscales a path of cells by a given scale factor and interpolates
 * intermediate points between scaled cells to create a smoother path.
 *
 * @param path - Array of Cell objects representing the original path.
 * @param scaleFactor - The factor by which to scale coordinates (default is 2).
 * @returns A new array of Cells representing the upscaled and smoothed path.
 */
function upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
  if (path.length === 0) return [];

  // Scale each point by the scaleFactor
  const scaledPath = path.map(
    (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
  );

  const smoothPath: Cell[] = [];

  for (let i = 0; i < scaledPath.length - 1; i++) {
    const current = scaledPath[i];
    const next = scaledPath[i + 1];

    // Add current point
    smoothPath.push(current);

    const dx = next.x - current.x;
    const dy = next.y - current.y;

    // Number of steps is max of delta x or delta y (to cover both axes)
    const steps = Math.max(Math.abs(dx), Math.abs(dy));

    // Interpolate intermediate points between current and next
    for (let step = 1; step < steps; step++) {
      smoothPath.push(
        new Cell(
          Math.round(current.x + (dx * step) / steps),
          Math.round(current.y + (dy * step) / steps),
        ),
      );
    }
  }

  // Add last point to complete the path
  smoothPath.push(scaledPath[scaledPath.length - 1]);
  return smoothPath;
}

/**
 * Finds the index of a cell in the upscaled path matching the given destination cell.
 *
 * @param upscaled - Array of upscaled Cells to search within.
 * @param cellDst - Cell to find.
 * @returns The index of the matching cell or -1 if not found.
 */
function findCell(upscaled: Cell[], cellDst: Cell): number {
  return upscaled.findIndex(
    (cell) => cell.x === cellDst.x && cell.y === cellDst.y,
  );
}
