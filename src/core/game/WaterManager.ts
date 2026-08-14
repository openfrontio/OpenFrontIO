import {
  AbstractGraph,
  AbstractGraphBuilder,
} from "../pathfinding/algorithms/AbstractGraph";
import { AStarWaterHierarchical } from "../pathfinding/algorithms/AStar.WaterHierarchical";
import { BFSGrid } from "../pathfinding/algorithms/BFS.Grid";
import { ConnectedComponents } from "../pathfinding/algorithms/ConnectedComponents";
import { PathFinder } from "../pathfinding/types";
import { DebugSpan } from "../utilities/DebugSpan";
import { GameMap, TileRef } from "./GameMap";

const WATER_GRAPH_REBUILD_INTERVAL = 20;

// Max BFS hops from a coastline that can affect a magnitude value:
// magnitude = ceil(dist / 2) capped at 31, so 62 hops.
const MAX_MAG_DIST = 62;

// Direct terrain-byte masks, mirroring GameMapImpl's private constants
// (bit 7 = land, low 5 bits = magnitude, magnitude 31 on land = impassable).
// The magnitude BFS reads terrain bytes directly because method calls
// dominate its cost on large maps (same precedent as
// ConnectedComponents.premarkLandTilesDirect).
const TERRAIN_LAND_MASK = 0x80;
const TERRAIN_MAG_MASK = 0x1f;
const IMPASSABLE_MAG = 31;

interface CraterBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export class WaterManager {
  private _miniWaterGraph: AbstractGraph | null = null;
  private _miniWaterHPA: AStarWaterHierarchical | null = null;
  // Persistent minimap water components, updated incrementally as nukes
  // convert land→water (components only grow/merge, never split), so
  // graph rebuilds skip the full-minimap flood fill.
  private _miniWaterCC: ConnectedComponents | null = null;
  // Reusable minimap-sized BFS scratch for graph rebuilds (~20MB on
  // large maps — allocated once instead of per rebuild).
  private _builderBFS: BFSGrid | null = null;
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
      this._miniWaterCC = new ConnectedComponents(miniMap);
      this._miniWaterCC.initialize();
      this._builderBFS = new BFSGrid(miniMap.width() * miniMap.height());
      const graphBuilder = new AbstractGraphBuilder(
        miniMap,
        AbstractGraphBuilder.CLUSTER_SIZE,
        undefined,
        undefined,
        this._miniWaterCC,
        this._builderBFS,
      );
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
      DebugSpan.start("WaterManager:rebuildWaterGraph");
      const graphBuilder = new AbstractGraphBuilder(
        this.miniMap,
        AbstractGraphBuilder.CLUSTER_SIZE,
        this._miniWaterGraph ?? undefined,
        this._dirtyMiniTiles.size > 0 ? this._dirtyMiniTiles : undefined,
        this._miniWaterCC ?? undefined,
        this._builderBFS ?? undefined,
      );
      this._miniWaterGraph = graphBuilder.build();
      this._dirtyMiniTiles.clear();
      DebugSpan.start("hpa");
      if (this._miniWaterHPA) {
        // Reuse map-sized scratch buffers; only swap the graph
        this._miniWaterHPA.setGraph(this._miniWaterGraph);
      } else {
        this._miniWaterHPA = new AStarWaterHierarchical(
          this.miniMap,
          this._miniWaterGraph,
          { cachePaths: true },
        );
      }
      DebugSpan.end("hpa");
      DebugSpan.end("WaterManager:rebuildWaterGraph");
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

    DebugSpan.start("WaterManager:finalizeWaterChanges");
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
    DebugSpan.start("ocean");
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
    DebugSpan.end("ocean");
    DebugSpan.start("magnitude");
    if (!this._waterDistArr || this._waterDistArr.length !== totalTiles) {
      this._waterDistArr = new Uint16Array(totalTiles);
      this._waterStampArr = new Uint16Array(totalTiles);
      this._waterStamp = 0;
    }
    // Magnitude BFS: recompute ceil(manhattan_dist_to_nearest_coast / 2)
    // for tiles affected by the nuke.
    //
    // Converted tiles are first grouped into spatially separate craters so
    // that simultaneous distant nukes (barrages, MIRVs) each get a small
    // local BFS instead of one bounding box spanning most of the map.
    const groups = this.computeCraterGroups(converted, w, MAX_MAG_DIST);
    for (const g of groups) {
      this.recomputeMagnitudesInBox(
        map,
        g,
        this._waterStampArr!,
        this._waterDistArr,
        this.bumpFullMapStamp(),
        true, // impassable terrain is void, not coastline
        changed,
      );
    }

    DebugSpan.end("magnitude");
    DebugSpan.start("shoreline");
    // ── 3. Fix shoreline bits ──────────────────────────────────────
    // Only converted tiles changed terrain type (land→water), so only
    // they and their 2-ring neighborhood can have shoreline bit changes.
    // Dedup via the reusable stamp array (cheaper than a Set for large
    // craters).
    const shoreStamp = this.bumpFullMapStamp();
    const shoreStampArr = this._waterStampArr!;
    const tilesToCheck: TileRef[] = [];
    const pushToCheck = (tile: TileRef): void => {
      if (shoreStampArr[tile] !== shoreStamp) {
        shoreStampArr[tile] = shoreStamp;
        tilesToCheck.push(tile);
      }
    };
    for (const tile of converted) {
      pushToCheck(tile);
      const end = pushNeighbors(tile, nb, 0);
      for (let i = 0; i < end; i++) {
        pushToCheck(nb[i]);
        const end2 = pushNeighbors(nb[i], nb, end);
        for (let j = end; j < end2; j++) {
          pushToCheck(nb[j]);
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
    DebugSpan.end("shoreline");
    DebugSpan.start("minimap");
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

    DebugSpan.end("minimap");
    DebugSpan.start("miniMagnitude");
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
      // Note: unlike the full map, ANY land tile counts as coastline.
      const miniTotal = miniW * miniH;
      if (!this._miniDistArr || this._miniDistArr.length !== miniTotal) {
        this._miniDistArr = new Uint16Array(miniTotal);
        this._miniStampArr = new Uint16Array(miniTotal);
        this._miniStamp = 0;
      }
      const miniGroups = this.computeCraterGroups(
        convertedMiniTiles,
        miniW,
        MAX_MAG_DIST,
      );
      for (const g of miniGroups) {
        this.recomputeMagnitudesInBox(
          this.miniMap,
          g,
          this._miniStampArr!,
          this._miniDistArr,
          this.bumpMiniStamp(),
          false,
          null,
        );
      }
    }

    DebugSpan.end("miniMagnitude");

    // ── 5. Mark water graph dirty (rebuilt lazily, throttled) ─────
    if (convertedMiniTiles.size > 0) {
      // Fold the new water tiles into the persistent component labeling
      this._miniWaterCC?.addWaterTiles(convertedMiniTiles);
      this._waterGraphDirty = true;
      for (const mt of convertedMiniTiles) {
        this._dirtyMiniTiles.add(mt);
      }
    }
    DebugSpan.end("WaterManager:finalizeWaterChanges");

    // Drain changed set into output array
    for (const tile of changed) {
      changedTiles.push(tile);
    }
  }

  private bumpFullMapStamp(): number {
    this._waterStamp++;
    if (this._waterStamp >= 0xffff) {
      this._waterStampArr!.fill(0);
      this._waterStamp = 1;
    }
    return this._waterStamp;
  }

  private bumpMiniStamp(): number {
    this._miniStamp++;
    if (this._miniStamp >= 0xffff) {
      this._miniStampArr!.fill(0);
      this._miniStamp = 1;
    }
    return this._miniStamp;
  }

  /**
   * Group converted tiles into spatially separate crater clusters.
   *
   * Tiles are bucketed into coarse cells of maxMagDist, adjacent occupied
   * cells are unioned into groups, and groups are then merged whenever
   * merging shrinks the total BFS work (union box area smaller than the
   * separate box areas combined).  Far-apart simultaneous nukes therefore
   * keep small independent BFS boxes, while dense clusters collapse into
   * one box instead of overlapping duplicates.
   *
   * Correctness does not depend on the grouping: each group's BFS seeds
   * every coastline inside its own seed box, so overlapping boxes only
   * duplicate work, never change results.
   */
  private computeCraterGroups(
    converted: Set<TileRef>,
    w: number,
    maxMagDist: number,
  ): CraterBounds[] {
    const cellSize = maxMagDist;
    const cellsX = Math.ceil(w / cellSize);

    // Bucket tiles into coarse cells, tracking per-cell crater bounds
    const cells = new Map<number, CraterBounds>();
    for (const tile of converted) {
      const tx = tile % w;
      const ty = (tile - tx) / w;
      const key =
        Math.floor(ty / cellSize) * cellsX + Math.floor(tx / cellSize);
      const b = cells.get(key);
      if (b === undefined) {
        cells.set(key, { minX: tx, maxX: tx, minY: ty, maxY: ty });
      } else {
        if (tx < b.minX) b.minX = tx;
        if (tx > b.maxX) b.maxX = tx;
        if (ty < b.minY) b.minY = ty;
        if (ty > b.maxY) b.maxY = ty;
      }
    }

    // Union-find over occupied cells; adjacent cells (8-neighborhood)
    // belong to the same crater cluster.
    const parent = new Map<number, number>();
    for (const key of cells.keys()) parent.set(key, key);
    const find = (k: number): number => {
      let root = k;
      while (parent.get(root)! !== root) root = parent.get(root)!;
      let cur = k;
      while (parent.get(cur)! !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    for (const key of cells.keys()) {
      const cx = key % cellsX;
      const cy = (key - cx) / cellsX;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= cellsX || ny < 0) continue;
          const nk = ny * cellsX + nx;
          if (!cells.has(nk)) continue;
          const ra = find(key);
          const rb = find(nk);
          if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
        }
      }
    }

    // Merge cell bounds per root (Map iteration order is deterministic)
    const byRoot = new Map<number, CraterBounds>();
    for (const [key, b] of cells) {
      const root = find(key);
      const g = byRoot.get(root);
      if (g === undefined) {
        byRoot.set(root, { ...b });
      } else {
        if (b.minX < g.minX) g.minX = b.minX;
        if (b.maxX > g.maxX) g.maxX = b.maxX;
        if (b.minY < g.minY) g.minY = b.minY;
        if (b.maxY > g.maxY) g.maxY = b.maxY;
      }
    }
    const groups = [...byRoot.values()];

    // Greedily merge groups when the merged seed box is cheaper to
    // process than the two separate (possibly overlapping) seed boxes.
    const pad = 4 * maxMagDist; // seed box adds 2*maxMagDist on each side
    const boxArea = (g: CraterBounds): number =>
      (g.maxX - g.minX + pad) * (g.maxY - g.minY + pad);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < groups.length && !merged; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          const a = groups[i];
          const b = groups[j];
          const union: CraterBounds = {
            minX: Math.min(a.minX, b.minX),
            maxX: Math.max(a.maxX, b.maxX),
            minY: Math.min(a.minY, b.minY),
            maxY: Math.max(a.maxY, b.maxY),
          };
          if (boxArea(union) < boxArea(a) + boxArea(b)) {
            groups[i] = union;
            groups.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    return groups;
  }

  /**
   * Recompute water magnitudes (ceil(dist_to_nearest_coast / 2), capped
   * at 31) for all water tiles within MAX_MAG_DIST of the crater bounds.
   *
   * Dirty box (±MAX_MAG_DIST from crater bounds): the region where
   * magnitudes may have changed.  Only tiles here get updated.
   *
   * Seed box (±2*MAX_MAG_DIST from crater bounds): coastlines here are
   * seeded for BFS.  This ensures that every coastline that could be
   * nearest to a dirty-box tile is included (a dirty-box tile is at most
   * MAX_MAG_DIST from the crater, and the nearest coast is at most
   * MAX_MAG_DIST from the tile, so the coast is at most 2*MAX_MAG_DIST
   * from the crater).  The BFS runs WITHOUT convergence inside the seed
   * box so that wavefronts from distant coastlines correctly reach the
   * dirty box, and is clipped at the seed box boundary for performance.
   *
   * Reads terrain bytes directly — these loops dominate finalize cost on
   * large maps.
   *
   * @param passableCoastOnly When true, impassable terrain is void (like
   *   the map edge), so water tiles adjacent only to impassable terrain
   *   are NOT coastline — they stay uniformly deep with no gradient.
   *   (Used on the full map; the minimap counts any land as coastline.)
   * @param changed When set, tiles whose magnitude changed are recorded
   *   for client updates.
   */
  private recomputeMagnitudesInBox(
    map: GameMap,
    bounds: CraterBounds,
    stampArr: Uint16Array,
    distArr: Uint16Array,
    stamp: number,
    passableCoastOnly: boolean,
    changed: Set<TileRef> | null,
  ): void {
    const w = map.width();
    const h = map.height();
    // Direct terrain access, same precedent as ConnectedComponents
    const terrain = (map as unknown as { terrain: Uint8Array }).terrain;

    // Dirty box: tiles whose magnitude may need updating.
    const dMinX = Math.max(0, bounds.minX - MAX_MAG_DIST);
    const dMaxX = Math.min(w - 1, bounds.maxX + MAX_MAG_DIST);
    const dMinY = Math.max(0, bounds.minY - MAX_MAG_DIST);
    const dMaxY = Math.min(h - 1, bounds.maxY + MAX_MAG_DIST);
    // Seed box: coastlines here are seeded; BFS is clipped here.
    const sMinX = Math.max(0, bounds.minX - MAX_MAG_DIST * 2);
    const sMaxX = Math.min(w - 1, bounds.maxX + MAX_MAG_DIST * 2);
    const sMinY = Math.max(0, bounds.minY - MAX_MAG_DIST * 2);
    const sMaxY = Math.min(h - 1, bounds.maxY + MAX_MAG_DIST * 2);

    const isCoastByte = (b: number): boolean =>
      (b & TERRAIN_LAND_MASK) !== 0 &&
      (!passableCoastOnly || (b & TERRAIN_MAG_MASK) !== IMPASSABLE_MAG);

    // Seed from coastline water tiles inside the seed box.
    const queue: TileRef[] = [];
    for (let y = sMinY; y <= sMaxY; y++) {
      const rowStart = y * w;
      for (let x = sMinX; x <= sMaxX; x++) {
        const tile = (rowStart + x) as TileRef;
        if ((terrain[tile] & TERRAIN_LAND_MASK) !== 0) continue;
        if (stampArr[tile] === stamp) continue;
        const isCoast =
          (y > 0 && isCoastByte(terrain[tile - w])) ||
          (y < h - 1 && isCoastByte(terrain[tile + w])) ||
          (x > 0 && isCoastByte(terrain[tile - 1])) ||
          (x < w - 1 && isCoastByte(terrain[tile + 1]));
        if (isCoast) {
          stampArr[tile] = stamp;
          distArr[tile] = 0;
          queue.push(tile);
        }
      }
    }

    // BFS outward through water, clipped to the seed box.
    let head = 0;
    while (head < queue.length) {
      const tile = queue[head++];
      const nextDist = distArr[tile] + 1;
      const x = tile % w;
      const y = (tile - x) / w;
      if (y > sMinY) {
        const n = tile - w;
        if ((terrain[n] & TERRAIN_LAND_MASK) === 0 && stampArr[n] !== stamp) {
          stampArr[n] = stamp;
          distArr[n] = nextDist;
          queue.push(n as TileRef);
        }
      }
      if (y < sMaxY) {
        const n = tile + w;
        if ((terrain[n] & TERRAIN_LAND_MASK) === 0 && stampArr[n] !== stamp) {
          stampArr[n] = stamp;
          distArr[n] = nextDist;
          queue.push(n as TileRef);
        }
      }
      if (x > sMinX) {
        const n = tile - 1;
        if ((terrain[n] & TERRAIN_LAND_MASK) === 0 && stampArr[n] !== stamp) {
          stampArr[n] = stamp;
          distArr[n] = nextDist;
          queue.push(n as TileRef);
        }
      }
      if (x < sMaxX) {
        const n = tile + 1;
        if ((terrain[n] & TERRAIN_LAND_MASK) === 0 && stampArr[n] !== stamp) {
          stampArr[n] = stamp;
          distArr[n] = nextDist;
          queue.push(n as TileRef);
        }
      }
    }

    // Update magnitudes only for dirty-box tiles.
    for (let y = dMinY; y <= dMaxY; y++) {
      const rowStart = y * w;
      for (let x = dMinX; x <= dMaxX; x++) {
        const tile = (rowStart + x) as TileRef;
        const b = terrain[tile];
        if ((b & TERRAIN_LAND_MASK) !== 0) continue;
        // Reached by BFS → magnitude from distance; unreached → nearest
        // coast is >MAX_MAG_DIST away → deep water (31).
        const newMag =
          stampArr[tile] === stamp
            ? Math.min(Math.ceil(distArr[tile] / 2), 31)
            : 31;
        if ((b & TERRAIN_MAG_MASK) !== newMag) {
          map.setMagnitude(tile, newMag);
          changed?.add(tile);
        }
      }
    }
  }
}
