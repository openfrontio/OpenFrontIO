// @vitest-environment node
/**
 * Heightmap import (docs/ScenarioEditor.md, "Terrain"): the size limits,
 * and a stock map's image read with the map generator's pixel rules
 * (tests/core/mapgen tests the rules themselves).
 */

import { authoredTerrain } from "@openfront/engine-api/EditorCommands";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  heightmapDocument,
  heightmapSize,
} from "../../../src/client/scenario/HeightmapImport";
import { newScenarioDocument } from "../../../src/client/scenario/ScenarioDocument";

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

test("a stock map's source image starts a scenario with that map's terrain", () => {
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
  const doc = heightmapDocument(
    "Tutorial",
    size.width,
    size.height,
    image.rgba,
  );
  expect(doc.terrain).toEqual(Uint8Array.from(mapBin, authoredTerrain));
  // It has water, land at several elevations and no impassable tiles.
  expect(new Set(doc.terrain).size).toBeGreaterThan(3);
  // Otherwise a new scenario.
  expect({ ...doc, terrain: null }).toEqual({
    ...newScenarioDocument("Tutorial", size.width, size.height),
    terrain: null,
  });
});
