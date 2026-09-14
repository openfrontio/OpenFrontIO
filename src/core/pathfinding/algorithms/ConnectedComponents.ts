// Connected Component Labeling using flood-fill

import { GameMap, TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";

export const LAND_MARKER = 0xff; // Uint8Array sentinel — upgraded to 0xFFFF on Uint16Array promotion
const LAND_MARKER_WIDE = 0xffff;

/**
 * Connected component labeling for grid-based maps.
 * Identifies isolated regions using scan-line flood-fill.
 */
export class ConnectedComponents {
  private readonly width: number;
  private readonly height: number;
  private readonly numTiles: number;
  private readonly lastRowStart: number;
  // Flood-fill work queue; exists only while initialize() runs — a
  // numTiles-sized Int32Array is ~8 MB per instance on large maps.
  private queue: Int32Array | null = null;
  private componentIds: Uint8Array | Uint16Array | null = null;
  private _componentSizes: number[] = [];

  // Incremental update state (see addWaterTiles): water tiles are only
  // ever ADDED to the map (land→water via water nukes), so components can
  // only grow or merge — never split.  Merges are tracked with a
  // union-find alias table instead of relabeling tiles.
  private parents: number[] = [];
  private maxId = 0;
  private landMarker: number = LAND_MARKER;

  constructor(
    private readonly map: GameMap,
    private readonly accessTerrainDirectly: boolean = true,
  ) {
    this.width = map.width();
    this.height = map.height();
    this.numTiles = this.width * this.height;
    this.lastRowStart = (this.height - 1) * this.width;
  }

  initialize(): void {
    DebugSpan.start("ConnectedComponents:initialize");
    this.queue = new Int32Array(this.numTiles);
    let ids: Uint8Array | Uint16Array = this.createPrefilledIds();

    this._componentSizes = [];
    let nextId = 0;

    // Scan all tiles and flood-fill each unvisited water component
    for (let start = 0; start < this.numTiles; start++) {
      const value = ids[start];

      // Skip if already visited (land=0xFF or water component >0)
      if (value === LAND_MARKER || value > 0) {
        continue;
      }

      nextId++;

      // Dynamically upgrade to Uint16Array before assigning component 254,
      // because 0xFF (component 254 in Uint8Array) collides with LAND_MARKER.
      if (nextId === 253 && ids instanceof Uint8Array) {
        ids = this.upgradeToUint16Array(ids);
      }

      // Cap at 0xFFFE — 0xFFFF is reserved as LAND_MARKER_WIDE after
      // Uint16Array promotion and must not be assigned to a real component.
      if (nextId === 0xffff) {
        break;
      }

      this.floodFillComponent(ids, start, nextId);
    }

    this.componentIds = ids;
    this.queue = null;

    // Set up union-find state for incremental updates
    this.landMarker =
      ids instanceof Uint16Array ? LAND_MARKER_WIDE : LAND_MARKER;
    this.maxId = nextId;
    this.parents = new Array(nextId + 1);
    for (let i = 0; i <= nextId; i++) this.parents[i] = i;

    DebugSpan.end();
  }

  /**
   * Incrementally add newly converted water tiles (land→water).
   *
   * Because water is only ever added, a new water tile either joins an
   * adjacent component, merges several adjacent components (bridging),
   * or starts a new component (isolated crater).  Merges are recorded in
   * a union-find alias table, so no tiles need relabeling and the cost
   * is O(tiles added) instead of a full-map flood fill.
   *
   * Tiles must already be water in the map. No-op before initialize().
   */
  addWaterTiles(tiles: Iterable<TileRef>): void {
    if (!this.componentIds) return;

    for (const tile of tiles) {
      let ids = this.componentIds;
      if (ids[tile] !== this.landMarker) continue; // already labeled water

      // Collect distinct component roots among cardinal water neighbors
      const x = tile % this.width;
      let r0 = 0;
      let r1 = 0;
      let r2 = 0;
      let r3 = 0;
      if (tile >= this.width) r0 = this.rootAt(tile - this.width);
      if (tile < this.lastRowStart) r1 = this.rootAt(tile + this.width);
      if (x > 0) r2 = this.rootAt(tile - 1);
      if (x < this.width - 1) r3 = this.rootAt(tile + 1);

      // Canonical id: smallest non-zero root (deterministic)
      let canon = 0;
      for (const r of [r0, r1, r2, r3]) {
        if (r !== 0 && (canon === 0 || r < canon)) canon = r;
      }

      if (canon === 0) {
        // Isolated new water: allocate a fresh component id
        const id = this.allocComponentId();
        ids = this.componentIds; // may have been upgraded to Uint16Array
        ids[tile] = id;
        this._componentSizes[id] = 1;
        continue;
      }

      ids[tile] = canon;
      this._componentSizes[canon] = (this._componentSizes[canon] ?? 0) + 1;

      // Union any other adjacent components into the canonical one
      for (const r of [r0, r1, r2, r3]) {
        if (r !== 0 && r !== canon && this.parents[r] !== canon) {
          this.parents[r] = canon;
          this._componentSizes[canon] =
            (this._componentSizes[canon] ?? 0) + (this._componentSizes[r] ?? 0);
          this._componentSizes[r] = 0;
        }
      }
    }
  }

  /** Component root of the water tile at index, or 0 if land/unlabeled. */
  private rootAt(index: number): number {
    const id = this.componentIds![index];
    if (id === 0 || id === this.landMarker) return 0;
    return this.find(id);
  }

  private find(id: number): number {
    const parents = this.parents;
    let root = id;
    while (parents[root] !== root) root = parents[root];
    // Path compression (pure optimization — resolved roots are identical)
    let cur = id;
    while (parents[cur] !== root) {
      const next = parents[cur];
      parents[cur] = root;
      cur = next;
    }
    return root;
  }

  private allocComponentId(): number {
    // Saturate at the last usable id (0xFFFF is the land marker after
    // Uint16Array promotion).  Unreachable in practice.
    if (this.maxId >= 0xfffe) return this.maxId;
    const id = ++this.maxId;
    if (id >= 253 && this.componentIds instanceof Uint8Array) {
      this.componentIds = this.upgradeToUint16Array(this.componentIds);
      this.landMarker = LAND_MARKER_WIDE;
    }
    this.parents[id] = id;
    return id;
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
   * Land tiles are marked with 0xFF (Uint8Array) or 0xFFFF (Uint16Array),
   * water tiles remain 0.
   */
  private premarkLandTiles(ids: Uint8Array): void {
    for (let i = 0; i < this.numTiles; i++) {
      ids[i] = this.map.isWater(i) ? 0 : 0xff;
    }
  }

  /**
   * Pre-mark all land tiles in the ids array using direct terrain access.
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
      const b0 = -((chunk >> 7) & 1) & 0xff;
      const b1 = -((chunk >> 15) & 1) & 0xff;
      const b2 = -((chunk >> 23) & 1) & 0xff;
      const b3 = -((chunk >> 31) & 1);
      ids32[i] = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    }

    for (let i = numChunks * 4; i < this.numTiles; i++) {
      ids[i] = -(terrain[i] >> 7);
    }
  }

  /**
   * Upgrade from Uint8Array to Uint16Array when we exceed 254 components.
   * Remaps 0xFF land markers to 0xFFFF so component id 255 is unambiguous.
   */
  private upgradeToUint16Array(ids: Uint8Array): Uint16Array {
    const newIds = new Uint16Array(this.numTiles);
    for (let i = 0; i < this.numTiles; i++) {
      newIds[i] = ids[i] === LAND_MARKER ? LAND_MARKER_WIDE : ids[i];
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
    const queue = this.queue!;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;

    while (head < tail) {
      const seed = queue[head++]!;

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
      const spanSize = right - left + 1;
      this._componentSizes[componentId] =
        (this._componentSizes[componentId] ?? 0) + spanSize;
      for (let x = left; x <= right; x++) {
        ids[x] = componentId;

        // Check tile above (if not in first row)
        if (x >= this.width) {
          const above = x - this.width;
          if (ids[above] === 0) {
            queue[tail++] = above;
          }
        }

        // Check tile below (if not in last row)
        if (x < this.lastRowStart) {
          const below = x + this.width;
          if (ids[below] === 0) {
            queue[tail++] = below;
          }
        }
      }
    }
  }

  getComponentId(tile: TileRef): number {
    if (!this.componentIds) return 0;
    const id = this.componentIds[tile] ?? 0;
    if (id === 0 || id === this.landMarker) return id;
    return this.find(id);
  }

  /** Returns the number of water tiles in the given component, or 0 if unknown. */
  getComponentSize(componentId: number): number {
    if (componentId <= 0 || componentId > this.maxId) return 0;
    return this._componentSizes[this.find(componentId)] ?? 0;
  }
}
