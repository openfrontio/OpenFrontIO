import { beforeAll, describe, expect, it, vi } from "vitest";
import { Game } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import {
  PathStatus,
  SteppingPathFinder,
} from "../../../src/core/pathfinding/types";
import { setup } from "../../util/Setup";
import { createGame, L, W } from "./_fixtures";

describe("PathFinding.Water", () => {
  let game: Game;
  let worldGame: Game;

  function createPathFinder(g: Game = game): SteppingPathFinder<TileRef> {
    return PathFinding.Water(g);
  }

  beforeAll(async () => {
    game = await setup("ocean_and_land");
    worldGame = await setup("world", { disableNavMesh: false });
  });

  describe("findPath", () => {
    it("finds path between adjacent water tiles", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const from = map.ref(8, 0);
      const to = map.ref(9, 0);

      expect(map.isWater(from)).toBe(true);
      expect(map.isWater(to)).toBe(true);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
      expect(path![0]).toBe(from);
      expect(path![1]).toBe(to);
    });

    it("returns null for land tiles", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const landTile = map.ref(0, 0);
      const waterTile = map.ref(8, 0);

      expect(map.isLand(landTile)).toBe(true);
      expect(map.isShore(landTile)).toBe(false);
      expect(map.isWater(waterTile)).toBe(true);

      const path = pathFinder.findPath(landTile, waterTile);

      expect(path).toBeNull();
    });

    it("returns single-tile path when from equals to", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const waterTile = map.ref(8, 0);
      expect(map.isWater(waterTile)).toBe(true);

      const path = pathFinder.findPath(waterTile, waterTile);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(1);
      expect(path![0]).toBe(waterTile);
    });

    it("supports multiple start tiles", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      const dest = map.ref(8, 0);
      const source1 = map.ref(9, 0);
      const source2 = map.ref(8, 1);

      expect(map.isWater(dest)).toBe(true);
      expect(map.isWater(source1)).toBe(true);
      expect(map.isWater(source2)).toBe(true);

      const from = [source1, source2];
      const path = pathFinder.findPath(from, dest);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(2);
      expect(from).toContain(path![0]);
      expect(path![1]).toBe(dest);
    });
  });

  describe("path validity", () => {
    it("all consecutive tiles in path are connected", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Distant water tiles: (8,0) → (15,4), distance = 11
      const from = map.ref(8, 0);
      const to = map.ref(15, 4);

      expect(map.isWater(from)).toBe(true);
      expect(map.isWater(to)).toBe(true);
      expect(map.manhattanDist(from, to)).toBe(11);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();

      for (let i = 1; i < path!.length; i++) {
        const dist = map.manhattanDist(path![i - 1], path![i]);
        expect(dist).toEqual(1);
      }
    });
  });

  describe("shore handling", () => {
    it("path from shore to shore starts and ends on shore", () => {
      const pathFinder = createPathFinder();
      const map = game.map();

      // Shore tiles at (7,0) and (7,6), distance = 6
      // Both have water neighbors at (8,0) and (8,6)
      const from = map.ref(7, 0);
      const to = map.ref(7, 6);

      expect(map.isShore(from)).toBe(true);
      expect(map.isShore(to)).toBe(true);
      expect(map.manhattanDist(from, to)).toBe(6);

      const path = pathFinder.findPath(from, to);

      expect(path).not.toBeNull();
      expect(path![0]).toBe(from);
      expect(path![path!.length - 1]).toBe(to);
    });
  });

  describe("determinism", () => {
    it("same inputs produce identical paths", () => {
      const pathFinder1 = createPathFinder();
      const pathFinder2 = createPathFinder();
      const map = game.map();

      // Distant water tiles: (8,0) → (15,4)
      const from = map.ref(8, 0);
      const to = map.ref(15, 4);

      const path1 = pathFinder1.findPath(from, to);
      const path2 = pathFinder2.findPath(from, to);

      expect(path1).not.toBeNull();
      expect(path2).not.toBeNull();
      expect(path1).toEqual(path2);
    });
  });

  describe("World map routes", () => {
    it("Spain to France (Mediterranean)", () => {
      const pathFinder = createPathFinder(worldGame);
      const path = pathFinder.findPath(
        worldGame.ref(926, 283),
        worldGame.ref(950, 257),
      );
      expect(path).not.toBeNull();
    });

    it("Miami to Rio (Atlantic)", () => {
      const pathFinder = createPathFinder(worldGame);
      const path = pathFinder.findPath(
        worldGame.ref(488, 355),
        worldGame.ref(680, 658),
      );
      expect(path).not.toBeNull();
    });

    it("France to Poland (around Europe)", () => {
      const pathFinder = createPathFinder(worldGame);
      const path = pathFinder.findPath(
        worldGame.ref(950, 257),
        worldGame.ref(1033, 175),
      );
      expect(path).not.toBeNull();
    });

    it("Miami to Spain (transatlantic)", () => {
      const pathFinder = createPathFinder(worldGame);
      const path = pathFinder.findPath(
        worldGame.ref(488, 355),
        worldGame.ref(926, 283),
      );
      expect(path).not.toBeNull();
    });

    it("Rio to Poland (South Atlantic to Baltic)", () => {
      const pathFinder = createPathFinder(worldGame);
      const path = pathFinder.findPath(
        worldGame.ref(680, 658),
        worldGame.ref(1033, 175),
      );
      expect(path).not.toBeNull();
    });
  });

  describe("Error handling", () => {
    it("returns NOT_FOUND for null source", () => {
      const pathFinder = createPathFinder();

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = pathFinder.next(
        null as unknown as TileRef,
        game.ref(8, 0),
      );

      expect(result.status).toBe(PathStatus.NOT_FOUND);

      consoleSpy.mockRestore();
    });

    it("returns NOT_FOUND for null destination", () => {
      const pathFinder = createPathFinder();

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const result = pathFinder.next(
        game.ref(8, 0),
        null as unknown as TileRef,
      );

      expect(result.status).toBe(PathStatus.NOT_FOUND);

      consoleSpy.mockRestore();
    });
  });

  describe("Known bugs", () => {
    it("path can cross 1-tile land barrier", () => {
      const syntheticGame = createGame({
        width: 10,
        height: 1,
        grid: [W, L, L, W, L, W, W, L, L, W],
      });

      const pathFinder = createPathFinder(syntheticGame);
      const path = pathFinder.findPath(
        syntheticGame.ref(0, 0),
        syntheticGame.ref(9, 0),
      );

      expect(path).not.toBeNull();
    });

    it("path can cross diagonal land barrier", () => {
      const syntheticGame = createGame({
        width: 2,
        height: 2,
        grid: [W, L, L, W],
      });

      const pathFinder = createPathFinder(syntheticGame);
      const path = pathFinder.findPath(
        syntheticGame.ref(0, 0),
        syntheticGame.ref(1, 1),
      );

      expect(path).not.toBeNull();
    });
  });
});
