import { describe, expect, test } from "vitest";
import { Game } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathFindResultType } from "../../../src/core/pathfinding/AStar";
import { MiniAStar } from "../../../src/core/pathfinding/MiniAStar";
import { mapFromString } from "./utils";

function createAStar(
  game: Game,
  src: TileRef,
  dst: TileRef,
  waterPath = true,
): MiniAStar {
  return new MiniAStar(
    game.map(),
    game.miniMap(),
    src,
    dst,
    10000,
    100,
    waterPath,
  );
}

describe("MiniAStar", () => {
  describe("Basic pathfinding", () => {
    test("finds path between adjacent tiles", async () => {
      const game = await mapFromString(["WW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(1, 0);

      const astar = createAStar(game, src, dst);
      const result = astar.compute();
      expect(result).toBe(PathFindResultType.Completed);

      const path = astar.reconstructPath();
      expect(path).toBeDefined();
      expect(path[0]).toBe(src);
      expect(path[path.length - 1]).toBe(dst);
    });

    test("finds path across multiple tiles", async () => {
      const game = await mapFromString(["WWWWWW", "WWWWWW", "WWWWWW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(5, 2);

      const astar = createAStar(game, src, dst);
      expect(astar.compute()).toBe(PathFindResultType.Completed);

      const path = astar.reconstructPath();
      expect(path).toBeDefined();
      expect(path[0]).toBe(src);
      expect(path[path.length - 1]).toBe(dst);
    });

    test("finds path to the same tile", async () => {
      const game = await mapFromString(["WW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(0, 0);

      const astar = createAStar(game, src, dst);
      expect(astar.compute()).toBe(PathFindResultType.Completed);

      const path = astar.reconstructPath();
      expect(path[0]).toBe(src);
      expect(path[path.length - 1]).toBe(dst);
    });

    test("returns PathNotFound for blocked path", async () => {
      const game = await mapFromString(["WWLLWW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(5, 0);

      const astar = createAStar(game, src, dst);
      expect(astar.compute()).toBe(PathFindResultType.PathNotFound);
    });
  });

  describe("Error handling", () => {
    test("throws on invalid source ref", async () => {
      const game = await mapFromString(["WWWWWW", "WWWWWW"]);

      expect(() => {
        createAStar(game, -1 as TileRef, game.map().ref(2, 0));
      }).toThrow();
    });

    test("throws on invalid destination ref", async () => {
      const game = await mapFromString(["WWWWWW", "WWWWWW"]);

      expect(() => {
        createAStar(game, game.map().ref(2, 0), 9999 as TileRef);
      }).toThrow();
    });
  });

  describe("Bugs", () => {
    test.fails("path should not cross 1-tile land barrier", async () => {
      // Map upscaling "water if ANY tile is water" causes thin land barriers
      // to be invisible to water pathfinding (each 2x2 chunk still has water)

      const game = await mapFromString(["WLLWLWWLLW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(9, 0);

      const astar = createAStar(game, src, dst);
      expect(astar.compute()).toBe(PathFindResultType.PathNotFound);
    });

    test.fails("path should not cross diagonal land barrier", async () => {
      // Map upscaling "water if ANY tile is water" causes diagonal land barriers
      // to be invisible to water pathfinding (each 2x2 chunk still has water)

      const game = await mapFromString(["WL", "LW"]);
      const src = game.map().ref(0, 0);
      const dst = game.map().ref(1, 1);

      const astar = createAStar(game, src, dst);
      expect(astar.compute()).toBe(PathFindResultType.PathNotFound);
    });
  });
});
