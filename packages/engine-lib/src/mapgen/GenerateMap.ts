import { deriveTerrain } from "./DeriveTerrain";
import { type RemovedBody, removeSmallBodies } from "./SmallBodies";
import {
  countLandTiles,
  downscaleTerrain,
  IMPASSABLE_BYTE,
  KIND,
  KIND_LAND,
  KIND_WATER,
  LAND_BIT,
} from "./TerrainBytes";
import { thumbnailPixels } from "./Thumbnail";

export const MIN_ISLAND_SIZE = 30;
export const MIN_LAKE_SIZE = 200;

/**
 * A map's image.png, decoded. "nrgba8": 8-bit RGBA, not premultiplied.
 * "rgba64": 16-bit RGBA premultiplied by alpha, as Go's image/png decodes
 * the PNG formats it doesn't keep as 8-bit RGBA.
 */
export type MapImage =
  | { kind: "nrgba8"; width: number; height: number; pix: Uint8Array }
  | { kind: "rgba64"; width: number; height: number; pix: Uint16Array };

export interface GeneratedTerrain {
  terrain: Uint8Array;
  width: number;
  height: number;
  numLandTiles: number;
}

export interface GeneratedMap {
  map: GeneratedTerrain;
  map4x: GeneratedTerrain;
  map16x: GeneratedTerrain;
  /** RGBA; the tool encodes it as thumbnail.webp. */
  thumbnail: { rgba: Uint8Array; width: number; height: number };
  /** The small islands and lakes removed from map, then the islands from map4x. */
  removed: RemovedBody[];
  removed4x: RemovedBody[];
}

/**
 * The map generator: a map's terrain at full, 1/4 and 1/16 size and its
 * thumbnail from its image. The image is cropped to a multiple of 4 on
 * each side. With `removeSmall`, islands under 30 tiles (15 on map4x) and
 * lakes under 200 are removed.
 */
export function generateMap(
  image: MapImage,
  options: { removeSmall: boolean },
): GeneratedMap {
  const width = image.width - (image.width % 4);
  const height = image.height - (image.height % 4);
  const { terrain, elevation } = imageTerrain(image, width, height);

  let removed: RemovedBody[] = [];
  if (options.removeSmall) {
    // concat, not push(...): a map with many small bodies can have more
    // than one call's arguments can hold.
    removed = removeSmallBodies(
      terrain,
      width,
      height,
      KIND_LAND,
      MIN_ISLAND_SIZE,
      { elevation },
    ).concat(
      removeSmallBodies(terrain, width, height, KIND_WATER, MIN_LAKE_SIZE, {
        keepOcean: true,
        elevation,
      }),
    );
  }
  deriveTerrain(terrain, width, height);

  const w4 = width / 2;
  const h4 = height / 2;
  const terrain4x = downscaleTerrain(terrain, width, height);
  const elevation4x = new Uint8Array(w4 * h4);
  for (let y = 0, t = 0; y < h4; y++) {
    for (let x = 0; x < w4; x++, t++) {
      // downscaleTerrain's land takes the elevation of the (1,1) tile.
      if (KIND[terrain4x[t]] === KIND_LAND) {
        elevation4x[t] = elevation[(2 * y + 1) * width + 2 * x + 1];
      }
    }
  }
  const removed4x = options.removeSmall
    ? removeSmallBodies(terrain4x, w4, h4, KIND_LAND, MIN_ISLAND_SIZE / 2, {
        elevation: elevation4x,
      })
    : [];
  deriveTerrain(terrain4x, w4, h4, { source: { terrain, width } });

  const w16 = w4 / 2;
  const h16 = h4 / 2;
  const terrain16x = downscaleTerrain(terrain4x, w4, h4);
  deriveTerrain(terrain16x, w16, h16, {
    source: { terrain: terrain4x, width: w4 },
  });

  const map = level(terrain, width, height);
  if (map.numLandTiles === 0) throw new Error("Map has 0 land tiles");
  return {
    map,
    map4x: level(terrain4x, w4, h4),
    map16x: level(terrain16x, w16, h16),
    thumbnail: thumbnailPixels(terrain4x, w4, h4, elevation4x),
    removed,
    removed4x,
  };
}

function level(
  terrain: Uint8Array,
  width: number,
  height: number,
): GeneratedTerrain {
  return { terrain, width, height, numLandTiles: countLandTiles(terrain) };
}

/**
 * The authored terrain of the image's top-left width x height pixels, and
 * the land's elevation in half steps, which the thumbnail keeps. On colour
 * premultiplied by alpha as Go's image.At(x, y).RGBA() gives it, 8 bits:
 * water where alpha < 20 or blue == 106, impassable where red, green and
 * blue are 0, else land at elevation (clamp(blue, 140, 200) - 140) / 2,
 * rounded up in the terrain byte.
 */
export function imageTerrain(
  image: MapImage,
  width: number,
  height: number,
): { terrain: Uint8Array; elevation: Uint8Array } {
  const terrain = new Uint8Array(width * height);
  const elevation = new Uint8Array(width * height);
  const { pix } = image;
  // premultiply[a * 256 + c]: c premultiplied by a, as Go's
  // color.NRGBA.RGBA() >> 8 does it. Identity for "rgba64", whose >> 8
  // the loop takes.
  let premultiply: Uint8Array | null = null;
  if (image.kind === "nrgba8") {
    premultiply = new Uint8Array(256 * 256);
    for (let a = 0; a < 256; a++) {
      for (let c = 0; c < 256; c++) {
        premultiply[a * 256 + c] = Math.floor((c * 0x101 * a) / 0xff) >> 8;
      }
    }
  }
  const shift = image.kind === "rgba64" ? 8 : 0;
  for (let y = 0; y < height; y++) {
    let s = y * image.width * 4;
    let t = y * width;
    for (let x = 0; x < width; x++, s += 4, t++) {
      const alpha = pix[s + 3] >> shift;
      let red = pix[s] >> shift;
      let green = pix[s + 1] >> shift;
      let blue = pix[s + 2] >> shift;
      if (premultiply !== null) {
        const row = alpha * 256;
        red = premultiply[row + red];
        green = premultiply[row + green];
        blue = premultiply[row + blue];
      }
      if (alpha < 20 || blue === 106) continue; // water, 0
      if (red === 0 && green === 0 && blue === 0) {
        terrain[t] = IMPASSABLE_BYTE;
        continue;
      }
      const e2 = Math.min(200, Math.max(140, blue)) - 140;
      elevation[t] = e2;
      terrain[t] = LAND_BIT | ((e2 + 1) >> 1);
    }
  }
  return { terrain, elevation };
}
