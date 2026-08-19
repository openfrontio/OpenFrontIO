import { TileRef } from "./GameMap";

// Deleted dense slots hold this sentinel. Tile refs are grid indices and map
// coordinates are capped at 65535, so the largest possible ref is
// 65535 * 65535 - 1, which is below 2^32 - 1 — the sentinel can never be a
// real tile.
const TOMBSTONE = 0xffffffff;
// Hash-table slot states (slots otherwise hold indices into `dense`).
const EMPTY = -1;
const DELETED = -2;

/**
 * The read surface of TileSet, mirroring the parts of ReadonlySet that
 * simulation code uses. A native Set<TileRef> also satisfies this interface.
 */
export interface ReadonlyTileSet {
  readonly size: number;
  has(tile: TileRef): boolean;
  forEach(
    callback: (tile: TileRef, tile2: TileRef, set: ReadonlyTileSet) => void,
  ): void;
  values(): IterableIterator<TileRef>;
  [Symbol.iterator](): IterableIterator<TileRef>;
}

/**
 * An insertion-ordered set of tile refs with compact storage: values live in
 * a Uint32Array in insertion order, with an open-addressing hash table (also
 * a typed array) for membership. Compared to Set<TileRef> at V8's ~30+ bytes
 * per element this costs ~12 bytes, which matters because every owned tile of
 * every player sits in one of these for the whole game — tens of MB on large
 * maps.
 *
 * Iteration semantics match Set: insertion order, entries added during
 * iteration are visited, entries deleted during iteration are skipped, and a
 * delete + re-add moves the value to the end. Deleted slots are tombstoned
 * and reclaimed by compaction, which is deferred while any iteration is in
 * progress so positions never shift under an iterator.
 */
export class TileSet implements ReadonlyTileSet {
  private dense: Uint32Array = new Uint32Array(16);
  // Used dense slots, including tombstones; live entries = size_.
  private denseLen = 0;
  private size_ = 0;
  private table: Int32Array = new Int32Array(32).fill(EMPTY);
  // Occupied table slots, including DELETED markers (bounds probe lengths).
  private tableUsed = 0;
  private iterDepth = 0;

  constructor(values?: Iterable<TileRef>) {
    if (values !== undefined) {
      for (const v of values) {
        this.add(v);
      }
    }
  }

  get size(): number {
    return this.size_;
  }

  private static hash(value: number): number {
    const h = Math.imul(value, 0x9e3779b1);
    return (h ^ (h >>> 15)) >>> 0;
  }

  has(value: TileRef): boolean {
    const table = this.table;
    const dense = this.dense;
    const mask = table.length - 1;
    let slot = TileSet.hash(value) & mask;
    for (;;) {
      const di = table[slot];
      if (di === EMPTY) return false;
      if (di !== DELETED && dense[di] === value) return true;
      slot = (slot + 1) & mask;
    }
  }

  add(value: TileRef): this {
    // Single probe pass: scan for an existing entry while remembering the
    // first DELETED slot for insertion. Previously this did two full probes
    // per add (one inside has(), one for insertion).
    let table = this.table;
    let mask = table.length - 1;
    let slot = TileSet.hash(value) & mask;
    let firstDeleted = -1;
    for (;;) {
      const di = table[slot];
      if (di === EMPTY) break;
      if (di === DELETED) {
        if (firstDeleted === -1) firstDeleted = slot;
      } else if (this.dense[di] === value) {
        return this;
      }
      slot = (slot + 1) & mask;
    }
    if (firstDeleted !== -1) slot = firstDeleted;

    let reProbe = false;
    if (this.denseLen === this.dense.length) {
      // Prefer reclaiming tombstones over growing, unless an iterator is
      // live (compaction shifts positions).
      if (this.iterDepth === 0 && this.denseLen - this.size_ >= this.size_) {
        this.compact(this.dense.length); // rehashes → probe slot is stale
        reProbe = true;
      } else {
        const grown = new Uint32Array(this.dense.length * 2);
        grown.set(this.dense);
        this.dense = grown;
      }
    }
    // Keep the table under ~60% occupied so probe chains stay short and
    // always hit an EMPTY slot. (Lower than the typical 75%: TileSet
    // membership probes dominate the conquest hot path, and the extra
    // Int32Array capacity is ~4 bytes per dense entry.)
    if ((this.tableUsed + 1) * 5 > this.table.length * 3) {
      this.rehash(
        this.size_ * 5 > this.table.length * 3
          ? this.table.length * 2
          : this.table.length, // mostly DELETED markers — same size, cleaned
      );
      reProbe = true;
    }
    if (reProbe) {
      // Re-probe on the fresh table (no DELETED markers remain after a
      // rehash, so insertion goes to the first EMPTY slot).
      table = this.table;
      mask = table.length - 1;
      slot = TileSet.hash(value) & mask;
      while (table[slot] !== EMPTY) {
        slot = (slot + 1) & mask;
      }
    }

    const di = this.denseLen++;
    this.dense[di] = value;
    this.size_++;
    if (table[slot] === EMPTY) this.tableUsed++;
    table[slot] = di;
    return this;
  }

  delete(value: TileRef): boolean {
    const table = this.table;
    const dense = this.dense;
    const mask = table.length - 1;
    let slot = TileSet.hash(value) & mask;
    for (;;) {
      const di = table[slot];
      if (di === EMPTY) return false;
      if (di !== DELETED && dense[di] === value) {
        table[slot] = DELETED;
        dense[di] = TOMBSTONE;
        this.size_--;
        // Mostly tombstones? Compact so long-dead players don't pin memory.
        if (
          this.iterDepth === 0 &&
          this.denseLen >= 64 &&
          this.denseLen - this.size_ > this.size_ * 2
        ) {
          this.compact(nextCapacity(this.size_));
        }
        return true;
      }
      slot = (slot + 1) & mask;
    }
  }

  clear(): void {
    this.dense = new Uint32Array(16);
    this.denseLen = 0;
    this.size_ = 0;
    this.table = new Int32Array(32).fill(EMPTY);
    this.tableUsed = 0;
  }

  forEach(
    callback: (tile: TileRef, tile2: TileRef, set: ReadonlyTileSet) => void,
  ): void {
    this.iterDepth++;
    try {
      // denseLen and dense are re-read every step: entries appended during
      // iteration must be visited, and an append can swap in a grown buffer.
      for (let i = 0; i < this.denseLen; i++) {
        const v = this.dense[i];
        if (v !== TOMBSTONE) callback(v, v, this);
      }
    } finally {
      this.iterDepth--;
    }
  }

  values(): IterableIterator<TileRef> {
    return this.iteratorFrom(0);
  }

  [Symbol.iterator](): IterableIterator<TileRef> {
    return this.iteratorFrom(0);
  }

  /**
   * Closure-based iterator. Generator `values()` allocates an
   * iterator-result object per element when consumed by Array.from/spread/
   * for..of; the closure form is inlinable and its per-element result
   * objects are escape-analyzed away in hot loops.
   */
  private iteratorFrom(index: number): IterableIterator<TileRef> {
    let i = index;
    let released = false;
    this.iterDepth++;
    const release = () => {
      if (!released) {
        released = true;
        this.iterDepth--;
      }
    };
    const iter: IterableIterator<TileRef> = {
      next: () => {
        // Re-read dense/denseLen every step like the generator did:
        // appends during iteration are visited, tombstoned slots skipped.
        const dense = this.dense;
        const len = this.denseLen;
        while (i < len) {
          const v = dense[i++];
          if (v !== TOMBSTONE) return { value: v, done: false };
        }
        release();
        return { value: undefined, done: true };
      },
      return: () => {
        release();
        return { value: undefined, done: true };
      },
      throw: (e?: unknown) => {
        release();
        throw e;
      },
      [Symbol.iterator]: () => iter,
    };
    return iter;
  }

  /** Rewrites dense storage without tombstones, preserving insertion order. */
  private compact(capacity: number): void {
    const compacted = new Uint32Array(Math.max(capacity, 16));
    let n = 0;
    for (let i = 0; i < this.denseLen; i++) {
      const v = this.dense[i];
      if (v !== TOMBSTONE) compacted[n++] = v;
    }
    this.dense = compacted;
    this.denseLen = n;
    this.rehash(Math.max(nextCapacity(n * 2), 32));
  }

  private rehash(tableLength: number): void {
    const table = new Int32Array(tableLength).fill(EMPTY);
    const mask = tableLength - 1;
    const dense = this.dense;
    for (let di = 0; di < this.denseLen; di++) {
      if (dense[di] === TOMBSTONE) continue;
      let slot = TileSet.hash(dense[di]) & mask;
      while (table[slot] !== EMPTY) {
        slot = (slot + 1) & mask;
      }
      table[slot] = di;
    }
    this.table = table;
    this.tableUsed = this.size_;
  }
}

/** Smallest power of two >= n (and >= 16). */
function nextCapacity(n: number): number {
  let cap = 16;
  while (cap < n) cap *= 2;
  return cap;
}
