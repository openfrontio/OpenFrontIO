import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import { TileSet } from "@openfront/engine-lib/game/TileSet";
import { describe, expect, it } from "vitest";

describe("GameMap BFS & bfsSearch", () => {
  // A 5x5 map:
  //  0  1  2  3  4
  //  5  6  7  8  9
  // 10 11 12 13 14
  // 15 16 17 18 19
  // 20 21 22 23 24
  const createMap = () => new GameMapImpl(5, 5, new Uint8Array(5 * 5), 0);

  it("visits nodes in non-decreasing Manhattan distance order (true BFS)", () => {
    const map = createMap();
    const start = 12; // Center
    const visited: number[] = [];

    map.bfsSearch(
      start,
      () => true,
      (tile) => {
        visited.push(tile);
      },
    );

    expect(visited[0]).toBe(start);
    expect(visited.length).toBe(25);

    // Verify distance monotonically non-decreasing
    let lastDist = 0;
    for (const tile of visited) {
      const dist = map.manhattanDist(start, tile);
      expect(dist).toBeGreaterThanOrEqual(lastDist);
      lastDist = dist;
    }

    // First ring (distance 1) must follow N, S, W, E cardinal order: 7, 17, 11, 13
    expect(visited.slice(1, 5)).toEqual([7, 17, 11, 13]);
  });

  it("aborts immediately when onVisit returns false", () => {
    const map = createMap();
    const visited: number[] = [];

    const result = map.bfsSearch(
      12,
      () => true,
      (tile) => {
        visited.push(tile);
        if (visited.length === 3) {
          return false; // abort after 3 tiles
        }
      },
    );

    expect(result).toBe(false);
    expect(visited.length).toBe(3);
    expect(visited).toEqual([12, 7, 17]);
  });

  it("returns true when traversal completes without early exit", () => {
    const map = createMap();
    let count = 0;

    const result = map.bfsSearch(
      12,
      () => true,
      () => {
        count++;
      },
    );

    expect(result).toBe(true);
    expect(count).toBe(25);
  });

  it("returns true without visiting if start fails filter", () => {
    const map = createMap();
    let visited = false;

    const result = map.bfsSearch(
      12,
      () => false,
      () => {
        visited = true;
      },
    );

    expect(result).toBe(true);
    expect(visited).toBe(false);
  });

  it("throws on re-entrant bfsSearch calls", () => {
    const map = createMap();

    expect(() => {
      map.bfsSearch(
        12,
        () => true,
        () => {
          // Re-entrant call on the same GameMap instance
          map.bfsSearch(0, () => true);
        },
      );
    }).toThrow("Re-entrant bfsSearch is not supported");
  });

  it("bfs returns a TileSet with all matching tiles", () => {
    const map = createMap();
    const tiles = map.bfs(12, (gm, t) => gm.manhattanDist(12, t) <= 1);

    expect(tiles).toBeInstanceOf(TileSet);
    expect(tiles.size).toBe(5);
    expect(tiles.has(12)).toBe(true);
    expect(tiles.has(7)).toBe(true);
    expect(tiles.has(17)).toBe(true);
    expect(tiles.has(11)).toBe(true);
    expect(tiles.has(13)).toBe(true);
    expect(tiles.has(0)).toBe(false);

    // Iterability test (ring 1)
    const arr = Array.from(tiles);
    expect(arr).toEqual([12, 7, 17, 11, 13]);

    // Multi-ring BFS order test (must be monotonic in Manhattan distance, not DFS)
    const allTiles = Array.from(map.bfs(12, () => true));
    expect(allTiles.length).toBe(25);
    let lastDist = 0;
    for (const tile of allTiles) {
      const dist = map.manhattanDist(12, tile);
      expect(dist).toBeGreaterThanOrEqual(lastDist);
      lastDist = dist;
    }
  });

  it("completes traversal and returns true when onVisit is omitted", () => {
    const map = createMap();
    const result = map.bfsSearch(12, () => true);
    expect(result).toBe(true);
  });

  it("handles 16-bit generation wrap-around correctly", () => {
    const map = createMap();
    // Warm up one search so bfsVisited buffer is initialized
    map.bfsSearch(12, () => true);

    // Simulate generation right before 0xffff
    (map as unknown as { bfsGen: number }).bfsGen = 0xffff - 1;

    // Run BFS which increments to 0xffff, triggers fill(0), and wraps to 1
    const visited1: number[] = [];
    map.bfsSearch(
      12,
      () => true,
      (t) => {
        visited1.push(t);
      },
    );
    expect(visited1.length).toBe(25);
    expect((map as unknown as { bfsGen: number }).bfsGen).toBe(1);

    // Run second BFS which advances to generation 2
    const visited2: number[] = [];
    map.bfsSearch(
      12,
      () => true,
      (t) => {
        visited2.push(t);
      },
    );
    expect(visited2.length).toBe(25);
    expect((map as unknown as { bfsGen: number }).bfsGen).toBe(2);
  });
});
