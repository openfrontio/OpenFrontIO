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
  private _dirtyMiniTiles: Set<TileRef> = new Set();

  // Reusable stamp-based distance tracking for magnitude BFS (avoids allocation per nuke)
  private _waterDistArr: Uint16Array | null = null;
  private _waterStampArr: Uint16Array | null = null;
  private _waterStamp: number = 0;

  // Separate stamp arrays for minimap magnitude BFS (runs after full-map BFS)
  private _miniDistArr: Uint16Array | null = null;
  private _miniStampArr: Uint16Array | null = null;
  private _miniStamp: number = 0;

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
        if (
          this.map.isLand(tile) &&
          !this.map.hasOwner(tile) &&
          !this.map.isImpassable(tile)
        ) {
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
      const graphBuilder = new AbstractGraphBuilder(
        this.miniMap,
        AbstractGraphBuilder.CLUSTER_SIZE,
        this._miniWaterGraph ?? undefined,
        this._dirtyMiniTiles.size > 0 ? this._dirtyMiniTiles : undefined,
      );
      this._miniWaterGraph = graphBuilder.build();
      this._dirtyMiniTiles.clear();
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

  /**
   * Returns the approximate number of water tiles in the component
   * containing `tile`, or null if the tile has no water component.
   *
   * The underlying ConnectedComponents are computed on the 2× downsampled
   * minimap, so each minimap tile represents up to 4 full-map tiles.  We
   * multiply by 4 to give callers a value in full-map-tile units.
   */
  getWaterComponentSize(tile: TileRef): number | null {
    const componentId = this.getWaterComponent(tile);
    if (componentId === null) return null;
    if (!this._miniWaterGraph) return 0;
    return this._miniWaterGraph.getComponentSize(componentId) * 4;
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
    const h = map.height();

    // Magnitude BFS: recompute ceil(manhattan_dist_to_nearest_coast / 2)
    // for tiles affected by the nuke.
    //
    // Dirty box (±MAX_MAG_DIST from crater bounds): the region where
    // magnitudes may have changed.  Only tiles here get updated.
    //
    // Seed box (±2*MAX_MAG_DIST from crater bounds): coastlines here are
    // seeded for BFS.  This ensures that every coastline that could be
    // nearest to a dirty-box tile is included (a dirty-box tile is at most
    // MAX_MAG_DIST from the crater, and the nearest coast is at most
    // MAX_MAG_DIST from the tile, so the coast is at most 2*MAX_MAG_DIST
    // from the crater).
    //
    // The BFS runs WITHOUT convergence inside the seed box so that
    // wavefronts from distant coastlines correctly reach the dirty box.
    // BFS is clipped at the seed box boundary for performance.
    const MAX_MAG_DIST = 62; // magnitude 31 ≈ 62 tile hops from coast
    let cMinX = w,
      cMaxX = 0,
      cMinY = h,
      cMaxY = 0;
    for (const tile of converted) {
      const tx = tile % w;
      const ty = (tile - tx) / w;
      if (tx < cMinX) cMinX = tx;
      if (tx > cMaxX) cMaxX = tx;
      if (ty < cMinY) cMinY = ty;
      if (ty > cMaxY) cMaxY = ty;
    }
    // Dirty box: tiles whose magnitude may need updating.
    const dMinX = Math.max(0, cMinX - MAX_MAG_DIST);
    const dMaxX = Math.min(w - 1, cMaxX + MAX_MAG_DIST);
    const dMinY = Math.max(0, cMinY - MAX_MAG_DIST);
    const dMaxY = Math.min(h - 1, cMaxY + MAX_MAG_DIST);
    // Seed box: coastlines here are seeded; BFS is clipped here.
    const sMinX = Math.max(0, cMinX - MAX_MAG_DIST * 2);
    const sMaxX = Math.min(w - 1, cMaxX + MAX_MAG_DIST * 2);
    const sMinY = Math.max(0, cMinY - MAX_MAG_DIST * 2);
    const sMaxY = Math.min(h - 1, cMaxY + MAX_MAG_DIST * 2);

    // Seed from coastline water tiles inside the seed box.
    // Impassable terrain is void (like the map edge), so water tiles
    // adjacent only to impassable terrain are NOT coastline — they should
    // be uniformly deep with no depth gradient.
    for (let by = sMinY; by <= sMaxY; by++) {
      const rowStart = by * w;
      for (let bx = sMinX; bx <= sMaxX; bx++) {
        const tile = (rowStart + bx) as TileRef;
        if (!map.isWater(tile) || stampArr[tile] === stamp) continue;
        const end = pushNeighbors(tile, nb, 0);
        for (let i = 0; i < end; i++) {
          if (map.isLand(nb[i]) && !map.isImpassable(nb[i])) {
            stampArr[tile] = stamp;
            distArr[tile] = 0;
            magQueue.push(tile);
            break;
          }
        }
      }
    }

    // BFS outward through water, clipped to seed box.
    // No convergence — every reachable tile inside the seed box is visited
    // to ensure correct shortest distances reach the dirty box.
    // Only DIRTY BOX tiles get their magnitude updated.
    let magHead = 0;
    while (magHead < magQueue.length) {
      const tile = magQueue[magHead++];
      const dist = distArr[tile];
      const nextDist = dist + 1;
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        const n = nb[i];
        if (!map.isWater(n) || stampArr[n] === stamp) continue;
        // Clip to seed box
        const nx = n % w;
        const ny = (n - nx) / w;
        if (nx < sMinX || nx > sMaxX || ny < sMinY || ny > sMaxY) continue;
        stampArr[n] = stamp;
        distArr[n] = nextDist;
        magQueue.push(n);
      }
    }

    // Update magnitudes only for dirty-box tiles.
    for (let dy = dMinY; dy <= dMaxY; dy++) {
      const rowStart = dy * w;
      for (let dx = dMinX; dx <= dMaxX; dx++) {
        const tile = (rowStart + dx) as TileRef;
        if (!map.isWater(tile)) continue;
        const oldMag = map.magnitude(tile);
        let newMag: number;
        if (stampArr[tile] === stamp) {
          // Reached by BFS — compute magnitude from distance
          newMag = Math.min(Math.ceil(distArr[tile] / 2), 31);
        } else {
          // Unreached: nearest coast is >MAX_MAG_DIST away → magnitude 31
          newMag = 31;
        }
        if (oldMag !== newMag) {
          map.setMagnitude(tile, newMag);
          changed.add(tile);
        }
      }
    }

    // ── 3. Fix shoreline bits ──────────────────────────────────────
    // Only converted tiles changed terrain type (land→water), so only
    // they and their 2-ring neighborhood can have shoreline bit changes.
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
    for (const tile of tilesToCheck) {
      // Impassable tiles never get shoreline — they render as the map
      // background, so no sand/water outline should appear around them.
      if (map.isImpassable(tile)) {
        if (map.isShoreline(tile)) {
          map.clearShorelineBit(tile);
          changed.add(tile);
        }
        continue;
      }
      const tileIsLand = map.isLand(tile);
      let hasOpposite = false;
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        // Impassable neighbors don't create shorelines (void, not coast).
        if (map.isImpassable(nb[i])) continue;
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

    // ── 4b. Fix minimap ocean + magnitude for converted tiles ────
    // setWater() zeros the terrain byte (magnitude = 0, ocean = 0).
    // This makes the pathfinder treat nuked water as "too close to
    // shore" (3× cost penalty via getMagnitudePenalty) and prevents
    // LOS smoothing through the crater.  Propagate ocean bits from
    // existing neighbours and recompute minimap magnitudes via BFS
    // from all coastlines (including the new crater edges).
    if (convertedMiniTiles.size > 0) {
      const miniW = this.miniMap.width();
      const miniH = this.miniMap.height();

      // Allocation-free cardinal-neighbor helper for all minimap BFSes.
      // Writes up to 4 neighbors into `out` and returns the count.
      const pushMiniNeighbors = (tile: TileRef, out: TileRef[]): number => {
        const x = tile % miniW;
        const y = (tile - x) / miniW;
        let count = 0;
        if (y > 0) out[count++] = (tile - miniW) as TileRef;
        if (y < miniH - 1) out[count++] = (tile + miniW) as TileRef;
        if (x > 0) out[count++] = (tile - 1) as TileRef;
        if (x < miniW - 1) out[count++] = (tile + 1) as TileRef;
        return count;
      };

      const miniNb: TileRef[] = new Array(4);

      // 4b-i. Propagate ocean bit to converted minimap tiles.
      // Uses BFS so that chains of converted tiles that connect to
      // the ocean all get marked, even if only the first tile in the
      // chain touches existing ocean.
      const miniOceanQueue: TileRef[] = [];
      for (const mt of convertedMiniTiles) {
        const nc = pushMiniNeighbors(mt, miniNb);
        let nearOcean = false;
        for (let i = 0; i < nc; i++) {
          if (this.miniMap.isOcean(miniNb[i])) {
            nearOcean = true;
            break;
          }
        }
        if (nearOcean) {
          this.miniMap.setOcean(mt);
          miniOceanQueue.push(mt);
        }
      }
      let moHead = 0;
      while (moHead < miniOceanQueue.length) {
        const tile = miniOceanQueue[moHead++];
        const nc = pushMiniNeighbors(tile, miniNb);
        for (let i = 0; i < nc; i++) {
          const n = miniNb[i];
          if (this.miniMap.isWater(n) && !this.miniMap.isOcean(n)) {
            this.miniMap.setOcean(n);
            miniOceanQueue.push(n);
          }
        }
      }

      // 4b-ii. Recompute minimap magnitude via BFS from coastlines.
      //
      // The previous approach (sampling full-map magnitudes) was wrong:
      // existing minimap water tiles at the edge of the crater retain
      // stale pre-computed magnitudes from the terrain file.  When a
      // nuke creates a new coastline nearby, these tiles should have
      // LOWER magnitude (closer to the new coast).  Only a BFS on the
      // minimap can correctly recompute them.
      //
      // Mirrors the full-map magnitude BFS (step 2) but runs on the
      // minimap.  Uses separate stamp/dist arrays to avoid conflicts.
      const miniTotal = miniW * this.miniMap.height();
      if (!this._miniDistArr || this._miniDistArr.length !== miniTotal) {
        this._miniDistArr = new Uint16Array(miniTotal);
        this._miniStampArr = new Uint16Array(miniTotal);
        this._miniStamp = 0;
      }
      this._miniStamp++;
      if (this._miniStamp >= 0xffff) {
        this._miniStampArr!.fill(0);
        this._miniStamp = 1;
      }
      const miniStamp = this._miniStamp;
      const miniStampArr = this._miniStampArr!;
      const miniDistArr = this._miniDistArr;

      // Crater bounding box on the full map, mapped to minimap coords.
      // MINI_MAX_MAG_DIST = max hops from coast = max_magnitude (31) × 2.
      const MINI_MAX_MAG_DIST = 62;
      let mcMinX = w,
        mcMaxX = 0,
        mcMinY = h,
        mcMaxY = 0;
      for (const tile of converted) {
        const tx = tile % w;
        const ty = (tile - tx) / w;
        if (tx < mcMinX) mcMinX = tx;
        if (tx > mcMaxX) mcMaxX = tx;
        if (ty < mcMinY) mcMinY = ty;
        if (ty > mcMaxY) mcMaxY = ty;
      }
      const mcMiniMinX = Math.floor(mcMinX / 2);
      const mcMiniMaxX = Math.floor(mcMaxX / 2);
      const mcMiniMinY = Math.floor(mcMinY / 2);
      const mcMiniMaxY = Math.floor(mcMaxY / 2);

      // Dirty box: minimap tiles whose magnitude may need updating.
      const mdMinX = Math.max(0, mcMiniMinX - MINI_MAX_MAG_DIST);
      const mdMaxX = Math.min(miniW - 1, mcMiniMaxX + MINI_MAX_MAG_DIST);
      const mdMinY = Math.max(0, mcMiniMinY - MINI_MAX_MAG_DIST);
      const mdMaxY = Math.min(
        this.miniMap.height() - 1,
        mcMiniMaxY + MINI_MAX_MAG_DIST,
      );
      // Seed box: coastlines here are seeded; BFS is clipped here.
      const msMinX = Math.max(0, mcMiniMinX - MINI_MAX_MAG_DIST * 2);
      const msMaxX = Math.min(miniW - 1, mcMiniMaxX + MINI_MAX_MAG_DIST * 2);
      const msMinY = Math.max(0, mcMiniMinY - MINI_MAX_MAG_DIST * 2);
      const msMaxY = Math.min(
        this.miniMap.height() - 1,
        mcMiniMaxY + MINI_MAX_MAG_DIST * 2,
      );

      // Seed from minimap coastline water tiles inside the seed box.
      // Coastline = water tile adjacent to at least one land tile.
      const miniMagQueue: TileRef[] = [];

      for (let by = msMinY; by <= msMaxY; by++) {
        const rowStart = by * miniW;
        for (let bx = msMinX; bx <= msMaxX; bx++) {
          const tile = (rowStart + bx) as TileRef;
          if (!this.miniMap.isWater(tile) || miniStampArr[tile] === miniStamp)
            continue;
          let isCoast = false;
          const nc = pushMiniNeighbors(tile, miniNb);
          for (let i = 0; i < nc; i++) {
            if (this.miniMap.isLand(miniNb[i])) {
              isCoast = true;
              break;
            }
          }
          if (isCoast) {
            miniStampArr[tile] = miniStamp;
            miniDistArr[tile] = 0;
            miniMagQueue.push(tile);
          }
        }
      }

      // BFS outward through water, clipped to seed box.
      let mmHead = 0;
      while (mmHead < miniMagQueue.length) {
        const tile = miniMagQueue[mmHead++];
        const nextDist = miniDistArr[tile] + 1;
        const nc = pushMiniNeighbors(tile, miniNb);
        for (let i = 0; i < nc; i++) {
          const n = miniNb[i];
          if (!this.miniMap.isWater(n) || miniStampArr[n] === miniStamp)
            continue;
          const nx = n % miniW;
          const ny = (n - nx) / miniW;
          if (nx < msMinX || nx > msMaxX || ny < msMinY || ny > msMaxY)
            continue;
          miniStampArr[n] = miniStamp;
          miniDistArr[n] = nextDist;
          miniMagQueue.push(n);
        }
      }

      // Update magnitudes for ALL minimap water tiles in the dirty box.
      for (let dy = mdMinY; dy <= mdMaxY; dy++) {
        const rowStart = dy * miniW;
        for (let dx = mdMinX; dx <= mdMaxX; dx++) {
          const tile = (rowStart + dx) as TileRef;
          if (!this.miniMap.isWater(tile)) continue;
          const oldMag = this.miniMap.magnitude(tile);
          let newMag: number;
          if (miniStampArr[tile] === miniStamp) {
            newMag = Math.min(Math.ceil(miniDistArr[tile] / 2), 31);
          } else {
            // Unreached: nearest coast is >MINI_MAX_MAG_DIST*2 away → deep water
            newMag = 31;
          }
          if (oldMag !== newMag) {
            this.miniMap.setMagnitude(tile, newMag);
          }
        }
      }
    }

    // ── 5. Mark water graph dirty (rebuilt lazily, throttled) ─────
    if (convertedMiniTiles.size > 0) {
      this._waterGraphDirty = true;
      for (const mt of convertedMiniTiles) {
        this._dirtyMiniTiles.add(mt);
      }
    }

    // Drain changed set into output array
    for (const tile of changed) {
      changedTiles.push(tile);
    }
  }
}
