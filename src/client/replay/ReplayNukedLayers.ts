/**
 * Nuke damage on the map's decoration layers (forests, cities) in a replay.
 * The live client marks a nukeable layer's tiles destroyed as impacts come
 * in (WebGLFrameBuilder.syncNukeImpacts). Playing on, or seeking forward,
 * does the same with the impacts it passes. Seeking back rebuilds each
 * layer's mask from every impact up to the frame, so the layer comes back.
 */

import type { MapLayer } from "../../core/game/TerrainMapLoader";
import type { NukeImpactEvent } from "./codec/ReplayTypes";

/** The MapRenderer calls this needs. */
export interface LayerDamageSink {
  markLayerTilesDestroyed(layerId: string, tiles: number[]): void;
  setLayerDestroyedMask(layerId: string, mask: Uint8Array): void;
}

export class ReplayNukedLayers {
  private readonly layers: MapLayer[];
  /** One reused mask per layer, for rebuilds. */
  private readonly masks: Uint8Array[];
  /** Impacts the layers show (a prefix of `impacts`), -1 before the first. */
  private applied = -1;

  constructor(
    layers: readonly MapLayer[],
    mapSize: number,
    /** The replay's impacts in tick order. Grows as appends arrive. */
    private readonly impacts: readonly NukeImpactEvent[],
    private readonly sink: LayerDamageSink,
  ) {
    this.layers = layers.filter((l) => l.nukeable === true);
    this.masks = this.layers.map(() => new Uint8Array(mapSize));
  }

  /** The next frame in sequence: this tick's impacts. */
  advance(tick: number): void {
    if (this.layers.length === 0) return;
    const from = this.firstAt(tick);
    const to = this.firstAt(tick + 1);
    this.mark(from, to);
    this.applied = to;
  }

  /**
   * A seek: every impact up to and including `tick`. Seeking forward marks
   * the impacts passed on the way, and a seek that passes none changes
   * nothing, so dragging the timeline doesn't rebuild the masks each time.
   */
  seek(tick: number): void {
    if (this.layers.length === 0) return;
    const to = this.firstAt(tick + 1);
    if (this.applied >= 0 && to >= this.applied) {
      this.mark(this.applied, to);
    } else {
      this.layers.forEach((layer, l) => {
        const mask = this.masks[l];
        mask.fill(0);
        for (let i = 0; i < to; i++) {
          for (const t of tilesFor(layer, this.impacts[i])) mask[t] = 1;
        }
        this.sink.setLayerDestroyedMask(layer.id, mask);
      });
    }
    this.applied = to;
  }

  /** Mark impacts [from, to) on the layers they hit. */
  private mark(from: number, to: number): void {
    for (let i = from; i < to; i++) {
      for (const layer of this.layers) {
        const tiles = tilesFor(layer, this.impacts[i]);
        if (tiles.length > 0)
          this.sink.markLayerTilesDestroyed(layer.id, tiles);
      }
    }
  }

  /** Index of the first impact at or after `tick`. */
  private firstAt(tick: number): number {
    let lo = 0;
    let hi = this.impacts.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.impacts[mid].tick < tick) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

/** A water layer only loses water tiles, a land layer land tiles. */
function tilesFor(layer: MapLayer, impact: NukeImpactEvent): number[] {
  return layer.placement === "water" ? impact.water : impact.land;
}
