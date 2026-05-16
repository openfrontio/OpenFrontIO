/**
 * GPU-ready color utilities.
 *
 * Terrain RGBA: Uint8Array(w × h × 4) — one RGBA pixel per tile, computed
 * from PastelTheme rules applied to the raw terrain byte layout.
 *
 * Player palette is NOT built here — consumers provide a pre-built
 * Float32Array(PALETTE_SIZE × 2 × 4) to the GPURenderer constructor.
 */

/** Must cover 12-bit smallID range (0-4095). */
const PALETTE_SIZE = 4096;

export function getPaletteSize(): number {
  return PALETTE_SIZE;
}

// ---------- Terrain ----------

/**
 * Compute a static RGBA8 texture from raw terrain bytes.
 * Replicates PastelTheme.terrainColor() on the CPU.
 *
 * Terrain byte layout per tile:
 *   bit 7: isLand
 *   bit 6: isShoreline
 *   bit 5: isOcean  (water only)
 *   bits 0-4: magnitude (0-31)
 */
export function buildTerrainRGBA(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const pixels = new Uint8Array(w * h * 4);

  for (let i = 0; i < w * h; i++) {
    const tb = terrainBytes[i];
    const isLand = (tb & 0x80) !== 0;
    const isShoreline = (tb & 0x40) !== 0;
    const magnitude = tb & 0x1f;

    let r: number, g: number, b: number;

    if (isLand && isShoreline) {
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
      // Deep water
      const m = Math.min(magnitude, 10);
      const offset = 11 - m;
      r = Math.max(0, 70 - 10 + offset);
      g = Math.max(0, 132 - 10 + offset);
      b = Math.max(0, 180 - 10 + offset);
    }

    const off = i * 4;
    pixels[off] = r;
    pixels[off + 1] = g;
    pixels[off + 2] = b;
    pixels[off + 3] = 255;
  }

  return pixels;
}
