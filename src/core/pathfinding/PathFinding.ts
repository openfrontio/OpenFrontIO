import { consolex } from "../Consolex";
import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { AStar, PathFindResultType, TileResult } from "./AStar";
import { MiniAStar } from "./MiniAStar";

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

  public static Mini(
    game: Game,
    iterations: number,
    canMoveOnLand: boolean,
    maxTries: number = 20,
  ) {
    return new PathFinder(game, (curr: TileRef, dst: TileRef) => {
      return new MiniAStar(
        game.map(),
        game.miniMap(),
        curr,
        dst,
        (tr: TileRef): boolean => {
          if (canMoveOnLand) {
            return true;
          }
          return game.miniMap().isOcean(tr);
        },
        iterations,
        maxTries,
      );
    });
  }

  nextTile(curr: TileRef, dst: TileRef, dist: number = 1): TileResult {
    if (curr == null) {
      consolex.error("curr is null");
    }
    if (dst == null) {
      consolex.error("dst is null");
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
