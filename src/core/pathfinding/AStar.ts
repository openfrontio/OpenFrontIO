export interface AStar<NodeType> {
  compute(): PathFindResultType;
  reconstructPath(): NodeType[];
}

export const PathFindResultType = {
  NextTile: "NextTile",
  Pending: "Pending",
  Completed: "Completed",
  PathNotFound: "PathNotFound",
} as const;
export type PathFindResultType = keyof typeof PathFindResultType;

export type AStarResult<NodeType> =
  | {
      type: typeof PathFindResultType.NextTile;
      node: NodeType;
    }
  | {
      type: typeof PathFindResultType.Pending;
    }
  | {
      type: typeof PathFindResultType.Completed;
      node: NodeType;
    }
  | {
      type: typeof PathFindResultType.PathNotFound;
    };

export interface Point {
  x: number;
  y: number;
}
