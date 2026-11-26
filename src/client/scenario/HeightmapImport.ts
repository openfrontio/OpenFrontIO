/**
 * Heightmap import (docs/ScenarioEditor.md, "Terrain"): a new scenario
 * whose terrain is a PNG read with the map generator's pixel rules
 * (imageTerrain in engine-lib/mapgen).
 */

import { imageTerrain } from "@openfront/engine-lib/mapgen/GenerateMap";
import {
  MAX_SIDE,
  MIN_SIDE,
  newScenarioDocument,
  type ScenarioDocument,
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
 * A new scenario `width` x `height` whose terrain is `pix`, that many
 * pixels of RGBA as heightmapPixels gives them.
 */
export function heightmapDocument(
  name: string,
  width: number,
  height: number,
  pix: Uint8Array,
): ScenarioDocument {
  const doc = newScenarioDocument(name, width, height);
  doc.terrain.set(
    imageTerrain({ kind: "nrgba8", width, height, pix }, width, height).terrain,
  );
  return doc;
}

/**
 * The RGBA of the image's top-left `width` x `height` pixels, as the file
 * has them: no colour management, not premultiplied. imageTerrain's
 * "nrgba8".
 */
export function heightmapPixels(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Uint8Array {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d canvas");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, width, height);
  return new Uint8Array(data.buffer, data.byteOffset, data.length);
}

/** Decodes an image file for heightmapPixels; rejects if it isn't one. */
export function openHeightmap(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file, {
    colorSpaceConversion: "none",
    premultiplyAlpha: "none",
  });
}
