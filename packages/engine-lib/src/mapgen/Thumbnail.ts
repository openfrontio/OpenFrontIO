import {
  KIND,
  KIND_IMPASSABLE,
  KIND_WATER,
  MAGNITUDE_MASK,
  SHORELINE_BIT,
} from "./TerrainBytes";

/**
 * A map's thumbnail, RGBA: from its map4x terrain, at half its size, one
 * pixel per other tile. Water and impassable terrain are transparent.
 * `elevation` is the land's elevation in half steps (GenerateMap keeps it
 * from the image); without it, twice the terrain byte's.
 */
export function thumbnailPixels(
  terrain4x: Uint8Array,
  w4: number,
  h4: number,
  elevation?: Uint8Array,
): { rgba: Uint8Array<ArrayBuffer>; width: number; height: number } {
  const width = Math.max(1, Math.floor(w4 / 2));
  const height = Math.max(1, Math.floor(h4 / 2));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = Math.min(2 * y, h4 - 1) * w4;
    for (let x = 0; x < width; x++) {
      const t = row + Math.min(2 * x, w4 - 1);
      const b = terrain4x[t];
      const kind = KIND[b];
      if (kind === KIND_IMPASSABLE) continue;
      const shore = (b & SHORELINE_BIT) !== 0;
      let r: number, g: number, bl: number;
      let a = 255;
      if (kind === KIND_WATER) {
        // The generator colours water by its distance to land d:
        // 71 - min(d / 2, 10) truncated, that is 71 - min(depth, 10).
        a = 0;
        if (shore) {
          [r, g, bl] = [100, 143, 255];
        } else {
          const adj = Math.min(b & MAGNITUDE_MASK, 10);
          [r, g, bl] = [71 - adj, 133 - adj, 181 - adj];
        }
      } else {
        // Land at elevation e2 / 2.
        const e2 = elevation ? elevation[t] : 2 * (b & MAGNITUDE_MASK);
        if (shore) [r, g, bl] = [204, 203, 158];
        else if (e2 < 20) [r, g, bl] = [190, 220 - e2, 138];
        else if (e2 < 40) [r, g, bl] = [200 + e2, 183 + e2, 138 + e2];
        else r = g = bl = 230 + (e2 >> 2);
      }
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = bl;
      rgba[o + 3] = a;
    }
  }
  return { rgba, width, height };
}
