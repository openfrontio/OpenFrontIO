import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
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
