/**
 * Validates the committed Europe country data (countries.json) against the
 * committed region metadata (regions.json) and the flag assets: the countries
 * must partition region ids 1..regionCount exactly once, every flag must
 * exist, and names must be non-empty and unique.
 */
import fs from "fs";
import path from "path";

const MAP_DIR = path.join(__dirname, "../resources/maps/europe");
const FLAGS_DIR = path.join(__dirname, "../resources/flags");

interface CountriesJson {
  version: number;
  countries: { name: string; flag: string; regions: number[] }[];
}

interface RegionsJson {
  version: number;
  regionCount: number;
  regions: { id: number; name: string; country: string }[];
}

function loadJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(MAP_DIR, name), "utf8")) as T;
}

describe("Europe countries.json", () => {
  const countriesJson = loadJson<CountriesJson>("countries.json");
  const regionsJson = loadJson<RegionsJson>("regions.json");

  test("has version 1 and a plausible country count", () => {
    expect(countriesJson.version).toBe(1);
    expect(countriesJson.countries.length).toBeGreaterThanOrEqual(50);
    expect(countriesJson.countries.length).toBeLessThanOrEqual(80);
  });

  test("countries partition region ids 1..regionCount exactly once", () => {
    const regionCount = regionsJson.regionCount;
    expect(regionsJson.regions.length).toBe(regionCount);
    const seen = new Uint8Array(regionCount + 1);
    for (const country of countriesJson.countries) {
      expect(country.regions.length).toBeGreaterThan(0);
      for (const id of country.regions) {
        expect(Number.isInteger(id)).toBe(true);
        expect(id).toBeGreaterThanOrEqual(1);
        expect(id).toBeLessThanOrEqual(regionCount);
        expect(seen[id]).toBe(0); // no overlaps
        seen[id] = 1;
      }
    }
    for (let id = 1; id <= regionCount; id++) {
      expect(seen[id]).toBe(1); // no uncovered regions
    }
  });

  test("every flag file exists", () => {
    for (const country of countriesJson.countries) {
      expect(country.flag).not.toBe("");
      const flagPath = path.join(FLAGS_DIR, `${country.flag}.svg`);
      expect(fs.existsSync(flagPath)).toBe(true);
    }
  });

  test("names are non-empty and unique", () => {
    const names = countriesJson.countries.map((c) => c.name);
    for (const name of names) {
      expect(name.length).toBeGreaterThan(0);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test("folds are applied (no sovereign base areas, Palestine present)", () => {
    const names = new Set(countriesJson.countries.map((c) => c.name));
    expect(names.has("Cyprus")).toBe(true);
    expect(names.has("Palestine")).toBe(true);
    expect(names.has("Akrotiri Sovereign Base Area")).toBe(false);
    expect(names.has("Northern Cyprus")).toBe(false);
    expect(names.has("Gaza Strip")).toBe(false);
    expect(names.has("West Bank")).toBe(false);
  });
});
