/**
 * Pure raster helpers for the region-data generator
 * (scripts/regions/generate-regions.ts). Deterministic: multi-source BFS
 * seeds are enqueued in ascending tile order and neighbors are visited in
 * N, S, W, E order, so ties always resolve the same way.
 *
 * No dependencies — unit-tested by tests/RegionRasterUtils.test.ts.
 */

/**
 * Multi-source BFS fill constrained to ownable land: every ownable tile
 * (ownable[t] !== 0) with ids[t] === 0 receives the id of the nearest
 * (4-neighbor, through ownable land only) assigned ownable tile. Mutates and
 * returns `ids`. Unreachable ownable tiles (islands with no assigned tile)
 * stay 0 — see nearestFillGlobal.
 */
export function nearestFillLand(
  ids: Uint16Array,
  ownable: Uint8Array,
  width: number,
  height: number,
): Uint16Array {
  const n = width * height;
  const queue = new Uint32Array(n);
  let head = 0;
  let tail = 0;
  for (let t = 0; t < n; t++) {
    if (ownable[t] !== 0 && ids[t] !== 0) queue[tail++] = t;
  }
  while (head < tail) {
    const t = queue[head++];
    const id = ids[t];
    const x = t % width;
    // N, S, W, E — matches GameMap neighbor order.
    if (t >= width && ownable[t - width] !== 0 && ids[t - width] === 0) {
      ids[t - width] = id;
      queue[tail++] = t - width;
    }
    if (t < n - width && ownable[t + width] !== 0 && ids[t + width] === 0) {
      ids[t + width] = id;
      queue[tail++] = t + width;
    }
    if (x !== 0 && ownable[t - 1] !== 0 && ids[t - 1] === 0) {
      ids[t - 1] = id;
      queue[tail++] = t - 1;
    }
    if (x !== width - 1 && ownable[t + 1] !== 0 && ids[t + 1] === 0) {
      ids[t + 1] = id;
      queue[tail++] = t + 1;
    }
  }
  return ids;
}

/**
 * Second-stage fill for islands: BFS from every assigned ownable tile across
 * ALL tiles (crossing water), then assigns the propagated label to ownable
 * tiles that are still 0. Mutates and returns `ids`.
 */
export function nearestFillGlobal(
  ids: Uint16Array,
  ownable: Uint8Array,
  width: number,
  height: number,
): Uint16Array {
  const n = width * height;
  const labels = new Uint16Array(n);
  const queue = new Uint32Array(n);
  let head = 0;
  let tail = 0;
  for (let t = 0; t < n; t++) {
    if (ownable[t] !== 0 && ids[t] !== 0) {
      labels[t] = ids[t];
      queue[tail++] = t;
    }
  }
  if (tail === 0) return ids; // nothing assigned anywhere
  while (head < tail) {
    const t = queue[head++];
    const id = labels[t];
    const x = t % width;
    if (t >= width && labels[t - width] === 0) {
      labels[t - width] = id;
      queue[tail++] = t - width;
    }
    if (t < n - width && labels[t + width] === 0) {
      labels[t + width] = id;
      queue[tail++] = t + width;
    }
    if (x !== 0 && labels[t - 1] === 0) {
      labels[t - 1] = id;
      queue[tail++] = t - 1;
    }
    if (x !== width - 1 && labels[t + 1] === 0) {
      labels[t + 1] = id;
      queue[tail++] = t + 1;
    }
  }
  for (let t = 0; t < n; t++) {
    if (ownable[t] !== 0 && ids[t] === 0) ids[t] = labels[t];
  }
  return ids;
}

/**
 * Downsample a full-resolution id raster to the map4x grid (2× reduction per
 * axis): each output tile gets the majority nonzero id of its 2×2 full-res
 * block; ties break to the smallest id (deterministic). Blocks with no
 * nonzero id yield 0 (fill afterwards against the map4x land mask).
 */
export function downsample4x(
  ids: Uint16Array,
  width: number,
  height: number,
  outWidth: number,
  outHeight: number,
): Uint16Array {
  const out = new Uint16Array(outWidth * outHeight);
  const block = new Array<number>(4);
  for (let oy = 0; oy < outHeight; oy++) {
    for (let ox = 0; ox < outWidth; ox++) {
      let m = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = ox * 2 + dx;
          const y = oy * 2 + dy;
          if (x >= width || y >= height) continue;
          const id = ids[y * width + x];
          if (id !== 0) block[m++] = id;
        }
      }
      if (m === 0) continue;
      // Majority with smallest-id tie-break over at most 4 entries.
      let best = 0;
      let bestCount = 0;
      for (let i = 0; i < m; i++) {
        const id = block[i];
        let count = 0;
        for (let j = 0; j < m; j++) {
          if (block[j] === id) count++;
        }
        if (count > bestCount || (count === bestCount && id < best)) {
          best = id;
          bestCount = count;
        }
      }
      out[oy * outWidth + ox] = best;
    }
  }
  return out;
}
