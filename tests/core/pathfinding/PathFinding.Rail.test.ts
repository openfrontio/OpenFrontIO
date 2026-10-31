import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Game } from "@openfront/engine/game/Game";
import { PathFinding } from "@openfront/engine/pathfinding/PathFinder";
import { PathFinderStepper } from "@openfront/engine/pathfinding/PathFinderStepper";
import { SteppingPathFinder } from "@openfront/engine/pathfinding/types";
import { beforeAll, describe, expect, it } from "vitest";
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

  describe("shared search engine", () => {
    it("shares one engine per game and builds another for another game", async () => {
      const a = PathFinding.Rail(game) as PathFinderStepper<TileRef>;
      const b = PathFinding.Rail(game) as PathFinderStepper<TileRef>;
      expect(a).not.toBe(b);
      expect(a.innerFinder()).toBe(b.innerFinder());

      const other = await setup("ocean_and_land");
      const c = PathFinding.Rail(other) as PathFinderStepper<TileRef>;
      expect(c.innerFinder()).not.toBe(a.innerFinder());
    });

    it("answers a query the same before and after other queries", async () => {
      const plains = await setup("plains");
      const map = plains.map();
      const from = map.ref(5, 5);
      const to = map.ref(40, 30);
      const first = PathFinding.Rail(plains).findPath(from, to);
      expect(first).not.toBeNull();
      expect(first!.length).toBeGreaterThan(2);

      const shared = PathFinding.Rail(plains);
      shared.findPath(map.ref(10, 50), map.ref(45, 10));
      shared.findPath(to, from);
      shared.findPath(map.ref(2, 45), map.ref(45, 2));
      expect(shared.findPath(from, to)).toEqual(first);
      expect(PathFinding.Rail(plains).findPath(from, to)).toEqual(first);
    });
  });
});
