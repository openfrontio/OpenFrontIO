import type { TerrainRect } from "../../types";

export interface TerrainRowSpansResult {
  rects: TerrainRect[];
  bytes: Uint8Array;
}

const MAX_MERGE_OVERDRAW_RATIO = 1.5;
const MAX_MERGE_EXTRA_TEXELS = 4096;

interface PendingRect extends TerrainRect {
  sourceArea: number;
}

/**
 * Group terrain-changed tile refs into row spans, then merge adjacent spans
 * into rectangles when the extra unchanged texels stay bounded. A massive
 * water nuke changes tens of thousands of tiles in one tick; reducing hundreds
 * of texSubImage2D calls to a handful is much cheaper than uploading each row.
 * Unchanged tiles inside a rectangle re-upload their current byte — harmless.
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
  const pendingRects: PendingRect[] = [];
  for (const y of ys) {
    const row = rows.get(y)!;
    const rowWidth = row.max - row.min + 1;
    const previous = pendingRects[pendingRects.length - 1];
    if (previous && previous.y + previous.h === y) {
      const minX = Math.min(previous.x, row.min);
      const maxX = Math.max(previous.x + previous.w - 1, row.max);
      const mergedArea = (maxX - minX + 1) * (previous.h + 1);
      const sourceArea = previous.sourceArea + rowWidth;
      const extraTexels = mergedArea - sourceArea;
      if (
        mergedArea <= sourceArea * MAX_MERGE_OVERDRAW_RATIO ||
        extraTexels <= MAX_MERGE_EXTRA_TEXELS
      ) {
        previous.x = minX;
        previous.w = maxX - minX + 1;
        previous.h++;
        previous.sourceArea = sourceArea;
        continue;
      }
    }
    pendingRects.push({
      x: row.min,
      y,
      w: rowWidth,
      h: 1,
      sourceArea: rowWidth,
    });
  }

  let total = 0;
  for (const rect of pendingRects) {
    total += rect.w * rect.h;
  }

  const bytes = new Uint8Array(total);
  const rects: TerrainRect[] = new Array(pendingRects.length);
  let offset = 0;
  for (let i = 0; i < pendingRects.length; i++) {
    const { x, y, w, h } = pendingRects[i];
    for (let dy = 0; dy < h; dy++) {
      const rowStart = (y + dy) * mapW;
      for (let dx = 0; dx < w; dx++) {
        bytes[offset++] = terrainByteAt(rowStart + x + dx);
      }
    }
    rects[i] = { x, y, w, h };
  }
  return { rects, bytes };
}
