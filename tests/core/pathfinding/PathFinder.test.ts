import { describe, test, expect, beforeAll, vi } from "vitest";
import { MiniAStarAdapter } from "../../../src/core/pathfinding/adapters/MiniAStarAdapter";
import { NavMeshAdapter } from "../../../src/core/pathfinding/adapters/NavMeshAdapter";
import { PathFinder, PathStatus } from "../../../src/core/pathfinding/PathFinder";
import { Game } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { gameFromString } from "./utils";
import { setup } from "../../util/Setup";

type AdapterFactory = {
  name: string;
  create: (game: Game) => PathFinder;
};

const adapters: AdapterFactory[] = [
  {
    name: "MiniAStarAdapter",
    create: (game) => new MiniAStarAdapter(game, { waterPath: true }),
  },
  {
    name: "NavMeshAdapter",
    create: (game) => new NavMeshAdapter(game),
  },
];

// Shared world game instance
let worldGame: Game;

beforeAll(async () => {
  worldGame = await setup("world", { disableNavMesh: false });
});

describe.each(adapters)("$name", ({ create }) => {
  describe("findPath()", () => {
    test("finds path between adjacent tiles", async () => {
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(1, 0);

      const path = adapter.findPath(src, dst);

      expect(path).not.toBeNull();
      expect(path![0]).toBe(src);
      expect(path![path!.length - 1]).toBe(dst);
    });

    test("finds path across multiple tiles", async () => {
      const game = await gameFromString(["WWWWWW", "WWWWWW", "WWWWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(5, 2);

      const path = adapter.findPath(src, dst);

      expect(path).not.toBeNull();
      expect(path![0]).toBe(src);
      expect(path![path!.length - 1]).toBe(dst);
    });

    test("returns single-element path for same tile", async () => {
      // Old quirk of MiniAStar, we return dst tile twice
      // Should probably be fixed to return [] instead

      const game = await gameFromString(["WW"]);
      const adapter = create(game);
      const tile = game.ref(0, 0);

      const path = adapter.findPath(tile, tile);

      expect(path).not.toBeNull();
      expect(path!.length).toBe(1);
      expect(path![0]).toBe(tile);
    });

    test("returns null for blocked path", async () => {
      const game = await gameFromString(["WWLLWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(5, 0);

      const path = adapter.findPath(src, dst);

      expect(path).toBeNull();
    });

    test("returns null for water to land", () => {
      const adapter = create(worldGame);
      const src = worldGame.ref(926, 283); // water
      const dst = worldGame.ref(950, 230); // land

      const path = adapter.findPath(src, dst);

      expect(path).toBeNull();
    });

    test("traverses 3-tile path in 3 tiles", async () => {
      // Expected: [1, 2, 3]
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(3, 0);

      const path = adapter.findPath(src, dst);

      expect(path).not.toBeNull();
      expect(path).toEqual([game.ref(0, 0), game.ref(1, 0), game.ref(2, 0), game.ref(3, 0)]);
    });
  });

  describe("next() state machine", () => {
    test("returns NEXT on first call", async () => {
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(3, 0);

      const result = adapter.next(src, dst);

      expect(result.status).toBe(PathStatus.NEXT);
    });

    test("returns COMPLETE when at destination", async () => {
      const game = await gameFromString(["WW"]);
      const adapter = create(game);
      const tile = game.ref(0, 0);

      const result = adapter.next(tile, tile);

      expect(result.status).toBe(PathStatus.COMPLETE);
    });

    test("returns NOT_FOUND for blocked path", async () => {
      const game = await gameFromString(["WWLLWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(5, 0);

      const result = adapter.next(src, dst);

      expect(result.status).toBe(PathStatus.NOT_FOUND);
    });

    test("traverses 3-tile path in 4 calls", async () => {
      // Expected: NEXT(1) -> NEXT(2) -> NEXT(3) -> COMPLETE(4)
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst = game.ref(3, 0);

      let current = src;
      const steps: string[] = [];

      // 3 NEXT calls to reach destination
      for (let i = 1; i <= 4; i++) {
        const result = adapter.next(current, dst);
        expect(result.status).toBeOneOf([PathStatus.NEXT, PathStatus.COMPLETE]);

        current = (result as { node: TileRef }).node;
        steps.push(`${PathStatus[result.status]}(${current})`);
      }

      expect(steps).toEqual(["NEXT(1)", "NEXT(2)", "NEXT(3)", "COMPLETE(3)"]);
    });
  });

  describe("Destination changes", () => {
    test("reaches new destination when dest changes", async () => {
      const game = await gameFromString(["WWWWWWWW"]); // 8 wide
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst1 = game.ref(4, 0);
      const dst2 = game.ref(7, 0);

      // First path exists
      expect(adapter.findPath(src, dst1)).not.toBeNull();

      // Can still find path to new destination
      expect(adapter.findPath(dst1, dst2)).not.toBeNull();
    });

    test("recomputes when destination changes mid-path", async () => {
      const game = await gameFromString(["WWWWWWWWWWWWWWWWWWWW"]); // 20 wide
      const adapter = create(game);
      const src = game.ref(0, 0);
      const dst1 = game.ref(10, 0);
      const dst2 = game.ref(19, 0);

      // Start pathing to dst1, take one step
      const result1 = adapter.next(src, dst1);
      expect(result1.status).toBe(PathStatus.NEXT);

      // Change destination mid-path, continue from current position
      let current = (result1 as { node: TileRef }).node;
      let result = adapter.next(current, dst2);
      for (let i = 0; i < 100 && result.status === PathStatus.NEXT; i++) {
        current = (result as { node: TileRef }).node;
        result = adapter.next(current, dst2);
      }

      expect(result.status).toBe(PathStatus.COMPLETE);
      expect(current).toBe(dst2);
    });
  });

  describe("Error handling", () => {
    // MiniAStar logs conosle error when nulls passed, muted in test

    test("returns NOT_FOUND for null source", async () => {
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const dst = game.ref(0, 0);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = adapter.next(null as unknown as TileRef, dst);
      expect(result.status).toBe(PathStatus.NOT_FOUND);
      consoleSpy.mockRestore();
    });

    test("returns NOT_FOUND for null destination", async () => {
      const game = await gameFromString(["WWWW"]);
      const adapter = create(game);
      const src = game.ref(0, 0);

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const result = adapter.next(src, null as unknown as TileRef);
      expect(result.status).toBe(PathStatus.NOT_FOUND);
      consoleSpy.mockRestore();
    });
  });

  describe("dist parameter", () => {
    test("returns COMPLETE when within dist", () => {
      const adapter = create(worldGame);
      const src = worldGame.ref(926, 283);
      const dst = worldGame.ref(928, 283); // 2 tiles away

      const result = adapter.next(src, dst, 5);

      expect(result.status).toBe(PathStatus.COMPLETE);
    });

    test("returns NEXT when beyond dist", () => {
      const adapter = create(worldGame);
      const src = worldGame.ref(926, 283);
      const dst = worldGame.ref(950, 257);

      // Adapter may need a few ticks to compute path
      let result = adapter.next(src, dst, 5);
      for (let i = 0; i < 100 && result.status === PathStatus.PENDING; i++) {
        result = adapter.next(src, dst, 5);
      }

      expect(result.status).toBe(PathStatus.NEXT);
    });
  });

  describe("World map routes", () => {
    test("Spain to France (Mediterranean)", () => {
      const adapter = create(worldGame);
      const path = adapter.findPath(worldGame.ref(926, 283), worldGame.ref(950, 257));
      expect(path).not.toBeNull();
    });

    test("Miami to Rio (Atlantic)", () => {
      const adapter = create(worldGame);
      const path = adapter.findPath(worldGame.ref(488, 355), worldGame.ref(680, 658));
      expect(path).not.toBeNull();
      expect(path!.length).toBeGreaterThan(100);
    });

    test("France to Poland (around Europe)", () => {
      const adapter = create(worldGame);
      const path = adapter.findPath(worldGame.ref(950, 257), worldGame.ref(1033, 175));
      expect(path).not.toBeNull();
    });

    test("Miami to Spain (transatlantic)", () => {
      const adapter = create(worldGame);
      const path = adapter.findPath(worldGame.ref(488, 355), worldGame.ref(926, 283));
      expect(path).not.toBeNull();
    });

    test("Rio to Poland (South Atlantic to Baltic)", () => {
      const adapter = create(worldGame);
      const path = adapter.findPath(worldGame.ref(680, 658), worldGame.ref(1033, 175));
      expect(path).not.toBeNull();
    });
  });

  describe("Known bugs", () => {
    test("path can cross 1-tile land barrier", async () => {
      const game = await gameFromString(["WLLWLWWLLW"]);
      const adapter = new MiniAStarAdapter(game, { waterPath: true });
      const path = adapter.findPath(game.ref(0, 0), game.ref(9, 0));
      expect(path).not.toBeNull();
    });

    test("path can cross diagonal land barrier", async () => {
      const game = await gameFromString(["WL", "LW"]);
      const adapter = new MiniAStarAdapter(game, { waterPath: true });
      const path = adapter.findPath(game.ref(0, 0), game.ref(1, 1));
      expect(path).not.toBeNull();
    });
  });
});
