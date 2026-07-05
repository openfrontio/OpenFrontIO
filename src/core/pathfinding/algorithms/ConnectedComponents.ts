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
    DebugSpan.end();
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
    return this.componentIds[tile] ?? 0;
  }

  /** Returns the number of water tiles in the given component, or 0 if unknown. */
  getComponentSize(componentId: number): number {
    return this._componentSizes[componentId] ?? 0;
  }
}
