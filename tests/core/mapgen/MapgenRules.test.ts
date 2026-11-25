import { deriveTerrain } from "@openfront/engine-lib/mapgen/DeriveTerrain";
import {
  generateMap,
  imageTerrain,
} from "@openfront/engine-lib/mapgen/GenerateMap";
import { removeSmallBodies } from "@openfront/engine-lib/mapgen/SmallBodies";
import {
  downscaleTerrain,
  IMPASSABLE_BYTE,
  KIND_LAND,
  KIND_WATER,
} from "@openfront/engine-lib/mapgen/TerrainBytes";
import { thumbnailPixels } from "@openfront/engine-lib/mapgen/Thumbnail";
import { describe, expect, test } from "vitest";

const W = 0; // water
const L = 0x80; // land at elevation 0
const X = IMPASSABLE_BYTE;

/** A map from rows of authored bytes. */
function grid(rows: number[][]): { terrain: Uint8Array; w: number; h: number } {
  return {
    terrain: Uint8Array.from(rows.flat()),
    w: rows[0].length,
    h: rows.length,
  };
}

describe("imageTerrain", () => {
  test("reads water, impassable and land elevation from the colour", () => {
    const pix = Uint8Array.from([
      ...[0, 0, 200, 19], // alpha < 20: water
      ...[0, 0, 106, 255], // blue 106: water
      ...[0, 0, 0, 255], // black: impassable
      ...[0, 0, 141, 255], // elevation 0.5, rounded up
      ...[0, 0, 250, 255], // blue clamped to 200: elevation 30
      ...[0, 0, 255, 128], // premultiplied blue 128, clamped to 140: 0
    ]);
    const { terrain, elevation } = imageTerrain(
      { kind: "nrgba8", width: 6, height: 1, pix },
      6,
      1,
    );
    expect([...terrain]).toEqual([0, 0, X, 0x81, 0x80 | 30, 0x80]);
    expect([...elevation]).toEqual([0, 0, 0, 1, 60, 0]);
  });

  test("takes the high byte of 16-bit premultiplied colour", () => {
    const pix = Uint16Array.from([0, 0, 0x8dff, 0xffff]);
    const { terrain } = imageTerrain(
      { kind: "rgba64", width: 1, height: 1, pix },
      1,
      1,
    );
    expect([...terrain]).toEqual([0x81]);
  });
});

describe("removeSmallBodies", () => {
  test("replaces a small island with what most of its neighbours are", () => {
    const { terrain, w, h } = grid([
      [W, W, W, X],
      [W, L, L, X],
      [W, W, X, X],
    ]);
    const elevation = new Uint8Array(w * h).fill(9);
    const removed = removeSmallBodies(terrain, w, h, KIND_LAND, 3, {
      elevation,
    });
    // 4 water neighbours to 2 impassable.
    expect(removed).toEqual([
      { kind: KIND_LAND, x: 1, y: 1, size: 2, replacement: KIND_WATER },
    ]);
    expect(terrain[w + 1]).toBe(W);
    expect(elevation[w + 1]).toBe(0);
  });

  test("breaks a tie as water, then impassable, then land", () => {
    const { terrain, w, h } = grid([[X, L, W]]);
    removeSmallBodies(terrain, w, h, KIND_LAND, 2);
    expect(terrain[1]).toBe(W);
    const lake = grid([[X, W, L]]);
    removeSmallBodies(lake.terrain, lake.w, lake.h, KIND_WATER, 2);
    expect(lake.terrain[1]).toBe(X);
  });

  test("keeps the ocean, the largest body of water, however small", () => {
    const { terrain, w, h } = grid([
      [W, W, L, W],
      [L, L, L, L],
    ]);
    const removed = removeSmallBodies(terrain, w, h, KIND_WATER, 10, {
      keepOcean: true,
    });
    expect(removed.map((b) => [b.x, b.y, b.replacement])).toEqual([
      [3, 0, KIND_LAND],
    ]);
    expect([...terrain.subarray(0, 4)]).toEqual([W, W, L, L]);
  });
});

describe("deriveTerrain", () => {
  test("sets the shoreline and ocean bits and the depth", () => {
    // A 1 x 8 strip: land, then water 7 tiles out.
    const { terrain, w, h } = grid([[L, W, W, W, W, W, W, W]]);
    deriveTerrain(terrain, w, h);
    // Land next to water is shoreline; depth is floor(distance to land / 2).
    expect([...terrain]).toEqual([
      L | 0x40,
      0x20 | 0x40,
      0x20 | 1,
      0x20 | 1,
      0x20 | 2,
      0x20 | 2,
      0x20 | 3,
      0x20 | 3,
    ]);
  });

  test("the ocean is the largest body, on a tie the first by column", () => {
    const { terrain, w, h } = grid([
      [L, L, W],
      [W, L, W],
      [W, L, L],
    ]);
    deriveTerrain(terrain, w, h);
    // Both bodies have 2 tiles; (0,1) comes before (2,0) column by column.
    expect(terrain[3] & 0x20).toBe(0x20);
    expect(terrain[2] & 0x20).toBe(0);
  });

  test("water by impassable terrain is depth 10, coastless water 0", () => {
    const { terrain, w, h } = grid([
      [X, X, X, X],
      [X, W, W, W],
      [X, W, W, W],
    ]);
    deriveTerrain(terrain, w, h);
    expect([...terrain.subarray(4)]).toEqual([
      ...[X, 0x20 | 10, 0x20 | 10, 0x20 | 10],
      ...[X, 0x20 | 10, 0x20, 0x20],
    ]);
  });

  test("downscaled coastless water takes its first water source's depth", () => {
    const terrain = Uint8Array.from([W]);
    deriveTerrain(terrain, 1, 1, {
      source: { terrain: Uint8Array.from([X, 0x06, 0x04, 0x02]), width: 2 },
    });
    // (0,0) is impassable; (0,1), second in createMiniMap's order, is the
    // first water.
    expect(terrain[0]).toBe(0x20 | 0x04);
  });

  test("reports each changed tile through `set` instead of writing", () => {
    const { terrain, w, h } = grid([[L, W]]);
    const writes: [number, number][] = [];
    deriveTerrain(terrain, w, h, { set: (t, v) => writes.push([t, v]) });
    expect(writes).toEqual([
      [0, L | 0x40],
      [1, 0x60],
    ]);
    expect([...terrain]).toEqual([L, W]);
  });
});

test("downscaleTerrain: water first, then impassable, else the (1,1) land", () => {
  const { terrain, w, h } = grid([
    [L, L, L, X, 0x85, 0x81],
    [L, W, L, L, 0x82, 0x83],
  ]);
  expect([...downscaleTerrain(terrain, w, h)]).toEqual([W, X, 0x83]);
});

test("thumbnailPixels colours land by elevation and water by depth", () => {
  const tiles = [
    0x80 | 0x40, // land shoreline
    0x80 | 5,
    0x80 | 15,
    0x80 | 25,
    0x60, // water shoreline
    0x20 | 3,
    X,
    0x20 | 31,
  ];
  // One pixel per other tile: a 16 x 1 map4x gives an 8 x 1 thumbnail.
  const thumb = thumbnailPixels(
    Uint8Array.from(tiles.flatMap((b) => [b, 0])),
    16,
    1,
  );
  expect(thumb.width).toBe(8);
  expect([...thumb.rgba]).toEqual([
    ...[204, 203, 158, 255],
    ...[190, 210, 138, 255],
    ...[230, 213, 168, 255],
    ...[242, 242, 242, 255],
    ...[100, 143, 255, 0],
    ...[68, 130, 178, 0],
    ...[0, 0, 0, 0],
    ...[61, 123, 171, 0],
  ]);
  // The generator's half-step elevation, where it has one: 4.5 is still
  // plains, where the terrain byte's rounded-up 5 would be one shade darker.
  const half = thumbnailPixels(
    Uint8Array.from([0x80 | 5]),
    1,
    1,
    Uint8Array.from([9]),
  );
  expect([...half.rgba]).toEqual([190, 211, 138, 255]);
});

test("generateMap crops to a multiple of 4 and refuses a map with no land", () => {
  const image = (blue: number) => ({
    kind: "nrgba8" as const,
    width: 9,
    height: 6,
    pix: Uint8Array.from({ length: 9 * 6 * 4 }, (_, i) =>
      i % 4 === 2 ? blue : i % 4 === 3 ? 255 : 0,
    ),
  });
  const map = generateMap(image(150), { removeSmall: false });
  expect([map.map.width, map.map.height]).toEqual([8, 4]);
  expect([map.map16x.width, map.map16x.height]).toEqual([2, 1]);
  expect(map.map.numLandTiles).toBe(32);
  expect(() => generateMap(image(106), { removeSmall: false })).toThrow(
    "Map has 0 land tiles",
  );
});

test("generateMap removes more small islands than fit in one call's arguments", () => {
  // 199 columns of land, then 250,000 one-tile islands in open water.
  const width = 1200;
  const height = 1000;
  const pix = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < 199 || (x % 2 === 0 && y % 2 === 0)) {
        pix.set([0, 0, 150, 255], (y * width + x) * 4);
      }
    }
  }
  const map = generateMap(
    { kind: "nrgba8", width, height, pix },
    { removeSmall: true },
  );
  expect(map.removed.length).toBe(250_000);
  expect(map.map.numLandTiles).toBe(199 * height);
});
