import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { closestTwoTiles } from "@openfront/engine/execution/Util";
import { Game } from "@openfront/engine/game/Game";
import { beforeEach, describe, expect, test } from "vitest";
import { setup } from "./util/Setup";

describe("closestTwoTiles", () => {
  let g: Game;
  let map: GameMap;

  beforeEach(async () => {
    g = await setup("plains", {}, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
    map = g.map();
  });

  function bruteForceClosestTwoTiles(
    gm: GameMap,
    x: Iterable<TileRef>,
    y: Iterable<TileRef>,
  ): { x: TileRef; y: TileRef } | null {
    const xArr = Array.from(x);
    const yArr = Array.from(y);
    if (xArr.length === 0 || yArr.length === 0) return null;

    let bestDist = Infinity;
    let bestPair: { x: TileRef; y: TileRef } | null = null;
    for (const tx of xArr) {
      for (const ty of yArr) {
        const d = gm.manhattanDist(tx, ty);
        if (d < bestDist) {
          bestDist = d;
          bestPair = { x: tx, y: ty };
        }
      }
    }
    return bestPair;
  }

  test("returns null when either set is empty", () => {
    const t = map.ref(5, 5);
    expect(closestTwoTiles(map, [], [t])).toBeNull();
    expect(closestTwoTiles(map, [t], [])).toBeNull();
    expect(closestTwoTiles(map, [], [])).toBeNull();
  });

  test("correctly finds closest pair when 1D pointer sweep would have failed", () => {
    // Set X: (5, 50), (6, 0)
    // Set Y: (4, 0), (50, 0)
    // Distance between (6, 0) and (4, 0) is 2.
    // The previous 1D pointer sweep compared (5, 50) with (4, 0) (dist 51),
    // then discarded (4, 0) permanently because 5 >= 4, returning (6, 0) & (50, 0) (dist 44).
    const x1 = map.ref(5, 50);
    const x2 = map.ref(6, 0);
    const y1 = map.ref(4, 0);
    const y2 = map.ref(50, 0);

    const result = closestTwoTiles(map, [x1, x2], [y1, y2]);
    expect(result).not.toBeNull();
    expect(result!.x).toBe(x2);
    expect(result!.y).toBe(y1);
    expect(map.manhattanDist(result!.x, result!.y)).toBe(2);
  });

  test("matches brute force on arbitrary random sets", () => {
    const rand = new PseudoRandom(98765);
    const w = map.width();
    const h = map.height();

    for (let trial = 0; trial < 20; trial++) {
      const setX: TileRef[] = [];
      const setY: TileRef[] = [];

      const sizeX = rand.nextInt(1, 40);
      const sizeY = rand.nextInt(1, 40);

      for (let i = 0; i < sizeX; i++) {
        setX.push(map.ref(rand.nextInt(0, w), rand.nextInt(0, h)));
      }
      for (let i = 0; i < sizeY; i++) {
        setY.push(map.ref(rand.nextInt(0, w), rand.nextInt(0, h)));
      }

      const expected = bruteForceClosestTwoTiles(map, setX, setY);
      const actual = closestTwoTiles(map, setX, setY);

      expect(actual).not.toBeNull();
      const actualDist = map.manhattanDist(actual!.x, actual!.y);
      const expectedDist = map.manhattanDist(expected!.x, expected!.y);
      expect(actualDist).toBe(expectedDist);
    }
  });

  test("handles single element sets", () => {
    const t1 = map.ref(10, 20);
    const t2 = map.ref(15, 25);
    const result = closestTwoTiles(map, [t1], [t2]);
    expect(result).toEqual({ x: t1, y: t2 });
  });

  test("handles overlapping tiles (distance 0)", () => {
    const tShared = map.ref(12, 18);
    const tX = map.ref(10, 10);
    const tY = map.ref(20, 20);

    const result = closestTwoTiles(map, [tX, tShared], [tY, tShared]);
    expect(result).not.toBeNull();
    expect(map.manhattanDist(result!.x, result!.y)).toBe(0);
  });
});
