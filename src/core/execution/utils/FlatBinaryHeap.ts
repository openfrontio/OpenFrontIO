import { TileRef } from "../../game/GameMap";

/**
 * Lightweight min-heap specialised for (priority:number, tile:TileRef) pairs.
 * - priorities stored in a contiguous Float32Array
 * - tiles stored in a parallel object array
 */
export class FlatBinaryHeap {
  /** parallel arrays: pri[ i ] is the priority of tiles[ i ] */
  private pri: Float32Array;
  private tiles: TileRef[];
  private len = 0; // current number of elements

  constructor(capacity = 1024) {
    this.pri = new Float32Array(capacity);
    this.tiles = new Array<TileRef>(capacity);
  }

  /** remove every element without reallocating */
  clear(): void {
    this.len = 0;
  }

  /** current heap size */
  size(): number {
    return this.len;
  }

  //insert tiles
  enqueue(tile: TileRef, priority: number): void {
    if (this.len === this.pri.length) this.grow(); // ensure space
    let i = this.len++;

    /* sift-up */
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (priority >= this.pri[parent]) break;
      this.pri[i] = this.pri[parent];
      this.tiles[i] = this.tiles[parent];
      i = parent;
    }
    this.pri[i] = priority;
    this.tiles[i] = tile;
  }

  //remove tiles
  dequeue(): [TileRef, number] {
    if (this.len === 0) throw new Error("heap empty");

    const topTile = this.tiles[0];
    const topPri = this.pri[0];

    const lastPri = this.pri[--this.len];
    const lastTile = this.tiles[this.len];

    /* sift-down */
    let i = 0;
    while (true) {
      const left = (i << 1) + 1;
      if (left >= this.len) break;
      const right = left + 1;
      const child =
        right < this.len && this.pri[right] < this.pri[left] ? right : left;
      if (lastPri <= this.pri[child]) break;
      this.pri[i] = this.pri[child];
      this.tiles[i] = this.tiles[child];
      i = child;
    }
    this.pri[i] = lastPri;
    this.tiles[i] = lastTile;
    return [topTile, topPri];
  }

  /** double the underlying storage */
  private grow(): void {
    const newCap = this.pri.length << 1;

    const newPri = new Float32Array(newCap);
    newPri.set(this.pri);
    this.pri = newPri;

    this.tiles.length = newCap;
  }
}
