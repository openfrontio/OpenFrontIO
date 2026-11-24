/**
 * The map generator library against the shipped maps: generating a map
 * from its image.png gives the map.bin, map4x.bin, map16x.bin and manifest
 * land counts in resources/maps (tests/testdata/maps for the test maps)
 * byte for byte. CI runs the small maps; MAPGEN_PARITY=all runs every map
 * (world10000 alone takes a few seconds and ~4 GB).
 */
import { generateMap } from "@openfront/engine-lib/mapgen/GenerateMap";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { decodePNG } from "../../../scripts/gen-maps/png";

const ROOT = path.resolve(__dirname, "../../..");
const SMALL = new Set([
  "half_land_half_ocean",
  "ocean_and_land",
  "plains",
  "big_plains",
  "world",
  "sierpinski",
  "tutorial",
  "warshipwarship",
  "thebox",
  "onion",
]);
const ALL = process.env.MAPGEN_PARITY === "all";

function maps(isTest: boolean): string[] {
  const dir = path.join(
    ROOT,
    "map-generator/assets",
    isTest ? "test_maps" : "maps",
  );
  return fs
    .readdirSync(dir)
    .filter((name) => ALL || SMALL.has(name))
    .sort();
}

describe.each([false, true])("generateMap, test maps: %s", (isTest) => {
  test.each(maps(isTest))(
    "%s matches the shipped files",
    (name) => {
      const input = path.join(
        ROOT,
        "map-generator/assets",
        isTest ? "test_maps" : "maps",
        name,
      );
      const output = path.join(
        ROOT,
        isTest ? "tests/testdata/maps" : "resources/maps",
        name,
      );
      const generated = generateMap(
        decodePNG(fs.readFileSync(path.join(input, "image.png"))),
        { removeSmall: !isTest },
      );
      const manifest = JSON.parse(
        fs.readFileSync(path.join(output, "manifest.json"), "utf8"),
      );
      for (const level of ["map", "map4x", "map16x"] as const) {
        const g = generated[level];
        expect({
          width: g.width,
          height: g.height,
          num_land_tiles: g.numLandTiles,
        }).toEqual(manifest[level]);
        const shipped = fs.readFileSync(path.join(output, `${level}.bin`));
        // Not toEqual: its diff of a multi-megabyte array never finishes.
        expect(Buffer.from(g.terrain).equals(shipped), `${level}.bin`).toBe(
          true,
        );
      }
    },
    120_000,
  );
});
