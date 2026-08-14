import type { TerrainRect } from "../../types";

export interface TerrainRowSpansResult {
  rects: TerrainRect[];
  bytes: Uint8Array;
}

/**
 * Group terrain-changed tile refs into one span per map row (min..max x),
 * reading the CURRENT terrain byte for every tile in each span. A massive
 * water nuke changes tens of thousands of tiles in one tick; uploading them
 * as individual 1×1 texSubImage2D calls costs hundreds of ms of driver time,
 * while a few hundred row spans upload in ~1ms. Unchanged tiles inside a span
 * re-upload their current byte — harmless.
 *
 * Spans are returned in ascending row order; `bytes` holds each span's data
 * concatenated in that order.
 */
export function buildTerrainRowSpans(
  refs: readonly number[],
  mapW: number,
  terrainByteAt: (ref: number) => number,
): TerrainRowSpansResult {
  const rows = new Map<number, { min: number; max: number }>();
  for (const ref of refs) {
    const x = ref % mapW;
    const y = (ref - x) / mapW;
    const row = rows.get(y);
    if (row === undefined) {
      rows.set(y, { min: x, max: x });
    } else {
      if (x < row.min) row.min = x;
      if (x > row.max) row.max = x;
    }
  }

  const ys = [...rows.keys()].sort((a, b) => a - b);
  let total = 0;
  for (const y of ys) {
    const row = rows.get(y)!;
    total += row.max - row.min + 1;
  }

  const bytes = new Uint8Array(total);
  const rects: TerrainRect[] = new Array(ys.length);
  let offset = 0;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    const { min, max } = rows.get(y)!;
    const rowStart = y * mapW;
    for (let x = min; x <= max; x++) {
      bytes[offset++] = terrainByteAt(rowStart + x);
    }
    rects[i] = { x: min, y, w: max - min + 1, h: 1 };
  }
  return { rects, bytes };
}
