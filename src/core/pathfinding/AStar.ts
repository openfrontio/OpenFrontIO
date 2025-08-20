import { z } from "zod";

export interface AStar<NodeType> {
  compute(): PathFindResultType;
  reconstructPath(): NodeType[];
}

export const PathFindResultTypeSchema = z.enum([
  "NextTile",
  "Pending",
  "Completed",
  "PathNotFound",
]);
export type PathFindResultType = z.infer<typeof PathFindResultTypeSchema>;

export type AStarResult<NodeType> =
  | {
      type: "NextTile";
      node: NodeType;
    }
  | {
      type: "Pending";
    }
  | {
      type: "Completed";
      node: NodeType;
    }
  | {
      type: "PathNotFound";
    };

export interface Point {
  x: number;
  y: number;
}
