import { AStar, PathFindResultType } from "./AStar";
import { GameMap, TileRef } from "../game/GameMap";
import { GraphAdapter, SerialAStar } from "./SerialAStar";
import { Cell } from "../game/Game";

export class GameMapAdapter implements GraphAdapter<TileRef> {
  private readonly waterPenalty = 3;
  constructor(
    private readonly gameMap: GameMap,
    private readonly waterPath: boolean,
  ) {}

  neighbors(node: TileRef): TileRef[] {
    return this.gameMap.neighbors(node);
  }

  cost(node: TileRef): number {
    let base = this.gameMap.cost(node);
    // Avoid crossing water when possible
    if (!this.waterPath && this.gameMap.isWater(node)) {
      base += this.waterPenalty;
    }
    return base;
  }

  position(node: TileRef): { x: number; y: number } {
    return { x: this.gameMap.x(node), y: this.gameMap.y(node) };
  }

  isTraversable(from: TileRef, to: TileRef): boolean {
    const toWater = this.gameMap.isWater(to);
    if (this.waterPath) {
      return toWater;
    }
    // Allow water access from/to shore
    const fromShore = this.gameMap.isShoreline(from);
    const toShore = this.gameMap.isShoreline(to);
    return !toWater || fromShore || toShore;
  }
}
export class MiniAStar implements AStar<TileRef> {
  private readonly aStar: AStar<TileRef>;

  constructor(
    private readonly gameMap: GameMap,
    private readonly miniMap: GameMap,
    private readonly src: TileRef | TileRef[],
    private readonly dst: TileRef,
    iterations: number,
    maxTries: number,
    waterPath = true,
    directionChangePenalty = 0,
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
      new GameMapAdapter(miniMap, waterPath),
      directionChangePenalty,
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

function fixExtremes(upscaled: Cell[], cellDst: Cell, cellSrc?: Cell): Cell[] {
  if (cellSrc !== undefined) {
    const srcIndex = findCell(upscaled, cellSrc);
    if (srcIndex === -1) {
      // didnt find the start tile in the path
      upscaled.unshift(cellSrc);
    } else if (srcIndex !== 0) {
      // found start tile but not at the start
      // remove all tiles before the start tile
      upscaled = upscaled.slice(srcIndex);
    }
  }

  const dstIndex = findCell(upscaled, cellDst);
  if (dstIndex === -1) {
    // didnt find the dst tile in the path
    upscaled.push(cellDst);
  } else if (dstIndex !== upscaled.length - 1) {
    // found dst tile but not at the end
    // remove all tiles after the dst tile
    upscaled = upscaled.slice(0, dstIndex + 1);
  }
  return upscaled;
}

function upscalePath(path: Cell[], scaleFactor = 2): Cell[] {
  // Scale up each point
  const scaledPath = path.map(
    (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
  );

  const smoothPath: Cell[] = [];

  for (let i = 0; i < scaledPath.length - 1; i++) {
    const current = scaledPath[i];
    const next = scaledPath[i + 1];

    // Add the current point
    smoothPath.push(current);

    // Always interpolate between scaled points
    const dx = next.x - current.x;
    const dy = next.y - current.y;

    // Calculate number of steps needed
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = distance;

    // Add intermediate points
    for (let step = 1; step < steps; step++) {
      smoothPath.push(
        new Cell(
          Math.round(current.x + (dx * step) / steps),
          Math.round(current.y + (dy * step) / steps),
        ),
      );
    }
  }

  // Add the last point
  if (scaledPath.length > 0) {
    smoothPath.push(scaledPath[scaledPath.length - 1]);
  }

  return smoothPath;
}

function findCell(upscaled: Cell[], cellDst: Cell): number {
  for (let i = 0; i < upscaled.length; i++) {
    if (upscaled[i].x === cellDst.x && upscaled[i].y === cellDst.y) {
      return i;
    }
  }
  return -1;
}
