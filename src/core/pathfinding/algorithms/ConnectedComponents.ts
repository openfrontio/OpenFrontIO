// Connected Component Labeling using flood-fill

import { GameMap, TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";

export const LAND_MARKER = 0xff; // Must fit in Uint8Array

/**
 * Connected component labeling for grid-based maps.
 * Identifies isolated regions using scan-line flood-fill.
 */
export class ConnectedComponents {
  private readonly width: number;
  private readonly height: number;
  private readonly numTiles: number;
  private readonly lastRowStart: number;
  private readonly queue: Int32Array;
  private componentIds: Uint8Array | Uint16Array | null = null;

  // Union-find for incremental component merging
  private ufParent: number[] = [];
  private ufRank: number[] = [];
  private nextId: number = 0;
  private ufActive: boolean = false;

  constructor(
    private readonly map: GameMap,
    private readonly accessTerrainDirectly: boolean = true,
  ) {
    this.width = map.width();
    this.height = map.height();
    this.numTiles = this.width * this.height;
    this.lastRowStart = (this.height - 1) * this.width;
    this.queue = new Int32Array(this.numTiles);
  }

  initialize(): void {
    DebugSpan.start("ConnectedComponents:initialize");
    let ids: Uint8Array | Uint16Array = this.createPrefilledIds();

    let nextId = 0;

    // Scan all tiles and flood-fill each unvisited water component
    for (let start = 0; start < this.numTiles; start++) {
      const value = ids[start];

      // Skip if already visited (land=0xFF or water component >0)
      if (value === LAND_MARKER || value > 0) {
        continue;
      }

      nextId++;

      // Dynamically upgrade to Uint16Array when we hit component 254
      if (nextId === 254 && ids instanceof Uint8Array) {
        ids = this.upgradeToUint16Array(ids);
      }

      this.floodFillComponent(ids, start, nextId);
    }

    this.componentIds = ids;
    this.nextId = nextId;
    DebugSpan.end();
  }

  /**
   * Initialize union-find structures from existing component IDs.
   * Must be called after initialize() before using addWaterTiles().
   */
  initializeUnionFind(): void {
    this.ufParent = new Array(this.nextId + 1);
    this.ufRank = new Array(this.nextId + 1).fill(0);
    for (let i = 0; i <= this.nextId; i++) {
      this.ufParent[i] = i;
    }
    this.ufActive = true;
  }

  /**
   * Union-find: find canonical representative with path halving.
   */
  private find(id: number): number {
    while (this.ufParent[id] !== id) {
      this.ufParent[id] = this.ufParent[this.ufParent[id]];
      id = this.ufParent[id];
    }
    return id;
  }

  /**
   * Union-find: merge two components. Returns the canonical ID.
   */
  private union(a: number, b: number): number {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return a;
    if (this.ufRank[a] < this.ufRank[b]) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    this.ufParent[b] = a;
    if (this.ufRank[a] === this.ufRank[b]) this.ufRank[a]++;
    return a;
  }

  /**
   * Incrementally add newly converted water tiles.
   * BFS through connected new tiles, assigning them to adjacent existing
   * components or creating new ones. Merges components when new water
   * bridges previously separate bodies.
   */
  addWaterTiles(newTiles: Set<TileRef>): void {
    if (!this.componentIds) return;
    if (!this.ufActive) this.initializeUnionFind();

    let ids = this.componentIds;
    const w = this.width;

    // Mark new tiles as unassigned water (0)
    for (const tile of newTiles) {
      ids[tile] = 0;
    }

    // BFS through connected groups of new water tiles.
    // Each group gets a fresh component ID immediately (no VISITED marker)
    // to avoid Uint8Array truncation issues.
    for (const startTile of newTiles) {
      if (ids[startTile] !== 0) continue; // already assigned by previous group

      // Allocate a fresh component ID for this group
      this.nextId++;

      // Upgrade to Uint16Array when approaching Uint8 capacity
      if (this.nextId >= 254 && ids instanceof Uint8Array) {
        ids = this.upgradeToUint16Array(ids);
        this.componentIds = ids;
      }

      let groupId = this.nextId;
      if (this.ufParent.length <= groupId) {
        this.ufParent.length = groupId + 1;
        this.ufRank.length = groupId + 1;
      }
      this.ufParent[groupId] = groupId;
      this.ufRank[groupId] = 0;

      const group: number[] = [];
      let head = 0;

      ids[startTile] = groupId;
      group.push(startTile);

      while (head < group.length) {
        const t = group[head++];

        // Check 4 neighbors
        // Up
        if (t >= w) {
          const n = t - w;
          const nId = ids[n];
          if (nId === 0) {
            ids[n] = groupId;
            group.push(n);
          } else if (
            nId !== LAND_MARKER &&
            this.find(nId) !== this.find(groupId)
          ) {
            groupId = this.union(groupId, nId);
          }
        }
        // Down
        if (t < this.lastRowStart) {
          const n = t + w;
          const nId = ids[n];
          if (nId === 0) {
            ids[n] = groupId;
            group.push(n);
          } else if (
            nId !== LAND_MARKER &&
            this.find(nId) !== this.find(groupId)
          ) {
            groupId = this.union(groupId, nId);
          }
        }
        // Left
        if (t % w > 0) {
          const n = t - 1;
          const nId = ids[n];
          if (nId === 0) {
            ids[n] = groupId;
            group.push(n);
          } else if (
            nId !== LAND_MARKER &&
            this.find(nId) !== this.find(groupId)
          ) {
            groupId = this.union(groupId, nId);
          }
        }
        // Right
        if (t % w < w - 1) {
          const n = t + 1;
          const nId = ids[n];
          if (nId === 0) {
            ids[n] = groupId;
            group.push(n);
          } else if (
            nId !== LAND_MARKER &&
            this.find(nId) !== this.find(groupId)
          ) {
            groupId = this.union(groupId, nId);
          }
        }
      }

      // Update all tiles in group to the final canonical ID
      const finalId = this.find(groupId);
      for (let i = 0; i < group.length; i++) {
        ids[group[i]] = finalId;
      }
    }
  }

  /**
   * Create and prefill a Uint8Array with land markers.
   * Uses direct terrain access for performance.
   */
  private createPrefilledIds(): Uint8Array {
    const ids = new Uint8Array(this.numTiles);

    if (this.accessTerrainDirectly) {
      this.premarkLandTilesDirect(ids);
    } else {
      this.premarkLandTiles(ids);
    }

    return ids;
  }

  /**
   * Pre-mark all land tiles in the ids array.
   * Land tiles are marked with 0xFF, water tiles remain 0.
   */
  private premarkLandTiles(ids: Uint8Array): void {
    for (let i = 0; i < this.numTiles; i++) {
      ids[i] = this.map.isWater(i) ? 0 : LAND_MARKER;
    }
  }

  /**
   * Pre-mark all land tiles in the ids array.
   * Land tiles are marked with 0xFF, water tiles remain 0.
   *
   * This implementation accesses the terrain data **directly** without GameMap abstraction.
   * In tests it is 30% to 50% faster than using isWater() method calls.
   * As of 2026-01-05 it reduces avg. time for GWM from 15ms to 10ms.
   */
  private premarkLandTilesDirect(ids: Uint8Array): void {
    const terrain = (this.map as any).terrain as Uint8Array;

    // Write 4 bytes at once using Uint32Array view for better performance
    const numChunks = Math.floor(this.numTiles / 4);
    const terrain32 = new Uint32Array(
      terrain.buffer,
      terrain.byteOffset,
      numChunks,
    );
    const ids32 = new Uint32Array(ids.buffer, ids.byteOffset, numChunks);

    for (let i = 0; i < numChunks; i++) {
      const chunk = terrain32[i];

      // Extract bit 7 from each byte, negate, and combine into single 32-bit write
      // bit 7 = 0 (water) → -(0) = 0x00
      // bit 7 = 1 (land)  → -(1) = 0xFF (truncated to 8 bits)
      const b0 = -((chunk >> 7) & 1) & 0xff;
      const b1 = -((chunk >> 15) & 1) & 0xff;
      const b2 = -((chunk >> 23) & 1) & 0xff;
      const b3 = -((chunk >> 31) & 1); // Upper byte, no mask needed

      ids32[i] = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    // Handle remaining tiles (when numTiles not divisible by 4)
    for (let i = numChunks * 4; i < this.numTiles; i++) {
      ids[i] = -(terrain[i] >> 7);
    }
  }

  /**
   * Upgrade from Uint8Array to Uint16Array when we exceed 254 components.
   * Direct copy works because both use 0xFF for land marker.
   */
  private upgradeToUint16Array(ids: Uint8Array): Uint16Array {
    const newIds = new Uint16Array(this.numTiles);
    for (let i = 0; i < this.numTiles; i++) {
      newIds[i] = ids[i];
    }
    return newIds;
  }

  /**
   * Flood-fill a single connected water component using scan-line algorithm.
   * Processes horizontal spans of tiles for better memory locality and cache performance.
   *
   * Note: Land tiles are pre-marked, so ids[x] === 0 guarantees water tile.
   */
  private floodFillComponent(
    ids: Uint8Array | Uint16Array,
    start: number,
    componentId: number,
  ): void {
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;

    while (head < tail) {
      const seed = this.queue[head++]!;

      // Skip if already processed
      if (ids[seed] !== 0) continue;

      // Scan left to find the start of this horizontal water span
      // No isWaterFast check needed - ids[x] === 0 guarantees water
      let left = seed;
      const rowStart = seed - (seed % this.width);
      while (left > rowStart && ids[left - 1] === 0) {
        left--;
      }

      // Scan right to find the end of this horizontal water span
      let right = seed;
      const rowEnd = rowStart + this.width - 1;
      while (right < rowEnd && ids[right + 1] === 0) {
        right++;
      }

      // Fill the entire horizontal span and check above/below for new spans
      for (let x = left; x <= right; x++) {
        ids[x] = componentId;

        // Check tile above (if not in first row)
        if (x >= this.width) {
          const above = x - this.width;
          if (ids[above] === 0) {
            this.queue[tail++] = above;
          }
        }

        // Check tile below (if not in last row)
        if (x < this.lastRowStart) {
          const below = x + this.width;
          if (ids[below] === 0) {
            this.queue[tail++] = below;
          }
        }
      }
    }
  }

  /**
   * Get the component ID for a tile.
   * Returns 0 for land tiles or if not initialized.
   * Resolves through union-find when active.
   */
  getComponentId(tile: TileRef): number {
    if (!this.componentIds) return 0;
    const raw = this.componentIds[tile] ?? 0;
    if (!this.ufActive || raw === LAND_MARKER || raw === 0) return raw;
    return this.find(raw);
  }
}
