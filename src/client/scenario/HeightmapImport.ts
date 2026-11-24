/**
 * Heightmap import (docs/ScenarioEditor.md, "Terrain"): a PNG read with the
 * map generator's pixel rules (GenerateMap in map-generator/map_generator.go)
 * and written over the map as one terrain edit.
 */

import { MAX_TERRAIN_BATCH } from "@openfront/engine-api/EditorCommands";
import type { DocumentEditor } from "./DocumentEditor";
import {
  IMPASSABLE,
  land,
  MAX_SIDE,
  MIN_SIDE,
  WATER,
} from "./ScenarioDocument";

/**
 * The size an image imports at: each side cropped from the top left to a
 * multiple of 4 and at most MAX_SIDE. Null if a side is then under MIN_SIDE.
 */
export function heightmapSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const side = (n: number) => Math.min(MAX_SIDE, n - (n % 4));
  const size = { width: side(width), height: side(height) };
  return size.width < MIN_SIDE || size.height < MIN_SIDE ? null : size;
}

/**
 * The authored terrain of the top-left `width` x `height` pixels of an RGBA
 * image `imageWidth` pixels wide, its colours not premultiplied (as
 * getImageData and a PNG give them). Like the generator, it premultiplies
 * them first: then transparent (alpha under 20) or blue 106 is water, black
 * is impassable, and anything else land with an elevation of
 * (clamp(blue, 140, 200) - 140) / 2, rounded up.
 */
export function heightmapTerrain(
  rgba: ArrayLike<number>,
  imageWidth: number,
  width: number,
  height: number,
): Uint8Array {
  const terrain = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * imageWidth + x) * 4;
      const a = rgba[i + 3];
      // Go's color.NRGBA.RGBA(), then its top 8 bits.
      const pm = (c: number) => Math.floor((c * 257 * a) / 255) >> 8;
      const b = pm(rgba[i + 2]);
      let t: number;
      if (a < 20 || b === 106) {
        t = WATER;
      } else if (pm(rgba[i]) === 0 && pm(rgba[i + 1]) === 0 && b === 0) {
        t = IMPASSABLE;
      } else {
        t = land(Math.ceil((Math.min(200, Math.max(140, b)) - 140) / 2));
      }
      terrain[y * width + x] = t;
    }
  }
  return terrain;
}

/**
 * The RGBA of the image's top-left `width` x `height` pixels, as the file
 * has them: no colour management, not premultiplied.
 */
export function heightmapPixels(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8ClampedArray {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d canvas");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, width, height).data;
}

/** Decodes an image file for heightmapPixels; rejects if it isn't one. */
export function openHeightmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
}

/**
 * Writes `terrain`, one authored byte per tile, over the whole map as one
 * undo step. Returns whether it changed anything.
 */
export function importHeightmap(
  editor: DocumentEditor,
  terrain: Uint8Array,
  // Tests split at a few tiles rather than a million.
  batchSize: number = MAX_TERRAIN_BATCH,
): boolean {
  const current = editor.doc.terrain;
  if (terrain.length !== current.length) {
    throw new Error(`${terrain.length} tiles for a ${current.length}-tile map`);
  }
  const tiles: number[] = [];
  for (let t = 0; t < terrain.length; t++) {
    if (terrain[t] !== current[t]) tiles.push(t);
  }
  // Each edit under MAX_TERRAIN_BATCH: DocumentEditor keeps a Map of an
  // edit's tiles, and a Map holds at most 2^24 entries.
  for (let i = 0; i < tiles.length; i += batchSize) {
    const batch = tiles.slice(i, i + batchSize);
    editor.apply({
      type: "set_terrain",
      tiles: batch,
      terrain: batch.map((t) => terrain[t]),
    });
  }
  editor.commit();
  return tiles.length > 0;
}
