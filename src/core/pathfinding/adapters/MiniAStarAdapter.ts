import { Game } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PathFindResultType } from "../AStar";
import { PathFinder, MiniAStarOptions, PathResult, PathStatus } from "../PathFinder";
import { MiniPathFinder } from "../PathFinding";

const DEFAULT_ITERATIONS = 10_000;
const DEFAULT_MAX_TRIES = 100;

export class MiniAStarAdapter implements PathFinder {
  private miniPathFinder: MiniPathFinder;

  constructor(game: Game, options?: MiniAStarOptions) {
    this.miniPathFinder = new MiniPathFinder(
      game,
      options?.iterations ?? DEFAULT_ITERATIONS,
      options?.waterPath ?? true,
      options?.maxTries ?? DEFAULT_MAX_TRIES
    );
  }

  next(from: TileRef, to: TileRef, dist?: number): PathResult {
    const result = this.miniPathFinder.nextTile(from, to, dist);

    switch (result.type) {
      case PathFindResultType.Pending:
        return { status: PathStatus.PENDING };
      case PathFindResultType.NextTile:
        return { status: PathStatus.NEXT, node: result.node };
      case PathFindResultType.Completed:
        return { status: PathStatus.COMPLETE, node: result.node };
      case PathFindResultType.PathNotFound:
        return { status: PathStatus.NOT_FOUND };
    }
  }

  findPath(from: TileRef, to: TileRef): TileRef[] | null {
    const path: TileRef[] = [from];
    let current = from;
    const maxSteps = 100_000;

    for (let i = 0; i < maxSteps; i++) {
      const result = this.next(current, to);

      if (result.status === PathStatus.COMPLETE) {
        return path;
      }

      if (result.status === PathStatus.NOT_FOUND) {
        return null;
      }

      if (result.status === PathStatus.NEXT) {
        current = result.node;
        path.push(current);
      }
    }

    return null;
  }
}
