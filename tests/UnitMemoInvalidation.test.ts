import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { WaterPathFinder } from "../src/core/pathfinding/PathFinder";
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

// The memoised trade-ship pathfinder must answer exactly like a fresh query at
// every moment across a REAL water conversion (queueWaterConversion -> the
// WaterManager tick), including the up-to-20-tick window before the throttled
// water-graph rebuild — a cached null must not outlive a component merge.
describe("water-path memo across a real water conversion", () => {
  test("memoized pathfinder always answers like a fresh one; the merge is eventually found", async () => {
    const g = await setup("half_land_half_ocean", { waterNukes: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
    const map = g.map();
    const all: TileRef[] = [];
    map.forEachTile((t) => all.push(t));
    const ocean = all.filter((t) => map.isOcean(t) && map.isWater(t));
    const convertible = (t: TileRef) =>
      map.isLand(t) && !map.isImpassable(t) && !g.hasOwner(t);
    // the land tile farthest from the ocean becomes a one-tile lake ...
    const oceanDist = (t: TileRef) =>
      Math.min(...ocean.map((o) => map.manhattanDist(o, t)));
    const land = all.filter(convertible);
    const lakeSeed = land.reduce((a, b) =>
      oceanDist(a) >= oceanDist(b) ? a : b,
    );
    g.queueWaterConversion(lakeSeed);
    g.executeNextTick();
    expect(map.isWater(lakeSeed)).toBe(true);

    const memoized = new WaterPathFinder(g, 0, true);
    const fresh = new WaterPathFinder(g, 0, false);
    const far = ocean.reduce((a, b) =>
      map.manhattanDist(a, lakeSeed) >= map.manhattanDist(b, lakeSeed) ? a : b,
    );
    // warm the memo while the lake is landlocked: no path
    expect(memoized.findPath(far, lakeSeed)).toBeNull();

    // ... then the whole land half floods, merging the lake into the ocean
    // (a thin corridor is not enough: the hierarchical pathfinder plans on the
    // quarter-resolution minimap, whose cells only flip with area coverage)
    for (const t of all) if (convertible(t)) g.queueWaterConversion(t);
    for (let tick = 0; tick < 25; tick++) {
      g.executeNextTick();
      expect(memoized.findPath(far, lakeSeed)).toEqual(
        fresh.findPath(far, lakeSeed),
      );
    }
    expect(memoized.findPath(far, lakeSeed)).not.toBeNull();
  });
});

// validStructureSpawnTiles() through its public entry (canBuild -> landBased-
// StructureSpawn): the flood over connected owned tiles, the min-distance
// exclusion around existing structures, and deterministic tie ordering.
describe("structure spawn tile selection", () => {
  let g: Game;
  let p: Player;
  beforeEach(async () => {
    g = await setup("plains", { infiniteGold: true, instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
    ]);
    p = g.player("p1");
  });

  test("an unowned target has no spawn tiles", () => {
    expect(p.canBuild(UnitType.City, g.ref(3, 3))).toBe(false);
  });

  test("the target itself wins while it is valid; disconnected tiles are never candidates", () => {
    for (let x = 3; x <= 9; x++) p.conquer(g.ref(x, 5));
    p.conquer(g.ref(20, 5)); // disconnected from the strip
    expect(p.canBuild(UnitType.City, g.ref(5, 5))).toBe(g.ref(5, 5));
    // a disconnected own tile cannot host a spawn for this target
    expect(p.canBuild(UnitType.City, g.ref(20, 5))).toBe(g.ref(20, 5)); // (its own flood)
  });

  test("tiles within structureMinDist of an existing structure are excluded", () => {
    const minDist = g.config().structureMinDist(); // 15
    const y = 20;
    for (let x = 0; x <= 28; x++) p.conquer(g.ref(x, y));
    p.buildUnit(UnitType.City, g.ref(5, y), {});
    const spawn = p.canBuild(UnitType.City, g.ref(14, y));
    // x 15..19 are inside minDist of the city; (20, y) is the first tile at
    // exactly minDist (the check is strict <) and the closest valid to the target
    expect(spawn).toBe(g.ref(20, y));
  });

  test("equal-distance candidates resolve in traversal order, deterministically", () => {
    // Two cities blanket the whole east-west strip, so the only valid tiles sit
    // on the north/south arms — the nearest of each tie at the same distance.
    const y = 20;
    for (let x = 0; x <= 28; x++) p.conquer(g.ref(x, y));
    for (let dy = 1; dy <= 13; dy++) {
      p.conquer(g.ref(14, y - dy));
      p.conquer(g.ref(14, y + dy));
    }
    p.buildUnit(UnitType.City, g.ref(5, y), {});
    p.buildUnit(UnitType.City, g.ref(23, y), {});
    const spawn = p.canBuild(UnitType.City, g.ref(14, y));
    // valid ⇔ ≥ minDist from both cities: on the arms that is |dy| ≥ 12
    // ((14-5)² + 12² = 225); north and south tie at distance 12
    expect([g.ref(14, y - 12), g.ref(14, y + 12)]).toContain(spawn);
    // pin the traversal-order winner so a refactor that changes the flood
    // order (GameMap.bfs stack, N/S/W/E pushes) fails loudly here
    expect(spawn).toBe(g.ref(14, y + 12));
  });
});
