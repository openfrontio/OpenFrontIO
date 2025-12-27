import { GameMap, TileRef } from "../game/GameMap";

// Terrain (water/land) is immutable for a game map, so this can be cached forever per instance.
const cache = new WeakMap<GameMap, Uint32Array>();

export function getWaterComponentIds(gm: GameMap): Uint32Array {
  const cached = cache.get(gm);
  if (cached) return cached;

  const w = gm.width();
  const h = gm.height();
  const numTiles = w * h;
  const ids = new Uint32Array(numTiles); // 0 = not-water/unassigned, 1..N = component id

  let nextId = 0;
  const queue = new Int32Array(numTiles);
  const lastRowStart = (h - 1) * w;

  for (let start = 0; start < numTiles; start++) {
    if (ids[start] !== 0) continue;
    if (!gm.isWater(start)) continue;

    nextId++;
    ids[start] = nextId;

    let head = 0;
    let tail = 0;
    queue[tail++] = start;

    while (head < tail) {
      const node = queue[head++]!;
      const x = node % w;

      if (node >= w) {
        const n = node - w;
        if (ids[n] === 0 && gm.isWater(n)) {
          ids[n] = nextId;
          queue[tail++] = n;
        }
      }
      if (node < lastRowStart) {
        const s = node + w;
        if (ids[s] === 0 && gm.isWater(s)) {
          ids[s] = nextId;
          queue[tail++] = s;
        }
      }
      if (x !== 0) {
        const wv = node - 1;
        if (ids[wv] === 0 && gm.isWater(wv)) {
          ids[wv] = nextId;
          queue[tail++] = wv;
        }
      }
      if (x !== w - 1) {
        const ev = node + 1;
        if (ids[ev] === 0 && gm.isWater(ev)) {
          ids[ev] = nextId;
          queue[tail++] = ev;
        }
      }
    }
  }

  cache.set(gm, ids);
  return ids;
}

export function getWaterComponentId(gm: GameMap, tile: TileRef): number {
  if (!gm.isWater(tile)) return 0;
  const ids = getWaterComponentIds(gm);
  return ids[tile] ?? 0;
}

