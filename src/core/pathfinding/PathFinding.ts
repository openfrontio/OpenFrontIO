import { consolex } from "../Consolex";
import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { AStar, PathFindResultType, TileResult } from "./AStar";
import { MiniAStar } from "./MiniAStar";

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

    if (this.random.chance(ratio) && x != dstX) {
      if (x < dstX) nextX++;
      else if (x > dstX) nextX--;
    } else {
      if (y < dstY) nextY++;
      else if (y > dstY) nextY--;
    }
    if (nextX == x && nextY == y) {
      return true;
    }
    return this.mg.ref(nextX, nextY);
  }
}

export class PathFinder {
  private curr: TileRef = null;
  private dst: TileRef = null;
  private path: TileRef[];
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

  nextTile(curr: TileRef, dst: TileRef, dist: number = 1): TileResult {
    if (curr == null) {
      consolex.error("curr is null");
      return { type: PathFindResultType.PathNotFound };
    }
    if (dst == null) {
      consolex.error("dst is null");
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
        return { type: PathFindResultType.NextTile, tile: this.path.shift() };
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
    }
  }

  private shouldRecompute(curr: TileRef, dst: TileRef) {
    if (this.path == null || this.curr == null || this.dst == null) {
      return true;
    }
    const dist = this.game.manhattanDist(curr, dst);
    let tolerance = 10;
    if (dist > 50) {
      tolerance = 10;
    } else if (dist > 25) {
      tolerance = 5;
    } else {
      tolerance = 0;
    }
    if (this.game.manhattanDist(this.dst, dst) > tolerance) {
      return true;
    }
    return false;
  }
}
