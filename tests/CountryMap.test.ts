/**
 * RegionMap country support (country-start mode): country lookups, tile
 * iteration, canonical tiles and partition validation on a synthetic raster.
 */
import { GameMapImpl } from "../src/core/game/GameMap";
import { CountriesJson, RegionMap } from "../src/core/game/RegionMap";

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

/** Region 1 = tiles 0,1,4 ownable; region 2 = 3,6; region 3 = 7. */
function raster(): Uint16Array {
  return new Uint16Array([1, 1, 1, 2, 1, 1, 2, 3]);
}

function countries(
  defs: [string, string, number[]][],
  version = 1,
): CountriesJson {
  return {
    version,
    countries: defs.map(([name, flag, regions]) => ({ name, flag, regions })),
  };
}

describe("RegionMap countries", () => {
  test("no countries → hasCountries false and lookups are empty", () => {
    const rm = new RegionMap(raster(), smallMap());
    expect(rm.hasCountries()).toBe(false);
    expect(rm.countryCount()).toBe(0);
    expect(rm.countryOfTile(0)).toBe(0);
    expect(rm.countryOfRegion(1)).toBe(0);
    const seen: number[] = [];
    rm.forEachCountryTile(1, (t) => seen.push(t));
    expect(seen).toEqual([]);
    expect(rm.countryCanonicalTile(1)).toBeUndefined();
  });

  test("country lookups: name, flag, countryOfRegion, countryOfTile", () => {
    const rm = new RegionMap(
      raster(),
      smallMap(),
      countries([
        ["Alpha", "al", [1]],
        ["Bravo", "ba", [2, 3]],
      ]),
    );
    expect(rm.hasCountries()).toBe(true);
    expect(rm.countryCount()).toBe(2);
    expect(rm.countryName(1)).toBe("Alpha");
    expect(rm.countryFlag(1)).toBe("al");
    expect(rm.countryName(2)).toBe("Bravo");
    expect(rm.countryFlag(2)).toBe("ba");
    expect(rm.countryOfRegion(1)).toBe(1);
    expect(rm.countryOfRegion(2)).toBe(2);
    expect(rm.countryOfRegion(3)).toBe(2);
    expect(rm.countryOfRegion(0)).toBe(0);
    // Tiles: region ids cleared on water (2) and impassable (5).
    expect(rm.countryOfTile(0)).toBe(1);
    expect(rm.countryOfTile(2)).toBe(0); // water
    expect(rm.countryOfTile(5)).toBe(0); // impassable
    expect(rm.countryOfTile(3)).toBe(2);
    expect(rm.countryOfTile(7)).toBe(2);
    expect(() => rm.countryName(0)).toThrow();
    expect(() => rm.countryName(3)).toThrow();
  });

  test("forEachCountryTile iterates regions ascending, tiles ascending", () => {
    const rm = new RegionMap(
      raster(),
      smallMap(),
      countries([
        ["Alpha", "al", [1]],
        // Deliberately unsorted region list — must iterate 2 before 3.
        ["Bravo", "ba", [3, 2]],
      ]),
    );
    const seen1: number[] = [];
    rm.forEachCountryTile(1, (t) => seen1.push(t));
    expect(seen1).toEqual([0, 1, 4]);
    const seen2: number[] = [];
    rm.forEachCountryTile(2, (t) => seen2.push(t));
    expect(seen2).toEqual([3, 6, 7]);
  });

  test("countryCanonicalTile is the first tile of the lowest non-empty region", () => {
    const rm = new RegionMap(
      raster(),
      smallMap(),
      countries([
        ["Alpha", "al", [1]],
        ["Bravo", "ba", [3, 2]],
      ]),
    );
    expect(rm.countryCanonicalTile(1)).toBe(0);
    expect(rm.countryCanonicalTile(2)).toBe(3); // region 2 before region 3
    expect(rm.countryCanonicalTile(99)).toBeUndefined();
  });

  test("region ids referenced beyond the raster are tolerated when covered", () => {
    // Region 4 has no tiles in this raster (e.g. lost in the 4x downsample)
    // but is still part of the countries.json partition.
    const rm = new RegionMap(
      raster(),
      smallMap(),
      countries([
        ["Alpha", "al", [1, 4]],
        ["Bravo", "ba", [2, 3]],
      ]),
    );
    expect(rm.countryOfRegion(4)).toBe(1);
    const seen: number[] = [];
    rm.forEachCountryTile(1, (t) => seen.push(t));
    expect(seen).toEqual([0, 1, 4]); // region 4 contributes nothing
  });

  test("throws when a region is assigned to multiple countries", () => {
    expect(
      () =>
        new RegionMap(
          raster(),
          smallMap(),
          countries([
            ["Alpha", "al", [1, 2]],
            ["Bravo", "ba", [2, 3]],
          ]),
        ),
    ).toThrow(/multiple countries/);
  });

  test("throws when a region is not covered by any country", () => {
    expect(
      () =>
        new RegionMap(
          raster(),
          smallMap(),
          countries([
            ["Alpha", "al", [1]],
            ["Bravo", "ba", [3]],
          ]),
        ),
    ).toThrow(/not covered/);
  });

  test("throws on invalid country definitions", () => {
    expect(() => new RegionMap(raster(), smallMap(), countries([]))).toThrow(
      /no countries/,
    );
    expect(
      () =>
        new RegionMap(
          raster(),
          smallMap(),
          countries([
            ["Alpha", "al", [1, 2]],
            ["Alpha", "ba", [3]],
          ]),
        ),
    ).toThrow(/duplicate country name/);
    expect(
      () =>
        new RegionMap(
          raster(),
          smallMap(),
          countries([["Alpha", "al", [0, 1, 2, 3]]]),
        ),
    ).toThrow(/invalid region id/);
    expect(
      () =>
        new RegionMap(
          raster(),
          smallMap(),
          countries([
            ["Alpha", "al", []],
            ["Bravo", "ba", [1, 2, 3]],
          ]),
        ),
    ).toThrow(/no regions/);
  });
});
