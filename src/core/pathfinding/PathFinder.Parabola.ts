import { GameMap, TileRef } from "../game/GameMap";
import { within } from "../Util";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { PathResult, PathStatus, SteppingPathFinder } from "./types";

export interface ParabolaOptions {
  increment?: number;
  distanceBasedHeight?: boolean;
  directionUp?: boolean;
}

const PARABOLA_MIN_HEIGHT = 50;

export class ParabolaUniversalPathFinder
  implements SteppingPathFinder<TileRef>
{
  private curve: DistanceBasedBezierCurve | null = null;
  private lastTo: TileRef | null = null;

  constructor(
    private gameMap: GameMap,
    private options?: ParabolaOptions,
  ) {}

  private createCurve(from: TileRef, to: TileRef): DistanceBasedBezierCurve {
    const increment = this.options?.increment ?? 3;
    const distanceBasedHeight = this.options?.distanceBasedHeight ?? true;
    const directionUp = this.options?.directionUp ?? true;

    const p0 = { x: this.gameMap.x(from), y: this.gameMap.y(from) };
    const p3 = { x: this.gameMap.x(to), y: this.gameMap.y(to) };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxHeight = distanceBasedHeight
      ? Math.max(distance / 3, PARABOLA_MIN_HEIGHT)
      : 0;
    const heightMult = directionUp ? -1 : 1;
    const mapHeight = this.gameMap.height();

    const p1 = {
      x: p0.x + dx / 4,
      y: within(p0.y + dy / 4 + heightMult * maxHeight, 0, mapHeight - 1),
    };
    const p2 = {
      x: p0.x + (dx * 3) / 4,
      y: within(p0.y + (dy * 3) / 4 + heightMult * maxHeight, 0, mapHeight - 1),
    };

    return new DistanceBasedBezierCurve(p0, p1, p2, p3, increment);
  }

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    if (Array.isArray(from)) {
      throw new Error(
        "ParabolaUniversalPathFinder does not support multiple start points",
      );
    }
    const curve = this.createCurve(from, to);
    return curve
      .getAllPoints()
      .map((p) => this.gameMap.ref(Math.floor(p.x), Math.floor(p.y)));
  }

  next(from: TileRef, to: TileRef, speed?: number): PathResult<TileRef> {
    if (this.lastTo !== to) {
      this.curve = this.createCurve(from, to);
      this.lastTo = to;
    }

    const nextPoint = this.curve!.increment(speed ?? 1);
    if (!nextPoint) {
      return { status: PathStatus.COMPLETE, node: to };
    }
    const tile = this.gameMap.ref(
      Math.floor(nextPoint.x),
      Math.floor(nextPoint.y),
    );
    return { status: PathStatus.NEXT, node: tile };
  }

  invalidate(): void {
    this.curve = null;
    this.lastTo = null;
  }

  currentIndex(): number {
    return this.curve?.getCurrentIndex() ?? 0;
  }
}
