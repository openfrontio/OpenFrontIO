// @vitest-environment node
/**
 * Heightmap import (docs/ScenarioEditor.md, "Terrain"): the map generator's
 * pixel rules, the size limits, and the import as one undo step.
 */

import {
  authoredTerrain,
  type EditorCommand,
} from "@openfront/engine-api/EditorCommands";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { DocumentEditor } from "../../../src/client/scenario/DocumentEditor";
import {
  heightmapSize,
  heightmapTerrain,
  importHeightmap,
} from "../../../src/client/scenario/HeightmapImport";
import {
  IMPASSABLE,
  land,
  newScenarioDocument,
  WATER,
} from "../../../src/client/scenario/ScenarioDocument";

const ROOT = path.join(__dirname, "../../..");

/**
 * The RGBA of an 8-bit, non-interlaced RGB or RGBA PNG: what the browser's
 * getImageData gives for it, without a canvas.
 */
function decodePng(file: string): {
  width: number;
  height: number;
  rgba: Uint8Array;
} {
  const png = fs.readFileSync(file);
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let pos = 8; pos < png.length;) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("latin1", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = data.subarray(8);
      if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
        throw new Error("only 8-bit non-interlaced RGB(A) PNGs");
      }
      channels = colorType === 2 ? 3 : 4;
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += length + 12;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i] + p) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      for (let k = 0; k < channels; k++) rgba[o + k] = line[x * channels + k];
      if (channels === 3) rgba[o + 3] = 255;
    }
    prev = line;
  }
  return { width, height, rgba };
}

/** One pixel's authored terrain. */
const pixel = (r: number, g: number, b: number, a = 255) =>
  heightmapTerrain([r, g, b, a], 1, 1, 1)[0];

describe("heightmapTerrain", () => {
  test("alpha under 20 is water, whatever the colour", () => {
    expect(pixel(0, 0, 0, 0)).toBe(WATER);
    expect(pixel(255, 255, 255, 19)).toBe(WATER);
    expect(pixel(255, 255, 255, 20)).not.toBe(WATER);
  });

  test("blue 106 is water", () => {
    expect(pixel(10, 200, 106)).toBe(WATER);
    expect(pixel(10, 200, 105)).toBe(land(0));
    expect(pixel(10, 200, 107)).toBe(land(0));
  });

  test("black is impassable, and only black", () => {
    expect(pixel(0, 0, 0)).toBe(IMPASSABLE);
    expect(pixel(1, 0, 0)).toBe(land(0));
    expect(pixel(0, 1, 0)).toBe(land(0));
    expect(pixel(0, 0, 1)).toBe(land(0));
  });

  test("elevation is (blue - 140) / 2 rounded up, blue clamped to 140-200", () => {
    expect(pixel(50, 50, 0)).toBe(land(0));
    expect(pixel(50, 50, 139)).toBe(land(0));
    expect(pixel(50, 50, 140)).toBe(land(0));
    expect(pixel(50, 50, 141)).toBe(land(1));
    expect(pixel(50, 50, 142)).toBe(land(1));
    expect(pixel(50, 50, 143)).toBe(land(2));
    expect(pixel(50, 50, 199)).toBe(land(30));
    expect(pixel(50, 50, 200)).toBe(land(30));
    expect(pixel(50, 50, 201)).toBe(land(30));
    expect(pixel(50, 50, 255)).toBe(land(30));
  });

  test("premultiplies by alpha first, as the generator does", () => {
    // 200 * 128 / 255 is 100 premultiplied: plains, not a mountain.
    expect(pixel(50, 50, 200, 128)).toBe(land(0));
    // 212 premultiplied by 128 is 106: water.
    expect(pixel(50, 50, 212, 128)).toBe(WATER);
    // Dark and faint premultiplies to black.
    expect(pixel(5, 5, 5, 20)).toBe(IMPASSABLE);
  });

  test("reads the top-left of a wider image", () => {
    // 3 x 2: only the first two columns are read.
    const rgba = [
      [0, 0, 0, 255],
      [9, 9, 200, 255],
      [9, 9, 106, 255],
      [9, 9, 106, 255],
      [9, 9, 160, 0],
      [9, 9, 0, 255],
    ].flat();
    expect([...heightmapTerrain(rgba, 3, 2, 2)]).toEqual([
      IMPASSABLE,
      land(30),
      WATER,
      WATER,
    ]);
  });
});

describe("heightmapSize", () => {
  test("crops each side down to a multiple of 4 and at most 5000", () => {
    expect(heightmapSize(100, 5000)).toEqual({ width: 100, height: 5000 });
    expect(heightmapSize(103, 1002)).toEqual({ width: 100, height: 1000 });
    expect(heightmapSize(5003, 8000)).toEqual({ width: 5000, height: 5000 });
  });

  test("rejects a side under 100 once cropped", () => {
    expect(heightmapSize(99, 1000)).toBeNull();
    expect(heightmapSize(1000, 98)).toBeNull();
    expect(heightmapSize(16, 16)).toBeNull();
  });
});

test("a stock map's source image imports as that map's authored terrain", () => {
  // The tutorial map: small, a valid scenario size as it is, and the
  // generator's removal of tiny islands and lakes changed nothing on it.
  const image = decodePng(
    path.join(ROOT, "map-generator/assets/maps/tutorial/image.png"),
  );
  const mapBin = fs.readFileSync(
    path.join(ROOT, "resources/maps/tutorial/map.bin"),
  );
  const size = heightmapSize(image.width, image.height)!;
  expect(size).toEqual({ width: 224, height: 168 });
  const terrain = heightmapTerrain(
    image.rgba,
    image.width,
    size.width,
    size.height,
  );
  expect(terrain).toEqual(Uint8Array.from(mapBin, authoredTerrain));
  // It has water, land at several elevations and no impassable tiles.
  expect(new Set(terrain).size).toBeGreaterThan(3);

  const doc = newScenarioDocument("Tutorial", size.width, size.height);
  const sent: EditorCommand[] = [];
  const editor = new DocumentEditor(doc, (c) => sent.push(c));
  expect(importHeightmap(editor, terrain)).toBe(true);
  expect(doc.terrain).toEqual(terrain);
  // Only the tiles that change, in one set_terrain and one full pass.
  expect(sent.map((c) => c.type)).toEqual(["set_terrain", "end_terrain_edit"]);
  const set = sent[0] as Extract<EditorCommand, { type: "set_terrain" }>;
  expect(set.tiles).toHaveLength(terrain.filter((b) => b !== WATER).length);
});

describe("importHeightmap", () => {
  const W = 100;
  const H = 100;
  const tile = (x: number, y: number) => y * W + x;

  /**
   * Land in the left half with A's city and land on it, a warship on the
   * water at (70, 50), and an impassable tile at (10, 10).
   */
  function setup() {
    const doc = newScenarioDocument("Import", W, H);
    const sent: EditorCommand[] = [];
    const editor = new DocumentEditor(doc, (c) => sent.push(c), 1000);
    const left: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W / 2; x++) left.push(tile(x, y));
    }
    editor.apply({
      type: "set_terrain",
      tiles: left,
      terrain: left.map(() => land(5)),
    });
    editor.apply({
      type: "set_terrain",
      tiles: [tile(10, 10)],
      terrain: [IMPASSABLE],
    });
    editor.apply({
      type: "add_nation",
      nation: {
        id: "NATIONAA",
        name: "A",
        flag: null,
        troops: 100,
        gold: 0,
        playable: true,
      },
    });
    const owned = left.filter((t) => t % W >= 20 && t % W < 40);
    editor.apply({ type: "set_owner", tiles: owned, owner: "NATIONAA" });
    editor.apply({
      type: "place_structure",
      structure: {
        type: UnitType.City,
        tile: tile(30, 30),
        nation: "NATIONAA",
        level: 1,
      },
    });
    editor.apply({
      type: "place_warship",
      warship: { tile: tile(70, 50), nation: "NATIONAA" },
    });
    editor.commit();
    sent.length = 0;
    return { doc, sent, editor };
  }

  test("is one undo step that brings back the terrain and what it cleared", () => {
    const { doc, sent, editor } = setup();
    const before = {
      terrain: doc.terrain.slice(),
      owners: doc.owners.slice(),
      structures: structuredClone(doc.structures),
      warships: structuredClone(doc.warships),
    };
    // The image swaps the halves: water on the left, mountains on the right.
    const terrain = new Uint8Array(W * H);
    for (let t = 0; t < terrain.length; t++) {
      terrain[t] = t % W < W / 2 ? WATER : land(20);
    }

    // Split in batches of 1500 tiles: several edits, one step.
    expect(importHeightmap(editor, terrain, 1500)).toBe(true);
    expect(doc.terrain).toEqual(terrain);
    expect(doc.owners.every((o) => o === 0)).toBe(true);
    expect(doc.structures).toEqual([]);
    expect(doc.warships).toEqual([]);
    const types = sent.map((c) => c.type);
    expect(types.filter((t) => t === "end_terrain_edit")).toHaveLength(1);
    expect(types[types.length - 1]).toBe("end_terrain_edit");
    expect(types.filter((t) => t === "set_terrain").length).toBeGreaterThan(1);

    sent.length = 0;
    editor.undo();
    expect(doc.terrain).toEqual(before.terrain);
    expect(doc.owners).toEqual(before.owners);
    expect(doc.structures).toEqual(before.structures);
    expect(doc.warships).toEqual(before.warships);
    expect(sent.filter((c) => c.type === "end_terrain_edit")).toHaveLength(1);
    // The setup is the step before.
    editor.undo();
    expect(doc.nations).toEqual([]);

    editor.redo();
    editor.redo();
    expect(doc.terrain).toEqual(terrain);
    expect(doc.structures).toEqual([]);
  });

  test("an image of the map as it is changes nothing and sends nothing", () => {
    const { doc, sent, editor } = setup();
    expect(importHeightmap(editor, doc.terrain.slice())).toBe(false);
    expect(sent).toEqual([]);
    editor.undo();
    expect(doc.nations).toEqual([]);
  });

  test("takes only an image of the map's size", () => {
    const { editor } = setup();
    expect(() =>
      importHeightmap(editor, new Uint8Array(W * (H + 4))),
    ).toThrow();
  });
});
