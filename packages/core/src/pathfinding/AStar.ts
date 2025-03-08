import type { TileRef } from "../game/GameMap";

export interface AStar {
  compute(): PathFindResultType;
  reconstructPath(): TileRef[];
}

export enum PathFindResultType {
  NextTile,
  Pending,
  Completed,
  PathNotFound,
}
export type TileResult =
  | {
      type: PathFindResultType.NextTile;
      tile: TileRef;
    }
  | {
      type: PathFindResultType.Pending;
    }
  | {
      type: PathFindResultType.Completed;
      tile: TileRef;
    }
  | {
      type: PathFindResultType.PathNotFound;
    };

export interface Point {
  x: number;
  y: number;
}
