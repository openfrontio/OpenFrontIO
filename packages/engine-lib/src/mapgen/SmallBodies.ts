import {
  IMPASSABLE_BYTE,
  KIND,
  KIND_IMPASSABLE,
  KIND_LAND,
  KIND_WATER,
  LAND_BIT,
} from "./TerrainBytes";

/** A body of land or water removeSmallBodies replaced. */
export interface RemovedBody {
  kind: number;
  /** Where the generator's column-by-column scan finds it first. */
  x: number;
  y: number;
  size: number;
  /** The kind it became. */
  replacement: number;
}

/**
 * The 4-connected bodies of `kind`. The tiles of body k are
 * order[start[k] .. start[k] + size[k]); key[k] is the smallest x * h + y
 * among them, which orders the bodies as the generator's column-by-column
 * scan finds them.
 */
function findBodies(terrain: Uint8Array, w: number, h: number, kind: number) {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const order = new Int32Array(n);
  const start: number[] = [];
  const size: number[] = [];
  const key: number[] = [];
  let tail = 0;
  for (let i = 0; i < n; i++) {
    if (KIND[terrain[i]] !== kind || label[i] !== -1) continue;
    const id = start.length;
    const first = tail;
    label[i] = id;
    order[tail++] = i;
    let minKey = Infinity;
    for (let head = first; head < tail; head++) {
      const c = order[head];
      const x = c % w;
      const y = (c - x) / w;
      minKey = Math.min(minKey, x * h + y);
      if (x > 0 && KIND[terrain[c - 1]] === kind && label[c - 1] === -1) {
        label[c - 1] = id;
        order[tail++] = c - 1;
      }
      if (x < w - 1 && KIND[terrain[c + 1]] === kind && label[c + 1] === -1) {
        label[c + 1] = id;
        order[tail++] = c + 1;
      }
      if (y > 0 && KIND[terrain[c - w]] === kind && label[c - w] === -1) {
        label[c - w] = id;
        order[tail++] = c - w;
      }
      if (y < h - 1 && KIND[terrain[c + w]] === kind && label[c + w] === -1) {
        label[c + w] = id;
        order[tail++] = c + w;
      }
    }
    start.push(first);
    size.push(tail - first);
    key.push(minKey);
  }
  return { label, order, start, size, key };
}

/**
 * Replaces each body of `kind` (KIND_LAND or KIND_WATER) smaller than
 * `minSize` tiles with the kind most of the tiles around it are, on a tie
 * water, then impassable, then land; at elevation 0 if it becomes land.
 * With `keepOcean`, the largest body of water is kept whatever its size
 * (the ocean, chosen as DeriveTerrain chooses it). `elevation`, if given,
 * is zeroed on the replaced tiles. Returns the bodies replaced, in the
 * order the generator's column-by-column scan finds them.
 */
export function removeSmallBodies(
  terrain: Uint8Array,
  w: number,
  h: number,
  kind: number,
  minSize: number,
  options: { keepOcean?: boolean; elevation?: Uint8Array } = {},
): RemovedBody[] {
  const bodies = findBodies(terrain, w, h, kind);
  const count = bodies.size.length;
  let ocean = -1;
  if (options.keepOcean) {
    for (let id = 0; id < count; id++) {
      const s = bodies.size[id];
      if (
        ocean < 0 ||
        s > bodies.size[ocean] ||
        (s === bodies.size[ocean] && bodies.key[id] < bodies.key[ocean])
      ) {
        ocean = id;
      }
    }
  }
  const small: number[] = [];
  for (let id = 0; id < count; id++) {
    if (id !== ocean && bodies.size[id] < minSize) small.push(id);
  }
  small.sort((a, b) => bodies.key[a] - bodies.key[b]);

  // Bodies of one kind never touch, so replacing one doesn't change what
  // is around another.
  const removed: RemovedBody[] = [];
  const seen = new Int32Array(w * h).fill(-1);
  const counts = [0, 0, 0];
  for (const id of small) {
    const tiles = bodies.order.subarray(
      bodies.start[id],
      bodies.start[id] + bodies.size[id],
    );
    counts.fill(0);
    const visit = (nb: number) => {
      if (bodies.label[nb] === id || seen[nb] === id) return;
      seen[nb] = id;
      counts[KIND[terrain[nb]]]++;
    };
    for (let k = 0; k < tiles.length; k++) {
      const c = tiles[k];
      const x = c % w;
      if (x > 0) visit(c - 1);
      if (x < w - 1) visit(c + 1);
      if (c >= w) visit(c - w);
      if (c < (h - 1) * w) visit(c + w);
    }
    let replacement = KIND_WATER;
    if (counts[KIND_IMPASSABLE] > counts[replacement]) {
      replacement = KIND_IMPASSABLE;
    }
    if (counts[KIND_LAND] > counts[replacement]) replacement = KIND_LAND;
    const byte =
      replacement === KIND_WATER
        ? 0
        : replacement === KIND_LAND
          ? LAND_BIT
          : IMPASSABLE_BYTE;
    for (let k = 0; k < tiles.length; k++) {
      terrain[tiles[k]] = byte;
      if (options.elevation) options.elevation[tiles[k]] = 0;
    }
    const key = bodies.key[id];
    removed.push({
      kind,
      x: Math.floor(key / h),
      y: key % h,
      size: bodies.size[id],
      replacement,
    });
  }
  return removed;
}
