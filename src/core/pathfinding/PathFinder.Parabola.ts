import { Game, PlayerID } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { GameUpdateType } from "../game/GameUpdates";
import { within } from "../Util";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { PathResult, PathStatus, SteppingPathFinder } from "./types";

export interface ParabolaOptions {
  increment?: number;
  distanceBasedHeight?: boolean;
  directionUp?: boolean;
  minHeight?: number;
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
    const minHeight = this.options?.minHeight ?? PARABOLA_MIN_HEIGHT;
    const directionUp = this.options?.directionUp ?? true;

    const p0 = { x: this.gameMap.x(from), y: this.gameMap.y(from) };
    const p3 = { x: this.gameMap.x(to), y: this.gameMap.y(to) };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxHeight = distanceBasedHeight
      ? Math.max(distance / 3, minHeight)
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

export class BouncingParabolaUniversalPathFinder
  implements SteppingPathFinder<TileRef>
{
  private parabola: ParabolaUniversalPathFinder;
  private bouncing = false;

  private fromBounce: TileRef;
  private toBounce: TileRef;
  private previousIndex: number = 0;

  constructor(
    private mg: Game,
    private playerId: PlayerID,
    private options?: ParabolaOptions,
  ) {
    this.parabola = new ParabolaUniversalPathFinder(mg.map(), options);
  }

  next(from: number, to: number, dist?: number): PathResult<TileRef> {
    if (this.bouncing) {
      return this.nextBounce(dist);
    }
    const result = this.parabola.next(from, to, dist);
    if (result.status === PathStatus.COMPLETE) {
      if (this.bounce(from, to)) {
        return this.nextBounce();
      }
    }
    return result;
  }

  private bounce(from: number, to: number): boolean {
    const bounceDest = this.computeBounceDestination(from, to);
    if (!bounceDest) {
      return false;
    }
    this.previousIndex = this.parabola.currentIndex();
    this.bouncing = true;
    this.fromBounce = to;
    this.toBounce = bounceDest;

    this.mg.addUpdate({
      type: GameUpdateType.TextUIEvent,
      player: this.playerId,
      tile: to,
      text: "Boing",
    });

    this.parabola = new ParabolaUniversalPathFinder(this.mg.map(), {
      increment: this.options?.increment ?? 3,
      distanceBasedHeight: true,
      directionUp: this.options?.directionUp ?? true,
      minHeight: 25,
    });
    return true;
  }

  private nextBounce(dist?: number): PathResult<TileRef> {
    return this.parabola.next(this.fromBounce, this.toBounce, dist);
  }

  invalidate(): void {
    this.parabola.invalidate();
  }

  findPath(from: number | number[], to: number): number[] | null {
    if (Array.isArray(from)) {
      throw new Error(
        "ParabolaUniversalPathFinder does not support multiple start points",
      );
    }
    const tiles = this.parabola.findPath(from, to);
    const newDest = this.computeBounceDestination(from, to);
    if (tiles && newDest) {
      const bounceTiles = this.parabola.findPath(to, newDest);
      if (bounceTiles) {
        return tiles?.concat(bounceTiles);
      }
    }
    return tiles;
  }

  currentIndex(): number {
    return this.parabola.currentIndex() + this.previousIndex;
  }

  private computeBounceDestination(src: TileRef, dst: TileRef): TileRef | null {
    const destX = this.mg.x(dst);
    const destY = this.mg.y(dst);
    const srcX = this.mg.x(src);
    const srcY = this.mg.y(src);
    const newX = Math.min(
      Math.floor(destX + (destX - srcX) / 2),
      this.mg.width() - 1,
    );
    const newY = Math.min(
      Math.floor(destY + (destY - srcY) / 2),
      this.mg.height() - 1,
    );
    return this.mg.isValidCoord(newX, newY) ? this.mg.ref(newX, newY) : null;
  }
}
