import { Cell } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { GraphAdapter, SerialAStar } from "./SerialAStar";

export class GameMapAdapter implements GraphAdapter<TileRef> {
  constructor(
    private gameMap: GameMap,
    private waterPath: boolean,
    private allowLandToWaterStep = false,
    private nonOceanWaterPenalty = 0,
  ) {}
  private enclosedOceanCache = new Map<TileRef, boolean>();

  neighbors(node: TileRef): TileRef[] {
    return this.gameMap.neighbors(node);
  }

  cost(node: TileRef): number {
    let base = this.gameMap.cost(node);
    if (!this.waterPath && this.allowLandToWaterStep) {
      if (this.gameMap.isWater(node) && !this.gameMap.isOcean(node)) {
        base += this.nonOceanWaterPenalty;
      }
    }
    return base;
  }

  position(node: TileRef): { x: number; y: number } {
    return { x: this.gameMap.x(node), y: this.gameMap.y(node) };
  }

  isTraversable(from: TileRef, to: TileRef): boolean {
    const toIsWater = this.gameMap.isWater(to);
    if (this.waterPath) {
      // Water-only traversal (for ships)
      return toIsWater;
    }
    // Land traversal (for rails/land units) with river/lake crossing.
    // If enabled, allow traversal over any non-ocean water (rivers/lakes).
    if (!toIsWater) return true;
    if (!this.allowLandToWaterStep) return false;
    if (!this.gameMap.isOcean(to)) return true; // rivers/lakes
    // ocean tile: allow if enclosed or it's a narrow crossing (like a river mouth/strait)
    return this.isEnclosedOcean(to) || this.isNarrowOceanCrossing(to, 4);
  }

  private isEnclosedOcean(start: TileRef): boolean {
    // Cache lookup
    const cached = this.enclosedOceanCache.get(start);
    if (cached !== undefined) return cached;

    // BFS over ocean tiles; if any touches the map edge, it's not enclosed
    const q: TileRef[] = [];
    const seen = new Set<TileRef>();
    q.push(start);
    seen.add(start);

    let enclosed = true;
    while (q.length > 0) {
      const cur = q.pop()!;
      if (this.gameMap.isOnEdgeOfMap(cur)) {
        enclosed = false;
        break;
      }
      for (const n of this.gameMap.neighbors(cur)) {
        if (!seen.has(n) && this.gameMap.isOcean(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }

    // Cache result for all visited tiles
    for (const t of seen) this.enclosedOceanCache.set(t, enclosed);
    return enclosed;
  }

  private isNarrowOceanCrossing(center: TileRef, maxWidth: number): boolean {
    const cx = this.gameMap.x(center);
    const cy = this.gameMap.y(center);

    // Helper to measure continuous ocean run until hitting land; returns distance to land or Infinity
    const distanceToLand = (dx: number, dy: number): number => {
      let dist = 0;
      // Walk outward until a non-ocean tile is hit or bounds end
      while (true) {
        dist++;
        const nx = cx + dx * dist;
        const ny = cy + dy * dist;
        if (!this.gameMap.isValidCoord(nx, ny)) return Number.POSITIVE_INFINITY;
        const ref = this.gameMap.ref(nx, ny);
        if (!this.gameMap.isOcean(ref)) {
          return this.gameMap.isLand(ref) ? dist : Number.POSITIVE_INFINITY;
        }
        // keep going over ocean
        if (dist > maxWidth) return Number.POSITIVE_INFINITY;
      }
    };

    // Compute width horizontally and vertically; allow if either is <= maxWidth
    const west = distanceToLand(-1, 0);
    const east = distanceToLand(1, 0);
    if (Number.isFinite(west) && Number.isFinite(east)) {
      const width = (west) + (east) + 1;
      if (width <= maxWidth) return true;
    }
    const north = distanceToLand(0, -1);
    const south = distanceToLand(0, 1);
    if (Number.isFinite(north) && Number.isFinite(south)) {
      const width = (north) + (south) + 1;
      if (width <= maxWidth) return true;
    }
    return false;
  }
}
export class MiniAStar implements AStar<TileRef> {
  private aStar: AStar<TileRef>;

  constructor(
    private gameMap: GameMap,
    private miniMap: GameMap,
    private src: TileRef | TileRef[],
    private dst: TileRef,
    iterations: number,
    maxTries: number,
    waterPath = true,
    directionChangePenalty = 0,
    allowLandToWaterStep = false,
    nonOceanWaterPenalty = 0,
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
      new GameMapAdapter(
        miniMap,
        waterPath,
        allowLandToWaterStep,
        nonOceanWaterPenalty,
      ),
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
