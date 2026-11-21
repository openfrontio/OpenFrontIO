import { authoredTerrain } from "@openfront/engine-api/EditorCommands";
import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { GameMapImpl } from "@openfront/engine-lib/game/GameMapImpl";
import {
  snapshotType,
  zBytes,
  zInt,
  zTiles,
  zU16Array,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import {
  AbstractGraph,
  AbstractGraphBuilder,
} from "../pathfinding/algorithms/AbstractGraph";
import { AStarWaterHierarchical } from "../pathfinding/algorithms/AStar.WaterHierarchical";
import { BFSGrid } from "../pathfinding/algorithms/BFS.Grid";
import { ConnectedComponents } from "../pathfinding/algorithms/ConnectedComponents";
import { PathFinder } from "../pathfinding/types";
import { DebugSpan } from "../utilities/DebugSpan";

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
const TERRAIN_SHORELINE_BIT = 0x40;
const TERRAIN_OCEAN_BIT = 0x20;
// The map generator's depth for water next to impassable terrain (packed).
const IMPASSABLE_NEIGHBOR_MAG = 10;

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

  snapshot(): WaterManagerState {
    return {
      waterGraphVersion: this._waterGraphVersion,
      waterGraphDirty: this._waterGraphDirty,
      waterGraphLastRebuildTick: this._waterGraphLastRebuildTick,
      pendingWaterTiles: Uint32Array.from(this._pendingWaterTiles),
      dirtyMiniTiles: Uint32Array.from(this._dirtyMiniTiles),
      // Components only diverge from a fresh labeling of the (restored)
      // minimap once water has been added; skip the arrays until then.
      components:
        this.miniMap.waterVersion() > 0
          ? (this._miniWaterCC?.snapshot() ?? null)
          : null,
    };
  }

  /**
   * Applies a snapshot to a manager just constructed on the restored maps.
   *
   * The water graph is rebuilt from the restored components rather than
   * stored. While the graph is dirty (up to WATER_GRAPH_REBUILD_INTERVAL
   * ticks after a water nuke) the live game still routes on the stale graph,
   * which a restore cannot reproduce.
   */
  restoreSnapshot(s: WaterManagerState): void {
    this._waterGraphVersion = s.waterGraphVersion;
    this._waterGraphDirty = s.waterGraphDirty;
    this._waterGraphLastRebuildTick = s.waterGraphLastRebuildTick;
    this._pendingWaterTiles = new Set(s.pendingWaterTiles);
    this._dirtyMiniTiles = new Set(s.dirtyMiniTiles);
    if (s.components !== null && this._miniWaterCC !== null) {
      this._miniWaterCC.restoreSnapshot(s.components);
      this._miniWaterGraph = new AbstractGraphBuilder(
        this.miniMap,
        AbstractGraphBuilder.CLUSTER_SIZE,
        undefined,
        undefined,
        this._miniWaterCC,
        this._builderBFS ?? undefined,
      ).build();
      this._miniWaterHPA?.setGraph(this._miniWaterGraph);
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
    let convertedThisTick = false;

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
        convertedThisTick = true;
        this.finalizeWaterChanges(converted, changedTiles);
      }
    }

    // Throttled water graph rebuild: at most once every 20 ticks
    if (
      this._waterGraphDirty &&
      !this.disableNavMesh &&
      // Keep terrain fixup and graph rebuilding out of the same tick. The
      // graph is already allowed to remain stale between throttled rebuilds,
      // and a one-tick delay avoids combining both water-nuke CPU spikes.
      !convertedThisTick &&
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

  /**
   * The scenario editor's terrain edit (docs/ScenarioEditor.md, "Terrain").
   * Writes the authored part of each tile's terrain byte, `terrain[i]` for
   * `tiles[i]` (water 0, land 0x80 | elevation, impassable 0x9f), and
   * repairs what the map generator derives from it around the tiles: the
   * shoreline bits, the water depth, and the minimap tiles above them, with
   * the generator's rules.
   *
   * What needs the whole map waits for endTerrainEdit(): new water has no
   * ocean bit, a water body with no coast gets depth 31 instead of the
   * generator's, and the water components and graph are not updated.
   * Returns the full-map tiles whose terrain changed.
   */
  editTerrain(
    tiles: readonly TileRef[],
    terrain: readonly number[],
  ): TileRef[] {
    const map = this.map;
    const changed = new Set<TileRef>();
    const edited: TileRef[] = [];
    const kindChanged = new Set<TileRef>();
    for (let i = 0; i < tiles.length; i++) {
      if (writeAuthored(map, tiles[i], terrain[i], kindChanged)) {
        edited.push(tiles[i]);
        changed.add(tiles[i]);
      }
    }
    if (edited.length === 0) return [];
    this.repairAround(map, edited, kindChanged, false, changed);

    const mini = this.miniMap;
    const miniEdited: TileRef[] = [];
    const miniKindChanged = new Set<TileRef>();
    for (const tile of edited) {
      const mx = map.x(tile) >> 1;
      const my = map.y(tile) >> 1;
      if (!mini.isValidCoord(mx, my)) continue;
      const miniTile = mini.ref(mx, my);
      const value = miniAuthored(map, mx, my);
      if (writeAuthored(mini, miniTile, value, miniKindChanged)) {
        miniEdited.push(miniTile);
      }
    }
    if (miniEdited.length > 0) {
      this.repairAround(mini, miniEdited, miniKindChanged, true, null);
    }
    return [...changed];
  }

  /**
   * Ends a run of editTerrain() calls. Derives every tile's terrain byte
   * from its authored part again, on both maps, as the map generator does:
   * this sets the ocean bit and the depth of water bodies with no coast,
   * which editTerrain() leaves. The minimap is downscaled from the full map
   * again first, so it depends on the full map alone, not on which tiles
   * were edited: a stock map's minimap had small islands and lakes removed
   * that editTerrain() would otherwise restore only where it was painted.
   * The water components and graph wait for rebuildWaterGraph(). Returns
   * the full-map tiles whose terrain changed.
   */
  endTerrainEdit(): TileRef[] {
    DebugSpan.start("WaterManager:endTerrainEdit");
    const changed: TileRef[] = [];
    this.deriveTerrain(this.map, null, changed);
    const mini = this.miniMap;
    const miniTerrain = terrainOf(mini);
    for (let my = 0, t = 0; my < mini.height(); my++) {
      for (let mx = 0; mx < mini.width(); mx++, t++) {
        const value = miniAuthored(this.map, mx, my);
        if (authoredTerrain(miniTerrain[t]) !== value) {
          mini.setTerrainByte(t, value);
        }
      }
    }
    this.deriveTerrain(mini, this.map, null);
    DebugSpan.end("WaterManager:endTerrainEdit");
    return changed;
  }

  /**
   * The map generator's map16x: the minimap downscaled by the minimap's
   * rule and derived, with no small islands removed, as the generator makes
   * it from map4x. For the scenario editor's export, after endTerrainEdit()
   * has derived the minimap.
   */
  downscaleMiniMap(): GameMap {
    const mini = this.miniMap;
    const w = mini.width() >> 1;
    const h = mini.height() >> 1;
    const terrain = new Uint8Array(w * h);
    let land = 0;
    for (let y = 0, t = 0; y < h; y++) {
      for (let x = 0; x < w; x++, t++) {
        terrain[t] = miniAuthored(mini, x, y);
        if (terrainKind(terrain[t]) === 1) land++;
      }
    }
    const map = new GameMapImpl(w, h, terrain, land);
    this.deriveTerrain(map, mini, null);
    return map;
  }

  /**
   * Labels the water components and builds the water graph afresh, as game
   * load does, after terrain edits: an edit can split a body of water,
   * which the water nukes' incremental updates never have to handle. The
   * scenario editor runs this before test play rather than at each
   * stroke's end: on the largest map it costs about as much as the game's
   * load (docs/ScenarioEditor.md, "Terrain").
   */
  rebuildWaterGraph(): void {
    DebugSpan.start("WaterManager:rebuildWaterGraphFully");
    if (this._miniWaterCC !== null) {
      this._miniWaterCC.initialize();
      this._miniWaterGraph = new AbstractGraphBuilder(
        this.miniMap,
        AbstractGraphBuilder.CLUSTER_SIZE,
        undefined,
        undefined,
        this._miniWaterCC,
        this._builderBFS ?? undefined,
      ).build();
      this._miniWaterHPA?.setGraph(this._miniWaterGraph);
    }
    this._waterGraphDirty = false;
    this._dirtyMiniTiles.clear();
    this._waterGraphVersion++;
    DebugSpan.end("WaterManager:rebuildWaterGraphFully");
  }

  /**
   * After editTerrain() wrote `edited`: fixes the shoreline bits of the
   * edited tiles and the neighbours of those that changed kind, and the
   * water depth around the latter.
   */
  private repairAround(
    map: GameMap,
    edited: TileRef[],
    kindChanged: Set<TileRef>,
    mini: boolean,
    changed: Set<TileRef> | null,
  ): void {
    const w = map.width();
    const h = map.height();
    const terrain = terrainOf(map);
    const check = new Set<TileRef>(edited);
    for (const tile of kindChanged) {
      const x = tile % w;
      if (tile >= w) check.add(tile - w);
      if (tile < (h - 1) * w) check.add(tile + w);
      if (x > 0) check.add(tile - 1);
      if (x < w - 1) check.add(tile + 1);
    }
    for (const tile of check) {
      const b = terrain[tile];
      const value = isShorelineTile(terrain, w, h, tile)
        ? b | TERRAIN_SHORELINE_BIT
        : b & ~TERRAIN_SHORELINE_BIT;
      if (value !== b) {
        map.setTerrainByte(tile, value);
        changed?.add(tile);
      }
    }
    if (kindChanged.size === 0) return;
    const { stampArr, distArr } = this.magnitudeScratch(mini);
    for (const g of this.computeCraterGroups(kindChanged, w, MAX_MAG_DIST)) {
      this.recomputeMagnitudesInBox(
        map,
        g,
        stampArr,
        distArr,
        mini ? this.bumpMiniStamp() : this.bumpFullMapStamp(),
        true,
        changed,
        true,
      );
    }
  }

  /**
   * Derives the shoreline bit, ocean bit and water depth of every tile of
   * `map` from the authored part of the terrain, by the map generator's
   * rules. `source` is the map `map` was downscaled from, if any: water
   * with no coast takes its first water source's depth, as the generator's
   * createMiniMap copies it.
   */
  private deriveTerrain(
    map: GameMap,
    source: GameMap | null,
    changed: TileRef[] | null,
  ): void {
    const w = map.width();
    const h = map.height();
    const total = w * h;
    const terrain = terrainOf(map);
    const { distArr } = this.magnitudeScratch(source !== null);
    const queue = new Int32Array(total);

    // What each tile's neighbours are: the kinds of terrain among them, and
    // the directions in which they are water.
    const around = new Uint8Array(total);
    // From here distArr holds, for each water tile, its distance to
    // passable land + 1 (0 if not reached) and the DERIVE_ flags.
    distArr.fill(0);
    let tail = 0;
    for (let y = 0, t = 0; y < h; y++) {
      for (let x = 0; x < w; x++, t++) {
        let m = 0;
        let k = 0;
        if (y > 0) m |= (k = KIND_BIT[terrain[t - w]]) === WATER ? k | UP : k;
        if (y < h - 1) {
          m |= (k = KIND_BIT[terrain[t + w]]) === WATER ? k | DOWN : k;
        }
        if (x > 0) m |= (k = KIND_BIT[terrain[t - 1]]) === WATER ? k | LEFT : k;
        if (x < w - 1) {
          m |= (k = KIND_BIT[terrain[t + 1]]) === WATER ? k | RIGHT : k;
        }
        around[t] = m;
        if (KIND_BIT[terrain[t]] === WATER && (m & LAND) !== 0) {
          distArr[t] = 1;
          queue[tail++] = t;
        }
      }
    }

    // Depth: ceil(distance to passable land / 2), capped at 31, by a BFS
    // from the shoreline water. Water further out than the cap is 31 if
    // its body has a coast; DERIVE_COASTLESS marks the bodies that don't.
    for (let head = 0; head < tail; head++) {
      const t = queue[head];
      const d = distArr[t];
      if (d >= MAX_MAG_DIST) continue;
      const m = around[t];
      if ((m & UP) !== 0 && distArr[t - w] === 0) {
        distArr[t - w] = d + 1;
        queue[tail++] = t - w;
      }
      if ((m & DOWN) !== 0 && distArr[t + w] === 0) {
        distArr[t + w] = d + 1;
        queue[tail++] = t + w;
      }
      if ((m & LEFT) !== 0 && distArr[t - 1] === 0) {
        distArr[t - 1] = d + 1;
        queue[tail++] = t - 1;
      }
      if ((m & RIGHT) !== 0 && distArr[t + 1] === 0) {
        distArr[t + 1] = d + 1;
        queue[tail++] = t + 1;
      }
    }

    // The ocean is the largest body of water. On a tie the generator takes
    // the body it finds first scanning column by column: the one holding
    // the smallest x * h + y.
    let ocean = -1;
    let oceanSize = 0;
    let oceanKey = 0;
    const coastless: number[] = [];
    for (let start = 0; start < total; start++) {
      if (KIND_BIT[terrain[start]] !== WATER) continue;
      if ((distArr[start] & DERIVE_SEEN) !== 0) continue;
      const body = fillWaterBody(
        start,
        DERIVE_SEEN,
        distArr,
        around,
        w,
        h,
        queue,
      );
      if (!body.coast) coastless.push(start);
      if (
        body.size > oceanSize ||
        (body.size === oceanSize && body.key < oceanKey)
      ) {
        ocean = start;
        oceanSize = body.size;
        oceanKey = body.key;
      }
    }
    for (const start of coastless) {
      fillWaterBody(start, DERIVE_COASTLESS, distArr, around, w, h, queue);
    }
    if (ocean >= 0) {
      fillWaterBody(ocean, DERIVE_OCEAN, distArr, around, w, h, queue);
    }

    const sourceTerrain = source !== null ? terrainOf(source) : null;
    const sw = source?.width() ?? 0;
    for (let y = 0, t = 0; y < h; y++) {
      for (let x = 0; x < w; x++, t++) {
        const b = terrain[t];
        const m = around[t];
        const kind = KIND_BIT[b];
        let value = b & (TERRAIN_LAND_MASK | TERRAIN_MAG_MASK);
        if (kind === WATER) {
          const d = distArr[t];
          if ((m & IMPASSABLE) !== 0) {
            value = IMPASSABLE_NEIGHBOR_MAG;
          } else if ((d & DERIVE_COASTLESS) !== 0) {
            // No coast: 0, or on a minimap the depth of the first water
            // source in createMiniMap's order (0,0), (0,1), (1,0), (1,1).
            value = 0;
            if (sourceTerrain !== null) {
              const s = y * 2 * sw + x * 2;
              for (const src of [s, s + sw, s + 1, s + sw + 1]) {
                if ((sourceTerrain[src] & TERRAIN_LAND_MASK) === 0) {
                  value = sourceTerrain[src] & TERRAIN_MAG_MASK;
                  break;
                }
              }
            }
          } else {
            const reached = d & DERIVE_DIST_MASK;
            value = reached === 0 ? TERRAIN_MAG_MASK : reached >> 1;
          }
          if ((d & DERIVE_OCEAN) !== 0) value |= TERRAIN_OCEAN_BIT;
          if ((m & LAND) !== 0) value |= TERRAIN_SHORELINE_BIT;
        } else if (kind === LAND && (m & WATER) !== 0) {
          value |= TERRAIN_SHORELINE_BIT;
        }
        if (value !== b) {
          map.setTerrainByte(t, value);
          changed?.push(t);
        }
      }
    }
  }

  private magnitudeScratch(mini: boolean): {
    stampArr: Uint16Array;
    distArr: Uint16Array;
  } {
    const map = mini ? this.miniMap : this.map;
    const total = map.width() * map.height();
    if (mini) {
      if (!this._miniDistArr || this._miniDistArr.length !== total) {
        this._miniDistArr = new Uint16Array(total);
        this._miniStampArr = new Uint16Array(total);
        this._miniStamp = 0;
      }
      return { stampArr: this._miniStampArr!, distArr: this._miniDistArr };
    }
    if (!this._waterDistArr || this._waterDistArr.length !== total) {
      this._waterDistArr = new Uint16Array(total);
      this._waterStampArr = new Uint16Array(total);
      this._waterStamp = 0;
    }
    return { stampArr: this._waterStampArr!, distArr: this._waterDistArr };
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
      let isWater = false;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (
            map.isValidCoord(fx + dx, fy + dy) &&
            map.isWater(map.ref(fx + dx, fy + dy))
          ) {
            isWater = true;
            break;
          }
        }
        if (isWater) break;
      }
      if (isWater) {
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
   * @param impassableNeighborDepth When true, water next to impassable
   *   terrain gets the map generator's fixed depth instead (editor edits).
   */
  private recomputeMagnitudesInBox(
    map: GameMap,
    bounds: CraterBounds,
    stampArr: Uint16Array,
    distArr: Uint16Array,
    stamp: number,
    passableCoastOnly: boolean,
    changed: Set<TileRef> | null,
    impassableNeighborDepth = false,
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

    // BFS outward through water, clipped to the seed box. It stops at
    // MAX_MAG_DIST, from where the depth is 31 either way, so the distance
    // fits distArr however far the water runs.
    let head = 0;
    while (head < queue.length) {
      const tile = queue[head++];
      if (distArr[tile] >= MAX_MAG_DIST) continue;
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
          impassableNeighborDepth && touchesImpassable(terrain, w, h, tile)
            ? IMPASSABLE_NEIGHBOR_MAG
            : stampArr[tile] === stamp
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

// The authored terrain byte of impassable terrain.
const IMPASSABLE_BYTE = TERRAIN_LAND_MASK | IMPASSABLE_MAG;

// deriveTerrain's per-tile bits. A terrain byte's kind as a bit
// (KIND_BIT[byte]), and the directions of a tile's water neighbours.
const WATER = 1;
const LAND = 2;
const IMPASSABLE = 4;
const UP = 8;
const DOWN = 16;
const LEFT = 32;
const RIGHT = 64;
// distArr in deriveTerrain: distance to passable land + 1, and flags.
const DERIVE_DIST_MASK = 0x3f;
const DERIVE_SEEN = 0x2000;
const DERIVE_COASTLESS = 0x4000;
const DERIVE_OCEAN = 0x8000;

function terrainOf(map: GameMap): Uint8Array {
  // Direct terrain access, same precedent as ConnectedComponents
  return (map as unknown as { terrain: Uint8Array }).terrain;
}

/** 0 water, 1 land, 2 impassable. */
function terrainKind(b: number): number {
  if ((b & TERRAIN_LAND_MASK) === 0) return 0;
  return (b & TERRAIN_MAG_MASK) === IMPASSABLE_MAG ? 2 : 1;
}

const KIND_BIT = Uint8Array.from(
  { length: 256 },
  (_, b) => 1 << terrainKind(b),
);

/**
 * Writes the authored byte `value` to the tile, clearing what is derived
 * from it, unless the tile has it already. Returns whether it wrote.
 */
function writeAuthored(
  map: GameMap,
  tile: TileRef,
  value: number,
  kindChanged: Set<TileRef>,
): boolean {
  const b = map.terrainByte(tile);
  if (authoredTerrain(b) === value) return false;
  if (terrainKind(b) !== terrainKind(value)) kindChanged.add(tile);
  map.setTerrainByte(tile, value);
  return true;
}

/**
 * The map generator's createMiniMap rule for the minimap tile (mx, my) of
 * `map`: water if any of its four tiles is, else impassable if any is, else
 * land at the elevation of the last, (1,1).
 */
function miniAuthored(map: GameMap, mx: number, my: number): number {
  const terrain = terrainOf(map);
  const s = map.ref(mx * 2, my * 2);
  const w = map.width();
  const a = terrainKind(terrain[s]);
  const b = terrainKind(terrain[s + w]);
  const c = terrainKind(terrain[s + 1]);
  const d = terrainKind(terrain[s + w + 1]);
  if (a === 0 || b === 0 || c === 0 || d === 0) return 0;
  if (a === 2 || b === 2 || c === 2 || d === 2) return IMPASSABLE_BYTE;
  return authoredTerrain(terrain[s + w + 1]);
}

/**
 * The map generator's shoreline rule: land next to water, or water next to
 * passable land. Impassable terrain is never shoreline.
 */
function isShorelineTile(
  terrain: Uint8Array,
  w: number,
  h: number,
  tile: number,
): boolean {
  const kind = terrainKind(terrain[tile]);
  if (kind === 2) return false;
  const coast = kind === 0 ? 1 : 0;
  const x = tile % w;
  return (
    (tile >= w && terrainKind(terrain[tile - w]) === coast) ||
    (tile < (h - 1) * w && terrainKind(terrain[tile + w]) === coast) ||
    (x > 0 && terrainKind(terrain[tile - 1]) === coast) ||
    (x < w - 1 && terrainKind(terrain[tile + 1]) === coast)
  );
}

/**
 * Scan-line flood fill (as in ConnectedComponents) of the water body
 * holding `start`, setting `bit` in `marks` on its tiles. `around` is
 * deriveTerrain's. Returns the body's size, whether any of its tiles has
 * passable land beside it, and the smallest x * h + y among its tiles.
 */
function fillWaterBody(
  start: number,
  bit: number,
  marks: Uint16Array,
  around: Uint8Array,
  w: number,
  h: number,
  queue: Int32Array,
): { size: number; coast: boolean; key: number } {
  let size = 0;
  let coast = 0;
  let key = Infinity;
  // A tile is marked when it is queued, and only the first tile of each
  // unmarked run above or below a span is queued: the run is filled from it.
  marks[start] |= bit;
  queue[0] = start;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    let left = queue[head];
    let right = left;
    while ((around[left] & LEFT) !== 0 && (marks[left - 1] & bit) === 0) {
      marks[--left] |= bit;
    }
    while ((around[right] & RIGHT) !== 0 && (marks[right + 1] & bit) === 0) {
      marks[++right] |= bit;
    }
    size += right - left + 1;
    const x = left % w;
    key = Math.min(key, x * h + (left - x) / w);
    let upRun = false;
    let downRun = false;
    for (let t = left; t <= right; t++) {
      const m = around[t];
      coast |= m & LAND;
      const up = (m & UP) !== 0 && (marks[t - w] & bit) === 0;
      if (up && !upRun) {
        marks[t - w] |= bit;
        queue[tail++] = t - w;
      }
      upRun = up;
      const down = (m & DOWN) !== 0 && (marks[t + w] & bit) === 0;
      if (down && !downRun) {
        marks[t + w] |= bit;
        queue[tail++] = t + w;
      }
      downRun = down;
    }
  }
  return { size, coast: coast !== 0, key };
}

function touchesImpassable(
  terrain: Uint8Array,
  w: number,
  h: number,
  tile: number,
): boolean {
  const x = tile % w;
  return (
    (tile >= w && terrainKind(terrain[tile - w]) === 2) ||
    (tile < (h - 1) * w && terrainKind(terrain[tile + w]) === 2) ||
    (x > 0 && terrainKind(terrain[tile - 1]) === 2) ||
    (x < w - 1 && terrainKind(terrain[tile + 1]) === 2)
  );
}

export const WaterManagerSnapshot = snapshotType({
  name: "WaterManager",
  version: 1,
  schema: z.object({
    waterGraphVersion: zInt(),
    waterGraphDirty: z.boolean(),
    waterGraphLastRebuildTick: zInt(),
    pendingWaterTiles: zTiles(),
    dirtyMiniTiles: zTiles(),
    components: z
      .object({
        componentIds: z.union([zBytes(), zU16Array()]),
        // Indexed by component id, which starts at 1: slot 0 is a hole.
        componentSizes: z.array(zInt().optional()),
        parents: z.array(zInt()),
        maxId: zInt(),
        landMarker: zInt(),
      })
      .nullable(),
  }),
});
export type WaterManagerState = z.infer<typeof WaterManagerSnapshot.schema>;
