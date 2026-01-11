import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import { SteppingPathFinder } from "../../../src/core/pathfinding/types";
import { setup } from "../../util/Setup";

describe("PathFinding.Air", () => {
  let game: Game;

  function createPathFinder(): SteppingPathFinder<TileRef> {
    return PathFinding.Air(game);
  }

  beforeAll(async () => {
    game = await setup("ocean_and_land");
  });

  describe("findPath", () => {
    it("returns path between any two points (ignores terrain)", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Air pathfinder ignores terrain, so can go anywhere
      // (2,2) → (14,14): manhattan = 24, path length = 25
      const from = map.ref(2, 2);
      const to = map.ref(14, 14);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(25);
      expect(path![0]).toBe(from);
      expect(path![path!.length - 1]).toBe(to);
    });

    it("throws error for multiple start points", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const from = [map.ref(2, 2), map.ref(4, 4)];
      const to = map.ref(14, 14);

      expect(() => pathFinder.findPath(from, to)).toThrow(
        "does not support multiple start points",
      );
    });

    it("returns single-tile path when from equals to", () => {
      const pathFinder = createPathFinder();
      const map = game.map();
      const tile = map.ref(8, 8);

      const path = pathFinder.findPath(tile, tile);

      expect(path).not.toBeNull();
      expect(path![0]).toBe(tile);
    });
  });

  describe("path validity", () => {
    it("all consecutive tiles in path are adjacent (Manhattan distance 1)", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // (2,2) → (14,14): manhattan = 24, path length = 25
      const from = map.ref(2, 2);
      const to = map.ref(14, 14);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(25);

      // Verify every consecutive pair is adjacent
      for (let i = 1; i < path!.length; i++) {
        const dist = map.manhattanDist(path![i - 1], path![i]);
        expect(dist).toBe(1);
      }
    });

    it("path ends at exact destination", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const from = map.ref(5, 5);
      const to = map.ref(10, 12);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path![path!.length - 1]).toBe(to);
    });
  });

  describe("path shapes", () => {
    it("diagonal path has equal X and Y movement", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Equal X and Y offset: (0,0) → (10,10)
      const from = map.ref(0, 0);
      const to = map.ref(10, 10);

      const path = pathFinder.findPath(from, to);
      expect(path).not.toBeNull();

      let xMoves = 0;
      let yMoves = 0;
      for (let i = 1; i < path!.length; i++) {
        const dx = map.x(path![i]) - map.x(path![i - 1]);
        const dy = map.y(path![i]) - map.y(path![i - 1]);
        if (dx !== 0) xMoves++;
        if (dy !== 0) yMoves++;
      }

      expect(xMoves).toBe(10);
      expect(yMoves).toBe(10);
    });

    it("horizontal path has only X movement", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Pure horizontal: (0,5) → (15,5)
      const from = map.ref(0, 5);
      const to = map.ref(15, 5);

      const path = pathFinder.findPath(from, to);
      expect(path).not.toBeNull();

      let xMoves = 0;
      let yMoves = 0;
      for (let i = 1; i < path!.length; i++) {
        const dx = map.x(path![i]) - map.x(path![i - 1]);
        const dy = map.y(path![i]) - map.y(path![i - 1]);
        if (dx !== 0) xMoves++;
        if (dy !== 0) yMoves++;
      }

      expect(xMoves).toBe(15);
      expect(yMoves).toBe(0);
    });

    it("vertical path has only Y movement", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Pure vertical: (5,0) → (5,15)
      const from = map.ref(5, 0);
      const to = map.ref(5, 15);

      const path = pathFinder.findPath(from, to);
      expect(path).not.toBeNull();

      let xMoves = 0;
      let yMoves = 0;
      for (let i = 1; i < path!.length; i++) {
        const dx = map.x(path![i]) - map.x(path![i - 1]);
        const dy = map.y(path![i]) - map.y(path![i - 1]);
        if (dx !== 0) xMoves++;
        if (dy !== 0) yMoves++;
      }

      expect(xMoves).toBe(0);
      expect(yMoves).toBe(15);
    });

    it("adjacent tiles produce minimal path", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const from = map.ref(5, 5);
      const to = map.ref(6, 5);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
      expect(path![0]).toBe(from);
      expect(path![1]).toBe(to);
    });
  });
});
