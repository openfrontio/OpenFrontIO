import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { AStar, PathFindResultType, TileResult } from "./AStar";
import { MiniAStar } from "./MiniAStar";
import { HPADataManager, HPASearch } from "./HPAStar";

const parabolaMinHeight = 50;

export class ParabolaPathFinder {
  constructor(private mg: GameMap) {}
  private curve: DistanceBasedBezierCurve | undefined;

  computeControlPoints(
    orig: TileRef,
    dst: TileRef,
    distanceBasedHeight = true,
  ) {
    const p0 = { x: this.mg.x(orig), y: this.mg.y(orig) };
    const p3 = { x: this.mg.x(dst), y: this.mg.y(dst) };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxHeight = distanceBasedHeight
      ? Math.max(distance / 3, parabolaMinHeight)
      : 0;
    // Use a bezier curve always pointing up
    const p1 = {
      x: p0.x + (p3.x - p0.x) / 4,
      y: Math.max(p0.y + (p3.y - p0.y) / 4 - maxHeight, 0),
    };
    const p2 = {
      x: p0.x + ((p3.x - p0.x) * 3) / 4,
      y: Math.max(p0.y + ((p3.y - p0.y) * 3) / 4 - maxHeight, 0),
    };

    this.curve = new DistanceBasedBezierCurve(p0, p1, p2, p3);
  }

  nextTile(speed: number): TileRef | true {
    if (!this.curve) {
      throw new Error("ParabolaPathFinder not initialized");
    }
    const nextPoint = this.curve.increment(speed);
    if (!nextPoint) {
      return true;
    }
    return this.mg.ref(Math.floor(nextPoint.x), Math.floor(nextPoint.y));
  }
}

export class AirPathFinder {
  constructor(
    private mg: GameMap,
    private random: PseudoRandom,
  ) {}

  nextTile(tile: TileRef, dst: TileRef): TileRef | true {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const dstX = this.mg.x(dst);
    const dstY = this.mg.y(dst);

    if (x === dstX && y === dstY) {
      return true;
    }

    // Calculate next position
    let nextX = x;
    let nextY = y;

    const ratio = Math.floor(1 + Math.abs(dstY - y) / (Math.abs(dstX - x) + 1));

    if (this.random.chance(ratio) && x !== dstX) {
      if (x < dstX) nextX++;
      else if (x > dstX) nextX--;
    } else {
      if (y < dstY) nextY++;
      else if (y > dstY) nextY--;
    }
    if (nextX === x && nextY === y) {
      return true;
    }
    return this.mg.ref(nextX, nextY);
  }
}

export class PathFinder {
  private curr: TileRef | null = null;
  private dst: TileRef | null = null;
  private path: TileRef[] | null = null;
  private aStar!: AStar; 
  private computeFinished = true;

  private constructor(
    private game: Game,
    private newAStar: (curr: TileRef, dst: TileRef) => AStar,
  ) {}

  public static Mini(game: Game, iterations: number, maxTries: number = 20) {
    return new PathFinder(game, (curr: TileRef, dst: TileRef) => {
      return new MiniAStar(
        game.map(),
        game.miniMap(),
        curr,
        dst,
        iterations,
        maxTries,
      );
    });
  }

  /**
   * Creates a PathFinder that uses the HPA* algorithm.
   * @param game The main game object.
   * @param hpaData The pre-computed data from HPADataManager.
   */
  public static HPA(game: Game, hpaData: HPADataManager) {
    return new PathFinder(game, (curr: TileRef, dst: TileRef) => {
      return new HPASearch(hpaData, game.map(), curr, dst);
    });
  }

  nextTile(
    curr: TileRef | null,
    dst: TileRef | null,
    dist: number = 1,
  ): TileResult {
    if (curr === null || dst === null) {
      return { type: PathFindResultType.PathNotFound };
    }

    if (this.game.manhattanDist(curr, dst) < dist) {
      return { type: PathFindResultType.Completed, tile: curr };
    }

    if (this.computeFinished) {
      if (this.shouldRecompute(curr, dst)) {
        this.curr = curr;
        this.dst = dst;
        this.path = null;
        this.aStar = this.newAStar(curr, dst);
        this.computeFinished = false;
        
      } else {
        const tile = this.path?.shift();
        if (tile === undefined) {
          // Path ran out but we are not at destination mrk for re-computation.
          this.computeFinished = true;
          return this.nextTile(curr, dst, dist);
        }
        return { type: PathFindResultType.NextTile, tile };
      }
    }

  
    switch (this.aStar.compute()) {
      case PathFindResultType.Completed:
        this.computeFinished = true;
        this.path = this.aStar.reconstructPath();
        if (this.path[0] === curr) this.path.shift();
        
        return this.nextTile(curr, dst, dist);

      case PathFindResultType.Pending:
        return { type: PathFindResultType.Pending };

      case PathFindResultType.PathNotFound:
        this.computeFinished = true;
        return { type: PathFindResultType.PathNotFound };
        
      default:
        throw new Error("Unexpected compute result");
    }
  }

  private shouldRecompute(curr: TileRef, dst: TileRef): boolean {
    // Recompute if there is no path, or if the destination has changed 
    if (this.path === null || this.curr === null || this.dst === null) {
      return true;
    }

    const dist = this.game.manhattanDist(curr, dst);
    let tolerance = dist > 50 ? 10 : (dist > 25 ? 5 : 0);
    if (this.game.manhattanDist(this.dst, dst) > tolerance) {
      return true;
    }
    
    
    if (this.path.length > 0 && this.path[0] !== curr) {
       
        const isNearPath = this.path.some(tile => this.game.manhattanDist(curr, tile) < 5);
        if(!isNearPath) return true;
    }

    return false;
  }
}

