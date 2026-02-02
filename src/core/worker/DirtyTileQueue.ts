import { TileRef } from "../game/GameMap";

/**
 * Worker-local deduping dirty-tile queue.
 *
 * Mirrors the SAB branch "dirtyFlags + ring buffer" idea, but without Atomics
 * (single-threaded within the worker).
 */
export class DirtyTileQueue {
  private readonly dirtyFlags: Uint8Array;
  private readonly queue: Uint32Array;
  private head = 0;
  private tail = 0;
  private size = 0;

  constructor(
    numTiles: number,
    private readonly capacity: number,
  ) {
    this.dirtyFlags = new Uint8Array(numTiles);
    this.queue = new Uint32Array(capacity);
  }

  /**
   * Mark a tile dirty (idempotent until drained).
   *
   * Returns `false` if the queue overflows.
   */
  mark(tile: TileRef): boolean {
    const idx = tile as unknown as number;
    if (idx < 0 || idx >= this.dirtyFlags.length) {
      return true;
    }
    if (this.dirtyFlags[idx] === 1) {
      return true;
    }
    if (this.size >= this.capacity) {
      return false;
    }
    this.dirtyFlags[idx] = 1;
    this.queue[this.tail] = idx >>> 0;
    this.tail = (this.tail + 1) % this.capacity;
    this.size++;
    return true;
  }

  /**
   * Drain up to `maxCount` dirty tiles.
   *
   * Clears the dirty flag for each returned tile.
   */
  drain(maxCount: number): TileRef[] {
    const count = Math.min(maxCount, this.size);
    if (count === 0) {
      return [];
    }
    const out: TileRef[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const idx = this.queue[this.head];
      this.head = (this.head + 1) % this.capacity;
      this.size--;
      this.dirtyFlags[idx] = 0;
      out[i] = idx as unknown as TileRef;
    }
    return out;
  }

  clear(): void {
    if (this.size > 0) {
      this.dirtyFlags.fill(0);
    }
    this.head = 0;
    this.tail = 0;
    this.size = 0;
  }

  pendingCount(): number {
    return this.size;
  }
}
