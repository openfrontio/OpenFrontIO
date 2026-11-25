// The terrain byte, as map.bin stores it and GameMapImpl reads it: bit 7
// land, bit 6 shoreline, bit 5 ocean, bits 0-4 the magnitude (elevation on
// land, depth in water). Land with magnitude 31 is impassable. The authored
// part (EditorCommands.authoredTerrain) is the land bit and the magnitude
// on land; the rest is derived from it (DeriveTerrain).

export const LAND_BIT = 0x80;
export const SHORELINE_BIT = 0x40;
export const OCEAN_BIT = 0x20;
export const MAGNITUDE_MASK = 0x1f;
export const IMPASSABLE_MAGNITUDE = 31;
/** The authored byte of impassable terrain. */
export const IMPASSABLE_BYTE = LAND_BIT | IMPASSABLE_MAGNITUDE;

export const KIND_WATER = 0;
export const KIND_LAND = 1;
export const KIND_IMPASSABLE = 2;

/** KIND_WATER, KIND_LAND or KIND_IMPASSABLE. */
export function terrainKind(b: number): number {
  if ((b & LAND_BIT) === 0) return KIND_WATER;
  return (b & MAGNITUDE_MASK) === IMPASSABLE_MAGNITUDE
    ? KIND_IMPASSABLE
    : KIND_LAND;
}

/** terrainKind of every byte, for the loops over whole maps. */
export const KIND = Uint8Array.from({ length: 256 }, (_, b) => terrainKind(b));

/**
 * The map generator's downscale (createMiniMap) of a w x h map's authored
 * terrain to (w >> 1) x (h >> 1): a tile is water if any of its four tiles
 * is, else impassable if any is, else land at the elevation of the last,
 * (1,1). Returns the authored bytes; DeriveTerrain derives the rest.
 */
export function downscaleTerrain(
  terrain: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const mw = w >> 1;
  const mh = h >> 1;
  const out = new Uint8Array(mw * mh);
  for (let my = 0, t = 0; my < mh; my++) {
    for (let mx = 0; mx < mw; mx++, t++) {
      const s = 2 * my * w + 2 * mx;
      const a = KIND[terrain[s]];
      const b = KIND[terrain[s + w]];
      const c = KIND[terrain[s + 1]];
      const d = KIND[terrain[s + w + 1]];
      if (
        a === KIND_WATER ||
        b === KIND_WATER ||
        c === KIND_WATER ||
        d === KIND_WATER
      ) {
        continue; // out[t] = 0, water
      }
      if (
        a === KIND_IMPASSABLE ||
        b === KIND_IMPASSABLE ||
        c === KIND_IMPASSABLE ||
        d === KIND_IMPASSABLE
      ) {
        out[t] = IMPASSABLE_BYTE;
      } else {
        out[t] = terrain[s + w + 1] & (LAND_BIT | MAGNITUDE_MASK);
      }
    }
  }
  return out;
}

/** The tiles that are land, not impassable: the manifest's num_land_tiles. */
export function countLandTiles(terrain: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (KIND[terrain[i]] === KIND_LAND) n++;
  }
  return n;
}
