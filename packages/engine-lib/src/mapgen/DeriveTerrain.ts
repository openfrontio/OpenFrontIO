import {
  KIND,
  KIND_LAND,
  KIND_WATER,
  LAND_BIT,
  MAGNITUDE_MASK,
  OCEAN_BIT,
  SHORELINE_BIT,
} from "./TerrainBytes";

// Max distance to passable land that can affect a depth: depth =
// floor(distance / 2) capped at 31, so 62.
export const MAX_DEPTH_DISTANCE = 62;
// The map generator's depth for water next to impassable terrain.
const IMPASSABLE_NEIGHBOR_DEPTH = 10;

// A terrain byte's kind as a bit (KIND_BIT[byte]), and the directions of a
// tile's water neighbours.
const WATER = 1;
const LAND = 2;
const IMPASSABLE = 4;
const UP = 8;
const DOWN = 16;
const LEFT = 32;
const RIGHT = 64;
const KIND_BIT = KIND.map((k) => 1 << k);
// The dist array: distance to passable land (1 next to it, 0 if not
// reached), and flags.
const DIST_MASK = 0x3f;
const SEEN = 0x2000;
const COASTLESS = 0x4000;
const IN_OCEAN = 0x8000;

export interface DeriveOptions {
  /**
   * The terrain this map was downscaled from (downscaleTerrain), and its
   * width: water with no coast takes its first water source's depth, as
   * the generator's createMiniMap copies it.
   */
  source?: { terrain: Uint8Array; width: number };
  /** w * h scratch, reused across calls. */
  dist?: Uint16Array;
  /**
   * Writes the tile's new byte. By default the terrain array is written in
   * place; the engine passes its own to record the changes.
   */
  set?: (tile: number, value: number) => void;
}

/**
 * Derives the shoreline bit, ocean bit and water depth of every tile of a
 * w x h map from the authored part of its terrain, by the map generator's
 * rules:
 *
 * - shoreline: land next to water, or water next to passable land;
 * - ocean: the largest body of water, on a tie the one the generator finds
 *   first scanning column by column (holding the smallest x * h + y);
 * - depth: floor(distance to passable land / 2), capped at 31; 10 next to
 *   impassable terrain; 0 in a body of water with no coast, or on a
 *   downscaled map its first water source's depth.
 */
export function deriveTerrain(
  terrain: Uint8Array,
  w: number,
  h: number,
  options: DeriveOptions = {},
): void {
  const total = w * h;
  const dist = options.dist ?? new Uint16Array(total);
  const queue = new Int32Array(total);

  // What each tile's neighbours are: the kinds of terrain among them, and
  // the directions in which they are water.
  const around = new Uint8Array(total);
  // From here dist holds, for each water tile, its distance to passable
  // land (0 if not reached) and the flags.
  dist.fill(0);
  let tail = 0;
  for (let y = 0, t = 0; y < h; y++) {
    for (let x = 0; x < w; x++, t++) {
      let m = 0;
      let k = 0;
      if (y > 0) m |= (k = KIND_BIT[terrain[t - w]]) === WATER ? k | UP : k;
      if (y < h - 1) {
        m |= (k = KIND_BIT[terrain[t + w]]) === WATER ? k | DOWN : k;
      }
      if (x > 0) m |= (k = KIND_BIT[terrain[t - 1]]) === WATER ? k | LEFT : k;
      if (x < w - 1) {
        m |= (k = KIND_BIT[terrain[t + 1]]) === WATER ? k | RIGHT : k;
      }
      around[t] = m;
      if (KIND_BIT[terrain[t]] === WATER && (m & LAND) !== 0) {
        dist[t] = 1;
        queue[tail++] = t;
      }
    }
  }

  // Depth by a BFS from the shoreline water. Water further out than the cap
  // is 31 if its body has a coast; COASTLESS marks the bodies that don't.
  for (let head = 0; head < tail; head++) {
    const t = queue[head];
    const d = dist[t];
    if (d >= MAX_DEPTH_DISTANCE) continue;
    const m = around[t];
    if ((m & UP) !== 0 && dist[t - w] === 0) {
      dist[t - w] = d + 1;
      queue[tail++] = t - w;
    }
    if ((m & DOWN) !== 0 && dist[t + w] === 0) {
      dist[t + w] = d + 1;
      queue[tail++] = t + w;
    }
    if ((m & LEFT) !== 0 && dist[t - 1] === 0) {
      dist[t - 1] = d + 1;
      queue[tail++] = t - 1;
    }
    if ((m & RIGHT) !== 0 && dist[t + 1] === 0) {
      dist[t + 1] = d + 1;
      queue[tail++] = t + 1;
    }
  }

  let ocean = -1;
  let oceanSize = 0;
  let oceanKey = 0;
  const coastless: number[] = [];
  for (let start = 0; start < total; start++) {
    if (KIND[terrain[start]] !== KIND_WATER) continue;
    if ((dist[start] & SEEN) !== 0) continue;
    const body = fillWaterBody(start, SEEN, dist, around, w, h, queue);
    if (!body.coast) coastless.push(start);
    if (
      body.size > oceanSize ||
      (body.size === oceanSize && body.key < oceanKey)
    ) {
      ocean = start;
      oceanSize = body.size;
      oceanKey = body.key;
    }
  }
  for (const start of coastless) {
    fillWaterBody(start, COASTLESS, dist, around, w, h, queue);
  }
  if (ocean >= 0) fillWaterBody(ocean, IN_OCEAN, dist, around, w, h, queue);

  const set =
    options.set ??
    ((t: number, value: number) => {
      terrain[t] = value;
    });
  const sourceTerrain = options.source?.terrain ?? null;
  const sw = options.source?.width ?? 0;
  for (let y = 0, t = 0; y < h; y++) {
    for (let x = 0; x < w; x++, t++) {
      const b = terrain[t];
      const m = around[t];
      const kind = KIND[b];
      let value = b & (LAND_BIT | MAGNITUDE_MASK);
      if (kind === KIND_WATER) {
        const d = dist[t];
        if ((m & IMPASSABLE) !== 0) {
          value = IMPASSABLE_NEIGHBOR_DEPTH;
        } else if ((d & COASTLESS) !== 0) {
          // No coast: 0, or on a downscaled map the depth of the first
          // water source in createMiniMap's order (0,0), (0,1), (1,0), (1,1).
          value = 0;
          if (sourceTerrain !== null) {
            const s = y * 2 * sw + x * 2;
            for (const src of [s, s + sw, s + 1, s + sw + 1]) {
              if ((sourceTerrain[src] & LAND_BIT) === 0) {
                value = sourceTerrain[src] & MAGNITUDE_MASK;
                break;
              }
            }
          }
        } else {
          const reached = d & DIST_MASK;
          value = reached === 0 ? MAGNITUDE_MASK : reached >> 1;
        }
        if ((d & IN_OCEAN) !== 0) value |= OCEAN_BIT;
        if ((m & LAND) !== 0) value |= SHORELINE_BIT;
      } else if (kind === KIND_LAND && (m & WATER) !== 0) {
        value |= SHORELINE_BIT;
      }
      if (value !== b) set(t, value);
    }
  }
}

/**
 * Scan-line flood fill (as in ConnectedComponents) of the water body
 * holding `start`, setting `bit` in `marks` on its tiles. Returns the
 * body's size, whether any of its tiles has passable land beside it, and
 * the smallest x * h + y among its tiles.
 */
function fillWaterBody(
  start: number,
  bit: number,
  marks: Uint16Array,
  around: Uint8Array,
  w: number,
  h: number,
  queue: Int32Array,
): { size: number; coast: boolean; key: number } {
  let size = 0;
  let coast = 0;
  let key = Infinity;
  // A tile is marked when it is queued, and only the first tile of each
  // unmarked run above or below a span is queued: the run is filled from it.
  marks[start] |= bit;
  queue[0] = start;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    let left = queue[head];
    let right = left;
    while ((around[left] & LEFT) !== 0 && (marks[left - 1] & bit) === 0) {
      marks[--left] |= bit;
    }
    while ((around[right] & RIGHT) !== 0 && (marks[right + 1] & bit) === 0) {
      marks[++right] |= bit;
    }
    size += right - left + 1;
    const x = left % w;
    key = Math.min(key, x * h + (left - x) / w);
    let upRun = false;
    let downRun = false;
    for (let t = left; t <= right; t++) {
      const m = around[t];
      coast |= m & LAND;
      const up = (m & UP) !== 0 && (marks[t - w] & bit) === 0;
      if (up && !upRun) {
        marks[t - w] |= bit;
        queue[tail++] = t - w;
      }
      upRun = up;
      const down = (m & DOWN) !== 0 && (marks[t + w] & bit) === 0;
      if (down && !downRun) {
        marks[t + w] |= bit;
        queue[tail++] = t + w;
      }
      downRun = down;
    }
  }
  return { size, coast: coast !== 0, key };
}
