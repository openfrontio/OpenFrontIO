import { Game } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MiniAStarAdapter } from "./adapters/MiniAStarAdapter";

export enum PathStatus {
  NEXT,
  PENDING,
  COMPLETE,
  NOT_FOUND,
}

export type PathResult =
  | { status: PathStatus.PENDING }
  | { status: PathStatus.NEXT; node: TileRef }
  | { status: PathStatus.COMPLETE; node: TileRef }
  | { status: PathStatus.NOT_FOUND };

export interface PathFinder {
  next(from: TileRef, to: TileRef, dist?: number): PathResult;
  findPath(from: TileRef, to: TileRef): TileRef[] | null;
}

export interface MiniAStarOptions {
  waterPath?: boolean;
  iterations?: number;
  maxTries?: number;
}

export class PathFinders {
  static Water(game: Game, options?: MiniAStarOptions): PathFinder {
    return new MiniAStarAdapter(game, options);
  }
}
