import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { AStar, PathFindResultType, TileResult } from "./AStar";
import { MiniAStar } from "./MiniAStar";

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

  /**
   * Calculates the next tile along a parabolic path based on the given speed.
   *
   * This method advances the internal parametric curve by the specified speed,
   * retrieving the next point on the path. It then converts this point's coordinates
   * to a tile reference on the game map.
   *
   * @param speed - The amount to increment the curve parameter, controlling the step size.
   *
   * @returns The next tile reference on the path as a `TileRef`, or `true` if the end
   *          of the path has been reached (no further points).
   *
   * @throws Error if the internal curve is not initialized (the pathfinder is not ready).
   */
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

  /**
   * Calculates the next tile on the path from the current tile to the destination tile.
   * Moves either horizontally or vertically each step, with a probability
   * that favors the larger distance axis.
   *
   * If the current tile equals the destination tile, returns `true` indicating arrival.
   * If the next position doesn't change (already at destination), also returns `true`.
   * Otherwise, returns the next tile reference to move to.
   *
   * @param tile - The current tile reference.
   * @param dst - The destination tile reference.
   * @returns The next tile reference to move onto, or `true` if already at destination.
   */
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
  private aStar: AStar;
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
   * Calculates and returns the next tile along the path from the current position (`curr`)
   * towards the destination (`dst`). This method manages the A* pathfinding lifecycle,
   * including initiating pathfinding, checking if recomputation is needed, and stepping
   * through the computed path.
   *
   * Workflow:
   * - Validates input tiles and returns `PathNotFound` if invalid.
   * - If the current position is within `dist` distance of the destination, returns `Completed`.
   * - If a previous path computation is finished, decides whether to reuse or recompute the path.
   * - Continues running the A* computation until completion, pending status, or failure.
   * - Returns appropriate `TileResult` including next tile to move onto, completion, pending, or failure.
   *
   * @param curr - The current tile reference (cannot be null).
   * @param dst - The target destination tile reference (cannot be null).
   * @param dist - Optional distance threshold to consider destination reached (default is 1).
   *
   * @returns A `TileResult` indicating the next move, completion, pending state, or pathfinding failure.
   */
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
        return this.nextTile(curr, dst);
      } else {
        const tile = this.path?.shift();
        if (tile === undefined) {
          throw new Error("missing tile");
        }
        return { type: PathFindResultType.NextTile, tile };
      }
    }

    switch (this.aStar.compute()) {
      case PathFindResultType.Completed:
        this.computeFinished = true;
        this.path = this.aStar.reconstructPath();
        // Remove the start tile
        this.path.shift();

        return this.nextTile(curr, dst);
      case PathFindResultType.Pending:
        return { type: PathFindResultType.Pending };
      case PathFindResultType.PathNotFound:
        return { type: PathFindResultType.PathNotFound };
      default:
        throw new Error("unexpected compute result");
    }
  }

  /**
   * Determines whether the current computed path should be recomputed based on changes
   * in the current and destination tiles.
   *
   * Conditions for recomputing:
   * - If no existing path or stored current/destination positions.
   * - If the new destination is sufficiently different from the stored one, beyond a
   *   distance tolerance that scales with how far the `curr` and `dst` are.
   *
   * The tolerance thresholds are:
   * - Distance > 50: tolerance = 10
   * - Distance > 25: tolerance = 5
   * - Otherwise: tolerance = 0
   *
   * @param curr - The current tile reference.
   * @param dst - The destination tile reference.
   * @returns `true` if the path needs recomputing, `false` otherwise.
   */
  private shouldRecompute(curr: TileRef, dst: TileRef): boolean {
    if (!this.path || !this.curr || !this.dst) {
      return true;
    }

    const dist = this.game.manhattanDist(curr, dst);
    const tolerance = dist > 50 ? 10 : dist > 25 ? 5 : 0;

    return this.game.manhattanDist(this.dst, dst) > tolerance;
  }
}
