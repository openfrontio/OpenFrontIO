/**
 * PreviewMapGenerator — creates deterministic 512x512 maps for cosmetic previewing.
 *
 * Encodes terrain bytes using engine bitflags:
 * - Bit 7 (0x80): Land tile (0 = water)
 * - Bit 6 (0x40): Shoreline / Sand coastal modifier
 * - Bit 5 (0x20): Deep ocean water
 * - Bits 0-4 (0x1f): Height / depth magnitude (0..31)
 */

export const PREVIEW_MAP_DIM = 512;

export type PreviewTerrainPreset =
  | "CONTINENTAL_ARCHIPELAGO"
  | "OPEN_OCEAN"
  | "COASTAL_BASEPLATE";

export interface PreviewMapData {
  mapW: number;
  mapH: number;
  terrainBytes: Uint8Array;
  tileState: Uint16Array;
}

export function generatePreviewMap(
  preset: PreviewTerrainPreset = "CONTINENTAL_ARCHIPELAGO",
): PreviewMapData {
  const mapW = PREVIEW_MAP_DIM;
  const mapH = PREVIEW_MAP_DIM;
  const totalTiles = mapW * mapH;
  const terrainBytes = new Uint8Array(totalTiles);
  const tileState = new Uint16Array(totalTiles);

  switch (preset) {
    case "OPEN_OCEAN":
      buildOpenOcean(terrainBytes, mapW, mapH);
      break;
    case "COASTAL_BASEPLATE":
      buildCoastalBaseplate(terrainBytes, tileState, mapW, mapH);
      break;
    case "CONTINENTAL_ARCHIPELAGO":
    default:
      buildContinentalArchipelago(terrainBytes, tileState, mapW, mapH);
      break;
  }

  return { mapW, mapH, terrainBytes, tileState };
}

function buildOpenOcean(out: Uint8Array, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      // Pure deep ocean water
      const distFromCenter = Math.hypot(x - w / 2, y - h / 2) / (w / 2);
      const mag = Math.min(10, Math.max(0, Math.floor(distFromCenter * 8)));
      out[idx] = 0x20 | (mag & 0x1f);
    }
  }
}

function buildCoastalBaseplate(
  terrain: Uint8Array,
  tileState: Uint16Array,
  w: number,
  h: number,
): void {
  const midX = Math.floor(w / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const dist = x - midX;
      if (dist < -4) {
        // Land (plains)
        terrain[idx] = 0x80 | 4;
        tileState[idx] = 1;
      } else if (dist <= 4) {
        // Sand shoreline
        terrain[idx] = 0x80 | 0x40 | 1;
        tileState[idx] = 1;
      } else if (dist <= 12) {
        // Shoreline water
        terrain[idx] = 0x40 | 0;
        tileState[idx] = 0;
      } else {
        // Ocean
        terrain[idx] = 0x20 | 4;
        tileState[idx] = 0;
      }
    }
  }
}

function buildContinentalArchipelago(
  terrain: Uint8Array,
  tileState: Uint16Array,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const maxR = 215; // 430-tile diameter expansive continent

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);

      // Subtle, smooth natural curvature (minimal irregular wobbles)
      const angle = Math.atan2(dy, dx);
      const wobble = Math.sin(angle * 4.0) * 5.0 + Math.cos(angle * 6.0) * 3.0;
      const effectiveR = maxR + wobble;

      if (dist < effectiveR - 5) {
        // Land: smooth elevation profile
        const normDist = dist / effectiveR;
        let elevationMag: number;
        if (normDist < 0.3) {
          elevationMag = Math.floor(18 + (1 - normDist / 0.3) * 6);
        } else if (normDist < 0.7) {
          elevationMag = Math.floor(8 + (1 - (normDist - 0.3) / 0.4) * 10);
        } else {
          elevationMag = Math.floor(2 + (1 - (normDist - 0.7) / 0.3) * 6);
        }
        terrain[idx] = 0x80 | (elevationMag & 0x1f);
        tileState[idx] = 1; // Owned by preview player 1
      } else if (dist <= effectiveR) {
        // Sand shoreline
        terrain[idx] = 0x80 | 0x40 | 1;
        tileState[idx] = 1;
      } else if (dist <= effectiveR + 6) {
        // Shoreline shallow water
        terrain[idx] = 0x40 | 0;
        tileState[idx] = 0;
      } else {
        // Deep ocean water
        const depthMag = Math.min(
          12,
          Math.floor(((dist - effectiveR - 6) / 25) * 8),
        );
        terrain[idx] = 0x20 | (depthMag & 0x1f);
        tileState[idx] = 0;
      }
    }
  }
}
