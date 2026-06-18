/**
 * GPU-ready color utilities.
 *
 * Terrain RGBA: Uint8Array(w × h × 4) — one RGBA pixel per tile, computed
 * from the terrain color rules applied to the raw terrain byte layout.
 *
 * Player palette is NOT built here — consumers provide a pre-built
 * Float32Array(PALETTE_SIZE × 2 × 4) to the GPURenderer constructor.
 */

import renderDefaults from "../render-settings.json";

/** Must cover 12-bit smallID range (0-4095). */
const PALETTE_SIZE = 4096;

export function getPaletteSize(): number {
  return PALETTE_SIZE;
}

// ---------- Terrain ----------

/** Parse a "#rrggbb" (or "rrggbb") hex string into an RGB tuple, or null. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * Default base (shallowest, magnitude 0) color for deep water. Derived from
 * the `terrain.oceanColor` default in render-settings.json (the single source
 * of truth); used as a fallback when no override color is supplied.
 */
const DEEP_WATER_BASE: readonly [number, number, number] = hexToRgb(
  renderDefaults.terrain.oceanColor,
)!;

/**
 * Compute a static RGBA8 texture from raw terrain bytes.
 * The single source of truth for terrain colors.
 *
 * Terrain byte layout per tile:
 *   bit 7: isLand
 *   bit 6: isShoreline
 *   bit 5: isOcean  (water only)
 *   bits 0-4: magnitude (0-31)
 *
 * Impassable terrain is encoded as isLand=1 + magnitude=31. It renders as
 * the map background colour (matching `gl.clearColor` in Renderer.ts) so the
 * map appears non-rectangular — the impassable regions are visually
 * indistinguishable from the area outside the map.
 */
/** Encode one terrain byte → RGBA, writing into `out[offset..offset+3]`. */
export function encodeTerrainTile(
  tb: number,
  out: Uint8Array,
  offset: number,
  oceanColor?: readonly [number, number, number],
): void {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;

  let r: number, g: number, b: number;

  // Impassable terrain: render as the map background colour so it blends
  // with the area outside the map quad. Must match the clear colour in
  // Renderer.ts drawBaseLayer(): gl.clearColor(60/255, 60/255, 60/255).
  if (isLand && magnitude === 31) {
    r = 60;
    g = 60;
    b = 60;
  } else if (isLand && isShoreline) {
    // Shore (sand)
    r = 204;
    g = 203;
    b = 158;
  } else if (isLand) {
    if (magnitude < 10) {
      // Plains
      r = 190;
      g = 220 - 2 * magnitude;
      b = 138;
    } else if (magnitude < 20) {
      // Highland
      r = 200 + 2 * magnitude;
      g = 183 + 2 * magnitude;
      b = 138 + 2 * magnitude;
    } else {
      // Mountain
      const v = Math.min(255, 230 + Math.floor(magnitude / 2));
      r = v;
      g = v;
      b = v;
    }
  } else if (isShoreline) {
    // Shoreline water
    r = 100;
    g = 143;
    b = 255;
  } else {
    // Deep water — darkens with depth (magnitude). The base color sets the
    // shallowest (brightest) shade; the per-depth gradient is preserved by
    // subtracting the depth from each channel.
    const m = Math.min(magnitude, 10);
    const base = oceanColor ?? DEEP_WATER_BASE;
    r = Math.max(0, base[0] - m);
    g = Math.max(0, base[1] - m);
    b = Math.max(0, base[2] - m);
  }

  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] = 255;
}

export function buildTerrainRGBA(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
  oceanColor?: readonly [number, number, number],
): Uint8Array {
  const pixels = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    encodeTerrainTile(terrainBytes[i], pixels, i * 4, oceanColor);
  }
  return pixels;
}
