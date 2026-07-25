import { GameMapImpl } from "../src/core/game/GameMap";
import {
  decodeRegionRaster,
  RegionMap,
  RegionTracker,
} from "../src/core/game/RegionMap";

const LAND = 0x80 | 1; // land, plains magnitude
const WATER = 0x00;
const IMPASSABLE = 0x80 | 31;

/** 4x2 map: row 0 = land land water land; row 1 = land impassable land land */
function smallMap(): GameMapImpl {
  const terrain = new Uint8Array([
    LAND,
    LAND,
    WATER,
    LAND,
    LAND,
    IMPASSABLE,
    LAND,
    LAND,
  ]);
  return new GameMapImpl(4, 2, terrain, 7);
}

describe("decodeRegionRaster", () => {
  test("little-endian round trip", () => {
    const bytes = new Uint8Array([0x01, 0x00, 0x34, 0x12]);
    const out = decodeRegionRaster(bytes);
    expect([...out]).toEqual([1, 0x1234]);
  });

  test("odd byte length throws", () => {
    expect(() => decodeRegionRaster(new Uint8Array(3))).toThrow();
  });
});

describe("RegionMap", () => {
  test("raster length must match map dimensions", () => {
    expect(() => new RegionMap(new Uint16Array(7), smallMap())).toThrow();
  });

  test("ids on water and impassable tiles are cleared", () => {
    const raster = new Uint16Array([1, 1, 1, 2, 1, 1, 2, 2]);
    const rm = new RegionMap(raster, smallMap());
    expect(rm.regionId(2)).toBe(0); // water
    expect(rm.regionId(5)).toBe(0); // impassable
    expect(rm.regionId(0)).toBe(1);
    expect(rm.regionId(3)).toBe(2);
  });

  test("regionLandTiles counts only ownable tiles", () => {
    const raster = new Uint16Array([1, 1, 1, 2, 1, 1, 2, 2]);
    const rm = new RegionMap(raster, smallMap());
    // Region 1 ownable: tiles 0, 1, 4 (2 is water, 5 impassable).
    expect(rm.regionLandTiles(1)).toBe(3);
    expect(rm.regionLandTiles(2)).toBe(3); // tiles 3, 6, 7
    expect(rm.regionLandTiles(3)).toBe(0);
    expect(rm.regionCount()).toBe(2);
  });

  test("forEachRegionTile iterates in ascending TileRef order", () => {
    const raster = new Uint16Array([2, 1, 0, 2, 1, 0, 2, 1]);
    const rm = new RegionMap(raster, smallMap());
    const seen1: number[] = [];
    rm.forEachRegionTile(1, (t) => seen1.push(t));
    expect(seen1).toEqual([1, 4, 7]);
    const seen2: number[] = [];
    rm.forEachRegionTile(2, (t) => seen2.push(t));
    expect(seen2).toEqual([0, 3, 6]); // tile 5 is impassable → dropped
    const seenNone: number[] = [];
    rm.forEachRegionTile(99, (t) => seenNone.push(t));
    expect(seenNone).toEqual([]);
  });
});

describe("RegionTracker", () => {
  function tracker(): { rm: RegionMap; tr: RegionTracker } {
    // Region 1 = tiles 0,1,4 (3 ownable); region 2 = tiles 3,6,7 (3 ownable).
    const raster = new Uint16Array([1, 1, 1, 2, 1, 1, 2, 2]);
    const rm = new RegionMap(raster, smallMap());
    return { rm, tr: new RegionTracker(rm, 0.5) };
  }

  test("crossing the majority reports the region exactly once", () => {
    const { tr } = tracker();
    // Region 1 total = 3 → majority at 2 tiles.
    expect(tr.recordConquer(0, 0, 5)).toBe(-1); // 1/3
    expect(tr.recordConquer(1, 0, 5)).toBe(1); // 2/3 crosses
    expect(tr.recordConquer(4, 0, 5)).toBe(-1); // 3/3 no re-trigger
  });

  test("tiles outside any region never trigger", () => {
    const { tr } = tracker();
    expect(tr.recordConquer(2, 0, 5)).toBe(-1); // water (id cleared)
    expect(tr.ownedInRegion(1, 5)).toBe(0);
  });

  test("re-conquering an own tile is a no-op", () => {
    const { tr } = tracker();
    tr.recordConquer(0, 0, 5);
    tr.recordConquer(1, 0, 5);
    expect(tr.ownedInRegion(1, 5)).toBe(2);
    expect(tr.recordConquer(1, 5, 5)).toBe(-1);
    expect(tr.ownedInRegion(1, 5)).toBe(2);
  });

  test("conquering from another player moves the count", () => {
    const { tr } = tracker();
    tr.recordConquer(0, 0, 5);
    tr.recordConquer(1, 0, 5); // 5 crosses
    expect(tr.recordConquer(0, 5, 9)).toBe(-1); // 9 has 1/3
    expect(tr.ownedInRegion(1, 5)).toBe(1);
    expect(tr.ownedInRegion(1, 9)).toBe(1);
    expect(tr.recordConquer(1, 5, 9)).toBe(1); // 9 crosses at 2/3
    expect(tr.ownedInRegion(1, 5)).toBe(0);
  });

  test("relinquish decrements and allows re-crossing", () => {
    const { tr } = tracker();
    tr.recordConquer(0, 0, 5);
    expect(tr.recordConquer(1, 0, 5)).toBe(1);
    tr.recordRelinquish(1, 5);
    expect(tr.ownedInRegion(1, 5)).toBe(1);
    expect(tr.recordConquer(1, 0, 5)).toBe(1); // crosses again
  });

  test("onLandLost shrinks the total and can push an owner over the bar", () => {
    const { tr } = tracker();
    // smallID 0 / TerraNullius is never counted.
    tr.recordConquer(0, 0, 5); // 1 of 3 — not majority
    const change = tr.onLandLost(1); // total 3 → 2; 1 > 1 is false
    expect(change).toBeNull();
    const change2 = tr.onLandLost(4); // total 2 → 1; 1 > 0.5 crosses
    expect(change2).toEqual({ regionId: 1, ownerSmallID: 5 });
    expect(tr.regionLandTotal(1)).toBe(1);
  });

  test("onLandLost outside a region returns null", () => {
    const { tr } = tracker();
    expect(tr.onLandLost(2)).toBeNull(); // water tile, id 0
  });
});
