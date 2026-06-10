import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "engine/game/Game";
import { TileRef } from "engine/game/GameMap";
import { PathFinding } from "engine/pathfinding/PathFinder";
import { SteppingPathFinder } from "engine/pathfinding/types";
import { setup } from "../../util/Setup";

describe("PathFinding.Rail", () => {
  let game: Game;
  let pathFinder: SteppingPathFinder<TileRef>;

  beforeAll(async () => {
    game = await setup("ocean_and_land");
    pathFinder = PathFinding.Rail(game);
  });

  describe("findPath", () => {
    it("finds path on land tiles", () => {
      const map = game.map();

      // Adjacent land tiles: (0,0) and (1,0)
      const from = map.ref(0, 0);
      const to = map.ref(1, 0);

      expect(map.isLand(from)).toBe(true);
      expect(map.isLand(to)).toBe(true);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
      expect(path![0]).toBe(from);
      expect(path![1]).toBe(to);
    });
  });
});
