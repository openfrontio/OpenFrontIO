import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { WaterPathMemo } from "../src/core/pathfinding/PathFinder";
import { setup } from "./util/Setup";

let game: Game;
let p1: Player;
let p2: Player;

// Regression tests for the memoised per-type unit queries (units(type),
// unitCount(), unitsOwned(), Game.unitCount()) and the waterVersion()
// counter: every mutation that can change an answer must invalidate.
describe("unit memo invalidation", () => {
  beforeEach(async () => {
    game = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
    ]);
    p1 = game.player("p1");
    p2 = game.player("p2");
    p1.conquer(game.ref(0, 0));
    p2.conquer(game.ref(10, 10));
  });

  test("build and delete move all counts", () => {
    expect(p1.unitCount(UnitType.City)).toBe(0);
    expect(game.unitCount(UnitType.City)).toBe(0);
    const city = p1.buildUnit(UnitType.City, game.ref(0, 0), {});
    expect(p1.unitCount(UnitType.City)).toBe(1);
    expect(p1.unitsOwned(UnitType.City)).toBe(1);
    expect(p1.units(UnitType.City)).toEqual([city]);
    expect(game.unitCount(UnitType.City)).toBe(1);
    city.delete(false);
    expect(p1.unitCount(UnitType.City)).toBe(0);
    expect(p1.units(UnitType.City)).toEqual([]);
    expect(game.unitCount(UnitType.City)).toBe(0);
  });

  test("level changes move the level-weighted counts, both directions", () => {
    const city = p1.buildUnit(UnitType.City, game.ref(0, 0), {});
    expect(p1.unitCount(UnitType.City)).toBe(1);
    city.increaseLevel();
    expect(city.level()).toBe(2);
    expect(p1.unitCount(UnitType.City)).toBe(2);
    expect(p1.unitsOwned(UnitType.City)).toBe(2);
    expect(game.unitCount(UnitType.City)).toBe(2);
    city.decreaseLevel(); // non-terminal: unit stays active at level 1
    expect(city.isActive()).toBe(true);
    expect(p1.unitCount(UnitType.City)).toBe(1);
    expect(p1.unitsOwned(UnitType.City)).toBe(1);
    expect(game.unitCount(UnitType.City)).toBe(1);
    city.decreaseLevel(); // terminal: level 0 deletes the unit
    expect(p1.unitCount(UnitType.City)).toBe(0);
    expect(game.unitCount(UnitType.City)).toBe(0);
  });

  test("capture moves the counts between players", () => {
    const port = p1.buildUnit(UnitType.Port, game.ref(0, 0), {});
    expect(p1.unitCount(UnitType.Port)).toBe(1);
    expect(p2.unitCount(UnitType.Port)).toBe(0);
    port.setOwner(p2);
    expect(p1.unitCount(UnitType.Port)).toBe(0);
    expect(p1.units(UnitType.Port)).toEqual([]);
    expect(p2.unitCount(UnitType.Port)).toBe(1);
    expect(p2.units(UnitType.Port)).toEqual([port]);
    expect(game.unitCount(UnitType.Port)).toBe(1);
  });

  test("under-construction toggle moves unitsOwned", () => {
    const city = p1.buildUnit(UnitType.City, game.ref(0, 0), {});
    city.increaseLevel();
    expect(p1.unitsOwned(UnitType.City)).toBe(2); // level-weighted while active
    city.setUnderConstruction(true);
    expect(p1.unitsOwned(UnitType.City)).toBe(1); // construction counts once
    city.setUnderConstruction(false);
    expect(p1.unitsOwned(UnitType.City)).toBe(2);
  });

  test("units(type) hands out a copy, not the memo", () => {
    p1.buildUnit(UnitType.City, game.ref(0, 0), {});
    const a = p1.units(UnitType.City);
    a.length = 0; // caller mutates its copy
    expect(p1.units(UnitType.City)).toHaveLength(1);
  });
});

describe("waterVersion invalidation", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
  });

  test("setWater bumps; a no-op setWater does not", () => {
    const land = game.ref(1, 1);
    const v0 = game.map().waterVersion();
    game.map().setWater(land);
    expect(game.map().waterVersion()).toBe(v0 + 1);
    game.map().setWater(land); // already water: ignored
    expect(game.map().waterVersion()).toBe(v0 + 1);
  });

  test("a packed updateTile that flips land to water bumps like setWater", () => {
    const land = game.ref(2, 2);
    expect(game.map().isLand(land)).toBe(true);
    const state = game.map().tileStateBuffer()[land];
    const v0 = game.map().waterVersion();
    // terrain byte 0 = lake water (no land bit)
    expect(game.map().updateTile(land, state)).toBe(true);
    expect(game.map().isLand(land)).toBe(false);
    expect(game.map().waterVersion()).toBe(v0 + 1);
    // flip it back to the original land byte: also a water-set change
    const original = game.ref(3, 3);
    const landByte = game.map().terrainByte(original);
    expect(game.map().updateTile(land, ((landByte << 16) | state) >>> 0)).toBe(
      true,
    );
    expect(game.map().waterVersion()).toBe(v0 + 2);
  });
});

// WaterManager floods land through the raw GameMap (setWater), bypassing the
// GameImpl wrappers that bump territoryVersion — the memoised nearby() must
// still see it (it keys on the map's waterVersion() as well).
describe("nearby() invalidation on raw water conversion", () => {
  const names = (r: readonly unknown[]) =>
    r.map((o) => ((o as Player).isPlayer() ? (o as Player).name() : "TN"));

  async function flooded(warmMemo: boolean): Promise<{
    before: string[] | null;
    after: string[];
  }> {
    const g = await setup("plains", {}, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
    const p = g.player("p1");
    p.conquer(g.ref(0, 0));
    const before = warmMemo ? names(p.nearby()) : null;
    for (let x = 0; x <= 6; x++) {
      for (let y = 0; y <= 6; y++) {
        const t = g.ref(x, y);
        if ((x !== 0 || y !== 0) && g.map().isLand(t)) g.map().setWater(t);
      }
    }
    return { before, after: names(p.nearby()) };
  }

  test("a warmed memo answers like a cold one after the flood", async () => {
    const cold = await flooded(false);
    const warm = await flooded(true);
    // the flood must actually change the answer, or this test proves nothing
    expect(warm.after).not.toEqual(warm.before);
    expect(warm.after).toEqual(cold.after);
  });
});

describe("WaterPathMemo", () => {
  function build() {
    const calls: Array<[TileRef, TileRef]> = [];
    let answer: number[] | null = null;
    const inner = {
      findPath: (from: TileRef | TileRef[], to: TileRef) => {
        calls.push([from as TileRef, to]);
        return answer === null ? null : [...answer];
      },
    };
    let waterVersion = 0;
    const memo = new WaterPathMemo(inner, 1000, () => waterVersion);
    return {
      memo,
      calls,
      setAnswer: (a: number[] | null) => (answer = a),
      convert: () => waterVersion++,
    };
  }

  test("caches results, including null", () => {
    const { memo, calls, setAnswer } = build();
    setAnswer(null);
    expect(memo.findPath(1, 2)).toBeNull();
    expect(memo.findPath(1, 2)).toBeNull();
    expect(calls).toHaveLength(1);
    setAnswer([3, 4]);
    expect(memo.findPath(3, 4)).toEqual([3, 4]);
    expect(memo.findPath(3, 4)).toEqual([3, 4]);
    expect(calls).toHaveLength(2);
  });

  test("a water conversion drops the cache — a stale null cannot outlive a component merge", () => {
    const { memo, calls, setAnswer, convert } = build();
    setAnswer(null);
    expect(memo.findPath(1, 2)).toBeNull(); // ports on separate components
    convert(); // nuke floods a corridor; components merge
    setAnswer([1, 9, 2]);
    expect(memo.findPath(1, 2)).toEqual([1, 9, 2]); // answered live, like the un-memoised chain
    expect(calls).toHaveLength(2);
  });

  test("hands out copies, not the stored path", () => {
    const { memo, setAnswer } = build();
    setAnswer([5, 6]);
    const a = memo.findPath(5, 6)!;
    a.push(99);
    expect(memo.findPath(5, 6)).toEqual([5, 6]);
  });
});
