import {
  AbstractGraph,
  AbstractGraphBuilder,
} from "../pathfinding/algorithms/AbstractGraph";
import { AStarWaterHierarchical } from "../pathfinding/algorithms/AStar.WaterHierarchical";
import { PathFinder } from "../pathfinding/types";
import { GameMap, TileRef } from "./GameMap";

const WATER_GRAPH_REBUILD_INTERVAL = 20;

export class WaterManager {
  private _miniWaterGraph: AbstractGraph | null = null;
  private _miniWaterHPA: AStarWaterHierarchical | null = null;
  private _waterGraphVersion: number = 0;
  private _waterGraphDirty: boolean = false;
  private _waterGraphLastRebuildTick: number = 0;

  private _pendingWaterTiles: Set<TileRef> = new Set();

  // Reusable stamp-based distance tracking for magnitude BFS (avoids allocation per nuke)
  private _waterDistArr: Uint16Array | null = null;
  private _waterStampArr: Uint16Array | null = null;
  private _waterStamp: number = 0;

  constructor(
    private map: GameMap,
    private miniMap: GameMap,
    private disableNavMesh: boolean,
  ) {
    if (!disableNavMesh) {
      const graphBuilder = new AbstractGraphBuilder(miniMap);
      this._miniWaterGraph = graphBuilder.build();
      this._miniWaterHPA = new AStarWaterHierarchical(
        miniMap,
        this._miniWaterGraph,
        { cachePaths: true },
      );
    }
  }

  queueTile(tile: TileRef): void {
    this._pendingWaterTiles.add(tile);
  }

  /**
   * Flush pending water conversions, run terrain fixup (ocean/magnitude/shoreline/minimap),
   * and throttled graph rebuild. Returns tiles whose terrain changed (for recording).
   */
  tick(currentTick: number): TileRef[] {
    const changedTiles: TileRef[] = [];

    if (this._pendingWaterTiles.size > 0) {
      const converted: TileRef[] = [];
      for (const tile of this._pendingWaterTiles) {
        // Tile may have been conquered between queueing and flushing
        if (this.map.isLand(tile) && !this.map.hasOwner(tile)) {
          if (this.map.hasFallout(tile)) {
            this.map.setFallout(tile, false);
          }
          this.map.setWater(tile);
          converted.push(tile);
        }
      }
      this._pendingWaterTiles.clear();
      if (converted.length > 0) {
        this.finalizeWaterChanges(converted, changedTiles);
      }
    }

    // Throttled water graph rebuild: at most once every 20 ticks
    if (
      this._waterGraphDirty &&
      !this.disableNavMesh &&
      currentTick - this._waterGraphLastRebuildTick >=
        WATER_GRAPH_REBUILD_INTERVAL
    ) {
      this._waterGraphDirty = false;
      this._waterGraphLastRebuildTick = currentTick;
      const graphBuilder = new AbstractGraphBuilder(this.miniMap);
      this._miniWaterGraph = graphBuilder.build();
      this._miniWaterHPA = new AStarWaterHierarchical(
        this.miniMap,
        this._miniWaterGraph,
        { cachePaths: true },
      );
      this._waterGraphVersion++;
    }

    return changedTiles;
  }

  waterGraphVersion(): number {
    return this._waterGraphVersion;
  }

  miniWaterHPA(): PathFinder<number> | null {
    return this._miniWaterHPA;
  }

  miniWaterGraph(): AbstractGraph | null {
    return this._miniWaterGraph;
  }

  getWaterComponent(tile: TileRef): number | null {
    // Permissive fallback for tests with disableNavMesh
    if (!this._miniWaterGraph) return 0;

    const miniX = Math.floor(this.map.x(tile) / 2);
    const miniY = Math.floor(this.map.y(tile) / 2);
    const miniTile = this.miniMap.ref(miniX, miniY);

    if (this.miniMap.isWater(miniTile)) {
      return this._miniWaterGraph.getComponentId(miniTile);
    }

    // Shore tile: find water neighbor (expand search for minimap resolution loss)
    for (const n of this.miniMap.neighbors(miniTile)) {
      if (this.miniMap.isWater(n)) {
        return this._miniWaterGraph.getComponentId(n);
      }
    }

    // Extended search: check 2-hop neighbors for narrow straits
    for (const n of this.miniMap.neighbors(miniTile)) {
      for (const n2 of this.miniMap.neighbors(n)) {
        if (this.miniMap.isWater(n2)) {
          return this._miniWaterGraph.getComponentId(n2);
        }
      }
    }
    return null;
  }

  hasWaterComponent(tile: TileRef, component: number): boolean {
    // Permissive fallback for tests with disableNavMesh
    if (!this._miniWaterGraph) return true;

    const miniX = Math.floor(this.map.x(tile) / 2);
    const miniY = Math.floor(this.map.y(tile) / 2);
    const miniTile = this.miniMap.ref(miniX, miniY);

    // Check miniTile itself (shore in full map may be water in minimap)
    if (
      this.miniMap.isWater(miniTile) &&
      this._miniWaterGraph.getComponentId(miniTile) === component
    ) {
      return true;
    }

    // Check neighbors
    for (const n of this.miniMap.neighbors(miniTile)) {
      if (
        this.miniMap.isWater(n) &&
        this._miniWaterGraph.getComponentId(n) === component
      ) {
        return true;
      }
    }

    // Extended search: check 2-hop neighbors for narrow straits
    for (const n of this.miniMap.neighbors(miniTile)) {
      for (const n2 of this.miniMap.neighbors(n)) {
        if (
          this.miniMap.isWater(n2) &&
          this._miniWaterGraph.getComponentId(n2) === component
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private finalizeWaterChanges(
    convertedTiles: TileRef[],
    changedTiles: TileRef[],
  ): void {
    const converted = new Set<TileRef>(convertedTiles);
    if (converted.size === 0) return;

    const map = this.map;
    const w = map.width();
    const totalTiles = w * map.height();

    // Track changed tiles in a set for dedup, drain into output at end
    const changed = new Set<TileRef>();
    // All converted tiles definitely changed (they just became water).
    for (const tile of converted) changed.add(tile);

    // Inline neighbor helper (no allocation, cardinal only)
    const pushNeighbors = (
      tile: TileRef,
      out: TileRef[],
      start: number,
    ): number => {
      if (tile >= w) out[start++] = (tile - w) as TileRef;
      if (tile < totalTiles - w) out[start++] = (tile + w) as TileRef;
      const x = tile % w;
      if (x > 0) out[start++] = (tile - 1) as TileRef;
      if (x < w - 1) out[start++] = (tile + 1) as TileRef;
      return start;
    };

    // Reusable scratch buffer for neighbors.
    const nb: TileRef[] = new Array(8);

    // ── 1. Propagate ocean bit ─────────────────────────────────────
    const oceanQueue: TileRef[] = [];
    for (const tile of converted) {
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        if (!converted.has(nb[i]) && map.isOcean(nb[i])) {
          map.setOcean(tile);
          oceanQueue.push(tile);
          break;
        }
      }
    }
    // If no converted tile is adjacent to existing ocean (e.g. all-land map),
    // mark all converted tiles as ocean so they're navigable for ports/boats.
    if (oceanQueue.length === 0) {
      for (const tile of converted) {
        map.setOcean(tile);
        oceanQueue.push(tile);
      }
    }
    let oHead = 0;
    while (oHead < oceanQueue.length) {
      const tile = oceanQueue[oHead++];
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        if (map.isWater(nb[i]) && !map.isOcean(nb[i])) {
          map.setOcean(nb[i]);
          changed.add(nb[i]);
          oceanQueue.push(nb[i]);
        }
      }
    }

    // ── 2. Recompute magnitude via BFS from remaining land outward ─
    if (!this._waterDistArr || this._waterDistArr.length !== totalTiles) {
      this._waterDistArr = new Uint16Array(totalTiles);
      this._waterStampArr = new Uint16Array(totalTiles);
      this._waterStamp = 0;
    }
    this._waterStamp++;
    if (this._waterStamp >= 0xffff) {
      this._waterStampArr!.fill(0);
      this._waterStamp = 1;
    }
    const stamp = this._waterStamp;
    const stampArr = this._waterStampArr!;
    const distArr = this._waterDistArr;

    const magQueue: TileRef[] = [];

    // Seed candidates: converted tiles + their immediate water neighbors
    const seedCandidates = new Set<TileRef>(converted);
    for (const tile of converted) {
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        if (map.isWater(nb[i]) && !converted.has(nb[i])) {
          seedCandidates.add(nb[i]);
        }
      }
    }
    // Seed: water tiles adjacent to remaining land get distance 0
    for (const tile of seedCandidates) {
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        if (map.isLand(nb[i])) {
          if (stampArr[tile] !== stamp) {
            stampArr[tile] = stamp;
            distArr[tile] = 0;
            if (map.magnitude(tile) !== 0) {
              map.setMagnitude(tile, 0);
              changed.add(tile);
            }
            magQueue.push(tile);
          }
          break;
        }
      }
    }
    // BFS outward through water, stopping at convergence.
    let magHead = 0;
    while (magHead < magQueue.length) {
      const tile = magQueue[magHead++];
      const dist = distArr[tile];
      const nextDist = dist + 1;
      const nextMag = Math.min(Math.ceil(nextDist / 2), 31);
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        const n = nb[i];
        if (!map.isWater(n) || stampArr[n] === stamp) continue;
        const oldMag = map.magnitude(n);
        if (oldMag === nextMag && !seedCandidates.has(n)) continue;
        stampArr[n] = stamp;
        distArr[n] = nextDist;
        magQueue.push(n);
        if (oldMag !== nextMag) {
          map.setMagnitude(n, nextMag);
          changed.add(n);
        }
      }
    }
    // Phase 2: unreached seed candidates (fully destroyed island)
    const MAX_DEEP_DIST = 30;
    const DEEP_OCEAN_MAGNITUDE = 20;
    const deepQueue: TileRef[] = [];
    for (const tile of seedCandidates) {
      if (stampArr[tile] !== stamp && map.isWater(tile)) {
        stampArr[tile] = stamp;
        distArr[tile] = 0;
        if (map.magnitude(tile) !== DEEP_OCEAN_MAGNITUDE) {
          map.setMagnitude(tile, DEEP_OCEAN_MAGNITUDE);
          changed.add(tile);
        }
        deepQueue.push(tile);
      }
    }
    let deepHead = 0;
    while (deepHead < deepQueue.length) {
      const tile = deepQueue[deepHead++];
      const dist = distArr[tile];
      if (dist >= MAX_DEEP_DIST) continue;
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        const n = nb[i];
        if (!map.isWater(n) || stampArr[n] === stamp) continue;
        const oldMag = map.magnitude(n);
        if (oldMag >= DEEP_OCEAN_MAGNITUDE) continue;
        stampArr[n] = stamp;
        distArr[n] = dist + 1;
        map.setMagnitude(n, DEEP_OCEAN_MAGNITUDE);
        changed.add(n);
        deepQueue.push(n);
      }
    }

    // ── 3. Fix shoreline bits ──────────────────────────────────────
    const tilesToCheck = new Set<TileRef>();
    for (const tile of converted) {
      tilesToCheck.add(tile);
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        tilesToCheck.add(nb[i]);
        const end2 = pushNeighbors(nb[i], nb, end);
        for (let j = end; j < end2; j++) {
          tilesToCheck.add(nb[j]);
        }
      }
    }
    for (let i = 0; i < magQueue.length; i++) {
      const tile = magQueue[i];
      tilesToCheck.add(tile);
      const end = pushNeighbors(tile, nb, 0);
      for (let j = 0; j < end; j++) {
        tilesToCheck.add(nb[j]);
      }
    }
    for (const tile of tilesToCheck) {
      const tileIsLand = map.isLand(tile);
      let hasOpposite = false;
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        if (map.isLand(nb[i]) !== tileIsLand) {
          hasOpposite = true;
          break;
        }
      }
      const oldShoreline = map.isShoreline(tile);
      if (hasOpposite) {
        if (!oldShoreline) {
          map.setShorelineBit(tile);
          changed.add(tile);
        }
      } else {
        if (oldShoreline) {
          map.clearShorelineBit(tile);
          changed.add(tile);
        }
      }
    }

    // ── 4. Update minimap terrain ──────────────────────────────────
    const miniTilesToCheck = new Set<TileRef>();
    const convertedMiniTiles = new Set<TileRef>();
    for (const tile of converted) {
      const miniX = Math.floor(map.x(tile) / 2);
      const miniY = Math.floor(map.y(tile) / 2);
      if (this.miniMap.isValidCoord(miniX, miniY)) {
        miniTilesToCheck.add(this.miniMap.ref(miniX, miniY));
      }
    }
    for (const miniTile of miniTilesToCheck) {
      if (!this.miniMap.isLand(miniTile)) continue;
      const fx = this.miniMap.x(miniTile) * 2;
      const fy = this.miniMap.y(miniTile) * 2;
      let waterCount = 0;
      let totalCount = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (map.isValidCoord(fx + dx, fy + dy)) {
            totalCount++;
            if (map.isWater(map.ref(fx + dx, fy + dy))) {
              waterCount++;
            }
          }
        }
      }
      if (waterCount >= Math.min(3, totalCount)) {
        this.miniMap.setWater(miniTile);
        convertedMiniTiles.add(miniTile);
      }
    }

    // ── 5. Mark water graph dirty (rebuilt lazily, throttled) ─────
    if (convertedMiniTiles.size > 0) {
      this._waterGraphDirty = true;
    }

    // Drain changed set into output array
    for (const tile of changed) {
      changedTiles.push(tile);
    }
  }
}
