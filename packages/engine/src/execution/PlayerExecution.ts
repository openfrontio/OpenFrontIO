import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  Cell,
  PlayerType,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { getMode, simpleHash } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { EngineConfig } from "../configuration/EngineConfig";
import { Execution, Game, Player } from "../game/Game";
import {
  bumpTraversalGeneration,
  tileTraversalScratch,
  TileTraversalScratch,
} from "../game/TileTraversalScratch";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

const TICKS_PER_CLUSTER_CALC = 20;

const CLUSTER_SURROUNDED = 1;

export class PlayerExecution implements Execution {
  private ticksPerClusterCalc = TICKS_PER_CLUSTER_CALC;

  private config: EngineConfig;
  private lastCalc = 0;
  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;
  private active = true;
  // Reusable neighbor buffer to avoid closures/allocation in cluster checks.
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf8: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];
  private clusterTerritoryIds: Int32Array | null = null;
  private nextTerritoryId = 1;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.map = mg.map();
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.id()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!Structures.has(u.type())) {
        continue;
      }

      const owner = this.mg!.owner(u.tile());
      if (!owner?.isPlayer()) {
        u.delete();
        continue;
      }
      if (owner === this.player) {
        continue;
      }

      const captor = this.mg!.player(owner.id());
      if (u.type() === UnitType.DefensePost) {
        u.delete(true, captor);
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      this.removeOnDeath();
      this.active = false;
      // OFM live standings: finishing place = non-bot players still standing when
      // we fell, + 1 (we are the last of them). players() is alive-only and we
      // just dropped to zero tiles, so it already excludes us. Bots are fill, not
      // competitors, so they don't count. Deterministic (same on every client).
      // Fallback path: conquest deaths are stamped in GameImpl.conquerPlayer (so a
      // game-ending tick still records it); recordDeathPosition is first-write-wins.
      const stillStanding = this.mg
        .players()
        .filter((p) => p.type() !== PlayerType.Bot).length;
      this.mg.stats().recordDeathPosition(this.player, stillStanding + 1);
      this.mg.stats().playerKilled(this.player, ticks);
      return;
    }

    const troopInc = this.config.troopIncreaseRate(this.player);
    this.player.addTroops(troopInc);
    const goldFromWorkers = this.config.goldAdditionRate(this.player);
    this.player.addGold(goldFromWorkers);

    // Record stats
    this.mg.stats().goldWork(this.player, goldFromWorkers);

    for (const alliance of this.player.alliances()) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    for (const embargo of this.player.getEmbargoes()) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (
      ticks - this.lastCalc > this.ticksPerClusterCalc ||
      this.player.numTilesOwned() < 100
    ) {
      if (this.player.lastTileChange() >= this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          console.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    // Perf: We fuse bounds calculations into the initial DFS flood, returning packed Int32Array bounds
    // instead of scanning every TileRef and allocating hundreds of Object {min, max} Cells.
    const { clusters, boxes } = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    const isPinched = new Uint8Array(clusters.length);
    for (let i = 0; i < clusters.length; i++) {
      if (this.hasDiagonalPinch(clusters[i])) isPinched[i] = 1;
    }

    // Sovereign invariant ranking: determine the primary territory by measuring the
    // largest contiguous 4-way territory area reachable from each border cluster,
    // rather than raw border tile count or bounding box (which can be distorted by
    // craters, enclaves, or diagonal staircases).
    // Note: We cannot early-exit when size > numTilesOwned() / 2 because in doughnut
    // empires (e.g. interior craters or lakes), both the inner hole rim and the outer
    // perimeter touch the exact same >50% territory mass. Exiting early if the hole
    // cluster appears first would falsely crown the hole as largestIndex and annex the
    // outer continent. All clusters must be evaluated so the bbox tiebreak crowns the
    // outer perimeter. Memoized traversal makes subsequent clusters O(1).
    const { clusterSizes, clusterTileTIds, territoryAreas, maxTerritoryArea } =
      this.floodTerritoryAreas(clusters);
    const largestIndex = this.findLargestClusterIndex(
      clusters,
      boxes,
      clusterSizes,
    );
    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const lIdx = largestIndex * 4;
    const lMinX = boxes[lIdx],
      lMinY = boxes[lIdx + 1],
      lMaxX = boxes[lIdx + 2],
      lMaxY = boxes[lIdx + 3];
    this.player.largestClusterBoundingBox = {
      min: new Cell(lMinX, lMinY),
      max: new Cell(lMaxX, lMaxY),
    };

    const clusterRemoved = new Uint8Array(clusters.length);

    // Pass 0: Sovereign main body removal if fully enclosed by a single enemy
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      lMinX,
      lMinY,
      lMaxX,
      lMaxY,
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      const removed = this.removeCluster(
        largestCluster,
        lMinX,
        lMinY,
        lMaxX,
        lMaxY,
        surroundedBy,
        Boolean(isPinched[largestIndex]),
      );
      if (removed) clusterRemoved[largestIndex] = 1;
    }

    // Pass 1: Whole-cluster removal for secondary clusters
    this.executeSecondaryPass(
      clusters,
      boxes,
      isPinched,
      largestIndex,
      clusterRemoved,
    );

    // Pass 2: Pinch pass on unremoved pinched clusters
    this.executePinchPass(
      clusters,
      boxes,
      isPinched,
      clusterRemoved,
      clusterTileTIds,
      territoryAreas,
      maxTerritoryArea,
    );
  }

  private executeSecondaryPass(
    clusters: readonly TileRef[][],
    boxes: Int32Array,
    isPinched: Uint8Array,
    largestIndex: number,
    clusterRemoved: Uint8Array,
  ): void {
    for (let i = 0; i < clusters.length; i++) {
      if (!this.player.isAlive()) break;
      if (i === largestIndex) continue;
      const idx = i * 4;
      const minX = boxes[idx],
        minY = boxes[idx + 1],
        maxX = boxes[idx + 2],
        maxY = boxes[idx + 3];
      if (
        this.classifyCluster(clusters[i], minX, minY, maxX, maxY) &
        CLUSTER_SURROUNDED
      ) {
        if (
          this.removeCluster(
            clusters[i],
            minX,
            minY,
            maxX,
            maxY,
            undefined,
            Boolean(isPinched[i]),
          )
        ) {
          clusterRemoved[i] = 1;
        }
      }
    }
  }

  private executePinchPass(
    clusters: readonly TileRef[][],
    boxes: Int32Array,
    isPinched: Uint8Array,
    clusterRemoved: Uint8Array,
    clusterTileTIds: Int32Array[],
    territoryAreas: number[],
    maxTerritoryArea: number,
  ): void {
    this.clusterTerritoryIds = null;
    this.nextTerritoryId = 1;
    try {
      for (let i = 0; i < clusters.length; i++) {
        if (!this.player.isAlive()) break;
        if (clusterRemoved[i] || !isPinched[i]) continue;
        // Guard interior hole clusters so hole crenellations are not falsely annexed.
        // Note: By design, isHoleCluster skips the entire cluster if it is enclosed
        // by another cluster of the same contiguous territory (e.g. an interior crater
        // rim). We do not dissect hole clusters into individual 4-way components here
        // because treating diagonal notches along crater perimeters as severed enclaves
        // would re-open crater-rim cannibalization into the main body.
        if (this.isHoleCluster(i, clusters, boxes)) {
          continue;
        }
        this.evaluatePinchCandidates(
          clusters[i],
          maxTerritoryArea,
          clusterTileTIds[i],
          territoryAreas,
        );
      }
    } finally {
      if (this.clusterTerritoryIds !== null) {
        const scratch = this.traversalState();
        for (let c = 0; c < clusters.length; c++) {
          const cl = clusters[c];
          for (let k = 0; k < cl.length; k++) {
            scratch.clusterIndexMap[cl[k]] = 0;
          }
        }
        this.clusterTerritoryIds = null;
      }
      this.nextTerritoryId = 1;
    }
  }

  private floodComponent(
    start: TileRef,
    tGen: number,
    areaGen: number,
  ): number {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    state.visited[start] = tGen;
    state.stack.length = 0;
    state.stack.push(start);
    let size = 0;
    while (state.stack.length > 0) {
      const cur = state.stack.pop()!;
      size++;
      const numNeighbors = map.neighbors4(cur, this.nbuf);
      for (let k = 0; k < numNeighbors; k++) {
        const n = this.nbuf[k];
        if (state.visited[n] < areaGen && map.ownerID(n) === mySmallID) {
          state.visited[n] = tGen;
          state.stack.push(n);
        }
      }
    }
    return size;
  }

  private floodTerritoryAreas(clusters: readonly TileRef[][]): {
    clusterSizes: Int32Array;
    clusterTileTIds: Int32Array[];
    territoryAreas: number[];
    maxTerritoryArea: number;
  } {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const clusterSizes = new Int32Array(clusters.length);
    const clusterTileTIds = new Array<Int32Array>(clusters.length);
    const territoryAreas = [0];
    let maxTerritoryArea = 0;
    const state = this.traversalState();
    const areaGen = this.bumpGenerations(clusters.length * 4 + 16);
    let nextTId = 1;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const tileTIds = new Int32Array(cluster.length);
      clusterTileTIds[i] = tileTIds;
      let maxCluster = 0;
      for (let j = 0; j < cluster.length; j++) {
        const t = cluster[j];
        if (state.visited[t] >= areaGen) {
          const tId = state.visited[t] - areaGen + 1;
          tileTIds[j] = tId;
          if (territoryAreas[tId] > maxCluster)
            maxCluster = territoryAreas[tId];
          continue;
        }
        if (map.ownerID(t) !== mySmallID) continue;
        const tId = nextTId++;
        tileTIds[j] = tId;
        const tGen = areaGen + tId - 1;
        while (state.gen < tGen && state.gen >= areaGen) this.bumpGeneration();
        const size = this.floodComponent(t, tGen, areaGen);
        territoryAreas[tId] = size;
        if (size > maxCluster) maxCluster = size;
      }
      clusterSizes[i] = maxCluster;
      if (maxCluster > maxTerritoryArea) maxTerritoryArea = maxCluster;
    }
    return { clusterSizes, clusterTileTIds, territoryAreas, maxTerritoryArea };
  }

  private findLargestClusterIndex(
    clusters: readonly TileRef[][],
    boxes: Int32Array,
    clusterSizes: Int32Array,
  ): number {
    let largestIndex = 0;
    for (let i = 1; i < clusters.length; i++) {
      if (clusterSizes[i] > clusterSizes[largestIndex]) {
        largestIndex = i;
      } else if (clusterSizes[i] === clusterSizes[largestIndex]) {
        const curBoxArea =
          (boxes[i * 4 + 2] - boxes[i * 4] + 1) *
          (boxes[i * 4 + 3] - boxes[i * 4 + 1] + 1);
        const bestBoxArea =
          (boxes[largestIndex * 4 + 2] - boxes[largestIndex * 4] + 1) *
          (boxes[largestIndex * 4 + 3] - boxes[largestIndex * 4 + 1] + 1);
        if (curBoxArea > bestBoxArea) {
          largestIndex = i;
        } else if (curBoxArea === bestBoxArea) {
          if (clusters[i].length > clusters[largestIndex].length) {
            largestIndex = i;
          }
        }
      }
    }
    return largestIndex;
  }

  /**
   * Detects whether a border cluster contains a diagonal pinch: a 2x2 cell configuration
   * where two diagonally adjacent tiles are owned by this player while the other two
   * separating diagonal-opposite tiles are not, creating a pinch where territory touches
   * only at a diagonal corner (e.g. across a nuclear crater or enemy breach).
   */
  private hasDiagonalPinch(cluster: readonly TileRef[]): boolean {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const w = map.width();
    const h = map.height();
    for (let j = 0; j < cluster.length; j++) {
      const t = cluster[j];
      if (map.ownerID(t) !== mySmallID) continue;
      if (t >= (h - 1) * w) continue;
      const below = t + w;
      if (map.ownerID(below) === mySmallID) continue;
      const x = map.x(t);
      if (
        (x < w - 1 &&
          map.ownerID(below + 1) === mySmallID &&
          map.ownerID(t + 1) !== mySmallID) ||
        (x > 0 &&
          map.ownerID(below - 1) === mySmallID &&
          map.ownerID(t - 1) !== mySmallID)
      ) {
        return true;
      }
    }
    return false;
  }

  private evaluatePinchCandidates(
    cluster: readonly TileRef[],
    maxTerritoryArea: number,
    tileTIds?: Int32Array,
    territoryAreas?: readonly number[],
  ): void {
    if (!this.player.isAlive()) return;
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    let pinchGen = this.bumpGeneration();
    const visited = state.visited;
    for (let j = 0; j < cluster.length; j++) {
      if (!this.player.isAlive()) break;
      if (tileTIds && territoryAreas) {
        const tId = tileTIds[j];
        if (tId !== 0 && territoryAreas[tId] >= maxTerritoryArea) {
          continue;
        }
      }
      const start = cluster[j];
      if (state.gen < pinchGen) {
        pinchGen = this.bumpGeneration();
      }
      if (map.ownerID(start) !== mySmallID || visited[start] >= pinchGen) {
        continue;
      }
      // 4-way flood to measure and bound this component
      let componentHasFallout = false;
      visited[start] = pinchGen;
      const stack = state.stack;
      stack.length = 0;
      stack.push(start);
      const componentTiles: TileRef[] = [start];
      let cMinX = map.x(start),
        cMinY = map.y(start),
        cMaxX = cMinX,
        cMaxY = cMinY;
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const cx = map.x(cur);
        const cy = map.y(cur);
        if (cx < cMinX) cMinX = cx;
        if (cy < cMinY) cMinY = cy;
        if (cx > cMaxX) cMaxX = cx;
        if (cy > cMaxY) cMaxY = cy;
        const numNeighbors = map.neighbors4(cur, this.nbuf);
        for (let k = 0; k < numNeighbors; k++) {
          const n = this.nbuf[k];
          if (!componentHasFallout && map.hasFallout(n)) {
            componentHasFallout = true;
          }
          if (visited[n] < pinchGen && map.ownerID(n) === mySmallID) {
            visited[n] = pinchGen;
            componentTiles.push(n);
            stack.push(n);
          }
        }
      }
      // Component cannot be the main body:
      if (componentTiles.length >= maxTerritoryArea) {
        continue;
      }

      // Nuclear severance requirement: the severed candidate component must
      // border radioactive fallout (a crater). A candidate that has no fallout
      // along its border was not severed by a nuke and is left to 8-way rules.
      if (!componentHasFallout) {
        continue;
      }

      // Evaluate if this component is enclosed using bounded 4-way flood fill:
      if (this.isEnclosed(start, cMinX, cMinY, cMaxX, cMaxY)) {
        const capturing = this.getCapturingPlayer(componentTiles);
        if (capturing !== null) {
          if (this.player.numTilesOwned() === componentTiles.length) {
            this.mg.conquerPlayer(capturing, this.player);
          }
          for (const t of componentTiles) {
            capturing.conquer(t);
          }
        }
      }
    }
  }

  private initClusterTerritories(clusters: readonly TileRef[][]): void {
    const ids = new Int32Array(clusters.length).fill(-1);
    this.clusterTerritoryIds = ids;
    const scratch = this.traversalState();
    for (let c = 0; c < clusters.length; c++) {
      const cl = clusters[c];
      for (let k = 0; k < cl.length; k++) {
        scratch.clusterIndexMap[cl[k]] = c + 1;
      }
    }
  }

  private isHoleCluster(
    i: number,
    clusters: readonly TileRef[][],
    boxes: Int32Array,
  ): boolean {
    const iIdx = i * 4;
    const iMinX = boxes[iIdx];
    const iMinY = boxes[iIdx + 1];
    const iMaxX = boxes[iIdx + 2];
    const iMaxY = boxes[iIdx + 3];

    for (let j = 0; j < clusters.length; j++) {
      if (j === i) continue;
      const jIdx = j * 4;
      if (
        boxes[jIdx] <= iMinX &&
        boxes[jIdx + 1] <= iMinY &&
        boxes[jIdx + 2] >= iMaxX &&
        boxes[jIdx + 3] >= iMaxY
      ) {
        if (this.clusterTerritoryIds === null) {
          this.initClusterTerritories(clusters);
        }
        this.checkAndAssignTerritory(clusters, i, j);
        const tIds = this.clusterTerritoryIds;
        if (tIds !== null && tIds[i] !== -1 && tIds[i] === tIds[j]) {
          return true;
        }
      }
    }
    return false;
  }

  private checkAndAssignTerritory(
    clusters: readonly TileRef[][],
    cIdxA: number,
    cIdxB: number,
  ): void {
    const clusterTerritoryIds = this.clusterTerritoryIds;
    if (clusterTerritoryIds === null) {
      return;
    }
    if (
      clusterTerritoryIds[cIdxA] !== -1 &&
      clusterTerritoryIds[cIdxA] === clusterTerritoryIds[cIdxB]
    ) {
      return;
    }
    if (
      clusterTerritoryIds[cIdxA] !== -1 &&
      clusterTerritoryIds[cIdxB] !== -1
    ) {
      return;
    }

    const startIdx = clusterTerritoryIds[cIdxB] === -1 ? cIdxB : cIdxA;
    const territoryId = this.nextTerritoryId++;

    const state = this.traversalState();
    const visited = state.visited;
    const floodGen = this.bumpGeneration();
    const stack = state.stack;
    stack.length = 0;

    const start = clusters[startIdx]?.[0];
    const map = this.map;
    const myOwner = this.player.smallID();
    if (start === undefined || map.ownerID(start) !== myOwner) {
      return;
    }
    visited[start] = floodGen;
    stack.push(start);
    clusterTerritoryIds[startIdx] = territoryId;

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const numNeighbors = map.neighbors8(tile, this.nbuf8);
      for (let nIdx = 0; nIdx < numNeighbors; nIdx++) {
        const n = this.nbuf8[nIdx];
        if (visited[n] === floodGen) continue;
        if (map.ownerID(n) === myOwner) {
          visited[n] = floodGen;
          stack.push(n);
          const cIdxPlusOne = state.clusterIndexMap[n];
          if (cIdxPlusOne > 0) {
            clusterTerritoryIds[cIdxPlusOne - 1] = territoryId;
          }
        }
      }
    }
  }

  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects for every target evaluated.
  private surroundedBySamePlayer(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): Player | null {
    let singleEnemySmallId = 0;

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tile = cluster[j];
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        return null;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === mySmallID) {
          continue;
        }
        if (ownerId === 0) {
          // Unowned neighbor / wilderness / water / fallout: escape route for sovereign body
          return null;
        }
        if (singleEnemySmallId === 0) {
          singleEnemySmallId = ownerId;
        } else if (singleEnemySmallId !== ownerId) {
          // Multi-enemy border: immediate O(1) early exit
          return null;
        }
        const px = map.x(n);
        const py = map.y(n);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }

    if (
      singleEnemySmallId !== 0 &&
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      return this.mg.playerBySmallID(singleEnemySmallId) as Player;
    }
    return null;
  }

  /**
   * The enemy box test ignores unclaimed land. Coast or map edge rules out annexation.
   * Coast, map edge or open land return 0 (never annexed).
   */
  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects.
  private classifyCluster(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): number {
    let hasEnemy = false;
    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tr = cluster[j];
      if (map.isShore(tr) || map.isOnEdgeOfMap(tr)) {
        return 0;
      }
      const numNeighbors = map.neighbors4(tr, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId !== 0 && ownerId !== mySmallID) {
          hasEnemy = true;
          const x = map.x(n);
          const y = map.y(n);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        } else if (ownerId === 0) {
          if (map.hasFallout(n)) {
            const x = map.x(n);
            const y = map.y(n);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          } else {
            return 0;
          }
        }
      }
    }
    if (!hasEnemy) {
      return 0;
    }
    if (
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      return CLUSTER_SURROUNDED;
    }
    return 0;
  }

  private removeCluster(
    cluster: readonly TileRef[],
    minX?: number,
    minY?: number,
    maxX?: number,
    maxY?: number,
    knownCaptor?: Player,
    isPinched?: boolean,
  ): boolean {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return false;
      }
    }

    const firstTile = cluster[0];
    if (firstTile === undefined) {
      return false;
    }

    if (
      minX === undefined ||
      minY === undefined ||
      maxX === undefined ||
      maxY === undefined
    ) {
      const map = this.map;
      minX = map.x(firstTile);
      minY = map.y(firstTile);
      maxX = minX;
      maxY = minY;
      for (let i = 1; i < cluster.length; i++) {
        const t = cluster[i];
        const x = map.x(t);
        const y = map.y(t);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const pinched = isPinched ?? this.hasDiagonalPinch(cluster);

    // Fast path: for unpinched clusters (single 4-way component), evaluate
    // once. If unsealed, abort immediately in O(1) without looping cluster tiles.
    if (!pinched) {
      const capturing = knownCaptor ?? this.getCapturingPlayer(cluster);
      if (capturing === null) {
        return false;
      }
      if (!this.isEnclosed(firstTile, minX, minY, maxX, maxY)) {
        return false;
      }
      const tiles = this.floodFillWithGen(
        this.bumpGeneration(),
        this.traversalState().visited,
        [firstTile],
        false,
        (tile) => this.mg.ownerID(tile) === this.player.smallID(),
      );
      if (this.player.numTilesOwned() === tiles.length) {
        this.mg.conquerPlayer(capturing, this.player);
      }
      for (const tile of tiles) {
        capturing.conquer(tile);
      }
      return true;
    }

    // Pinched clusters: handle each 4-way component independently
    const state = this.traversalState();
    const floodGen = this.bumpGeneration();
    const visited = state.visited;
    let anyRemoved = false;

    for (let i = 0; i < cluster.length; i++) {
      if (!this.player.isAlive()) break;
      const t = cluster[i];
      if (
        visited[t] === floodGen ||
        this.mg.ownerID(t) !== this.player.smallID()
      ) {
        continue;
      }

      // The checks above only ever looked at this one cluster of border tiles,
      // but the fill below hands over the whole territory the cluster sits on.
      // Verify this specific 4-way component is sealed in before conquering it.
      if (!this.isEnclosed(t, minX, minY, maxX, maxY)) {
        // Mark all reachable tiles of this component within the fence as floodGen,
        // guaranteeing no other seed in this component repeats the walk, while
        // safely halting at the fence to avoid flooding the open empire.
        this.markRejectedComponent(
          t,
          floodGen,
          minX - 1,
          minY - 1,
          maxX + 1,
          maxY + 1,
        );
        continue;
      }

      const tiles = this.floodFillWithGen(
        floodGen,
        visited,
        [t],
        false,
        (tile) => this.mg.ownerID(tile) === this.player.smallID(),
      );

      if (tiles.length > 0) {
        const componentCaptor = knownCaptor ?? this.getCapturingPlayer(tiles);
        if (componentCaptor === null) {
          continue;
        }
        anyRemoved = true;
        if (this.player.numTilesOwned() === tiles.length) {
          this.mg.conquerPlayer(componentCaptor, this.player);
        }
        for (const tile of tiles) {
          componentCaptor.conquer(tile);
        }
      }
    }

    return anyRemoved;
  }

  private markRejectedComponent(
    start: TileRef,
    floodGen: number,
    fenceMinX: number,
    fenceMinY: number,
    fenceMaxX: number,
    fenceMaxY: number,
  ): void {
    const state = this.traversalState();
    const visited = state.visited;
    const stack = state.stack;
    const map = this.map;
    const mySmallID = this.player.smallID();
    const mapWidth = map.width();

    stack.length = 0;
    visited[start] = floodGen;
    stack.push(start);

    while (stack.length > 0) {
      const cur = stack.pop()!;
      const numN = map.neighbors4(cur, this.nbuf);
      for (let i = 0; i < numN; i++) {
        const n = this.nbuf[i];
        if (visited[n] === floodGen || map.ownerID(n) !== mySmallID) {
          continue;
        }
        const x = n % mapWidth;
        const y = (n / mapWidth) | 0;
        if (
          x >= fenceMinX &&
          x <= fenceMaxX &&
          y >= fenceMinY &&
          y <= fenceMaxY
        ) {
          visited[n] = floodGen;
          stack.push(n);
        }
      }
    }
  }

  /**
   * Whether the player's territory reachable from `start` is walled in by
   * other players: walking from it strictly through our own tiles can never
   * reach water, clean unclaimed wilderness, or the edge of the map.
   *
   * Traversal is strictly restricted to tiles owned by the player; enemy tiles
   * and active fallout (craters) are treated as boundary walls, while open
   * water, clean unclaimed land, and the map edge are escape paths.
   */
  private isEnclosed(
    start: TileRef,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): boolean {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    const gen = bumpTraversalGeneration(state);
    const visited = state.visited;
    const stack = state.stack;
    stack.length = 0;
    visited[start] = gen;
    stack.push(start);

    const fenceMinX = minX - 1;
    const fenceMaxX = maxX + 1;
    const fenceMinY = minY - 1;
    const fenceMaxY = maxY + 1;
    const mapWidth = map.width();

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const x = tile % mapWidth;
      const y = (tile / mapWidth) | 0;
      if (x < fenceMinX || x > fenceMaxX || y < fenceMinY || y > fenceMaxY) {
        return false;
      }
      if (map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        if (visited[n] === gen) {
          continue;
        }
        const ownerId = map.ownerID(n);
        if (ownerId === mySmallID) {
          visited[n] = gen;
          stack.push(n);
          continue;
        }
        if (ownerId === 0) {
          if (!map.isLand(n) || !map.hasFallout(n)) {
            // Open water or clean, non-irradiated unclaimed land is an escape path.
            return false;
          }
          // Irradiated unclaimed land (fallout crater) is a boundary wall.
          continue;
        }
        // Non-friendly tiles reaching here are enemy tiles: treat as boundary walls.
        continue;
      }
    }
    return true;
  }

  private getCapturingPlayer(cluster: readonly TileRef[]): Player | null {
    const neighbors = new Map<Player, number>();
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const t of cluster) {
      const numNeighbors = map.neighbors4(t, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const ownerId = map.ownerID(this.nbuf[i]);
        if (ownerId === 0 || ownerId === mySmallID) {
          continue;
        }
        const owner = this.mg.playerBySmallID(ownerId) as Player;
        if (!owner.isFriendly(this.player)) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      }
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const [neighbor] of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    if (largestNeighborAttack !== null) {
      return largestNeighborAttack;
    }

    // There are no ongoing attacks, so find the enemy with the largest border.
    return getMode(neighbors);
  }

  private calculateClusters(): { clusters: TileRef[][]; boxes: Int32Array } {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0)
      return { clusters: [], boxes: new Int32Array(0) };

    const state = this.traversalState();
    const visited = state.visited;
    // Two generation stamps on the one scratch array: first stamp every
    // border tile with `borderGen`, then flood with `currentGen`. Membership
    // becomes a single typed-array read instead of a hash probe for each of
    // the 8 neighbours of every border tile (this fill was ~15 % of a
    // headless game's CPU).
    const borderGen = this.bumpGenerations(2);
    const currentGen = borderGen + 1;
    borderTiles.forEach((tile) => {
      visited[tile] = borderGen;
    });

    const clusters: TileRef[][] = [];
    let boxes = new Int32Array(64);
    let clusterIdx = 0;

    // Set.forEach instead of for..of: iterating a large Set allocates an
    // iterator-result object per element, and border sets can be huge.
    const includeFn = (tile: TileRef) => visited[tile] === borderGen;
    borderTiles.forEach((startTile) => {
      if (visited[startTile] === currentGen) return;

      if (clusterIdx * 4 >= boxes.length) {
        const newBoxes = new Int32Array(boxes.length * 2);
        newBoxes.set(boxes);
        boxes = newBoxes;
      }

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        true,
        includeFn,
        boxes,
        clusterIdx * 4,
      );
      clusters.push(cluster);
      clusterIdx++;
    });
    return { clusters, boxes };
  }

  owner(): Player {
    if (this.player === null) {
      throw new Error("Not initialized");
    }
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  private traversalState(): TileTraversalScratch {
    return tileTraversalScratch(this.mg);
  }

  private bumpGeneration(): number {
    return bumpTraversalGeneration(this.traversalState());
  }

  /**
   * Starts `count` passes at once and returns the first generation; the
   * others follow it in order. Use it for stamps that must stay live
   * together: if the counter wraps, which clears every stamp, it takes a
   * fresh run after the wrap.
   */
  private bumpGenerations(count: number): number {
    const first = this.bumpGeneration();
    let last = first;
    for (let i = 1; i < count; i++) last = this.bumpGeneration();
    return last - first === count - 1 ? first : this.bumpGenerations(count);
  }

  // Perf: Replaced `neighborFn` closure parameter with a native 1D loop via `GameMap.neighbors8/4`.
  // Computes cluster boundary extremes natively inside `outBox` without requiring a secondary iterator pass.
  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: readonly TileRef[],
    diag: boolean,
    includeFn: (tile: TileRef) => boolean,
    outBox?: Int32Array,
    outBoxOffset?: number,
  ): TileRef[] {
    // The visited generation array already deduplicates, so the result can be
    // a plain array (in mark order) — far cheaper than a Set of the same
    // size. The DFS stack is reused across fills via the traversal state.
    const result: TileRef[] = [];
    const stack = this.traversalState().stack;
    stack.length = 0;

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    const map = this.map;

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.push(start);
      stack.push(start);
      if (outBox !== undefined) {
        const x = map.x(start);
        const y = map.y(start);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }

    const nbuf = diag ? this.nbuf8 : this.nbuf;

    while (stack.length > 0) {
      const tile = stack.pop()!;
      const numNeighbors = diag
        ? map.neighbors8(tile, nbuf)
        : map.neighbors4(tile, nbuf);

      for (let i = 0; i < numNeighbors; i++) {
        const neighbor = nbuf[i];
        if (visited[neighbor] === currentGen) continue;
        if (!includeFn(neighbor)) continue;

        visited[neighbor] = currentGen;
        result.push(neighbor);
        stack.push(neighbor);

        if (outBox !== undefined) {
          const x = map.x(neighbor);
          const y = map.y(neighbor);
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    // Perf: Commit the cluster's boundary extremes directly into the pre-allocated flat Int32Array.
    // The array stores consecutive [minX, minY, maxX, maxY] structs linearly via `outBoxOffset`.
    // By passing outBox down to the DFS, we completely sidestep allocating and returning temporary `Box` or `Cell` objects.
    if (outBox !== undefined && outBoxOffset !== undefined) {
      outBox[outBoxOffset] = minX;
      outBox[outBoxOffset + 1] = minY;
      outBox[outBoxOffset + 2] = maxX;
      outBox[outBoxOffset + 3] = maxY;
    }

    return result;
  }

  private removeOnDeath(): void {
    // Player (bot, human, nation) has no tiles
    // Delete any remaining gold, non-nuke units and alliances
    const gold = this.player.gold();
    this.player.removeGold(gold);

    this.player.units().forEach((u) => {
      if (
        u.type() !== UnitType.AtomBomb &&
        u.type() !== UnitType.HydrogenBomb &&
        u.type() !== UnitType.MIRVWarhead &&
        u.type() !== UnitType.MIRV
      ) {
        u.delete();
      }
    });

    this.player.removeAllAlliances();
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return PlayerExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      lastCalc: this.lastCalc,
      player: w.player(this.player),
    });
  }

  restoreSnapshot(s: PlayerExecState, r: SnapshotReader): void {
    this.ticksPerClusterCalc = TICKS_PER_CLUSTER_CALC;
    this.active = s.active;
    if (s.initialized) {
      this.mg = r.game;
      this.map = r.game.map();
      this.config = r.game.config();
    }
    this.lastCalc = s.lastCalc;
    // Scratch neighbor buffers: always written before they are read.
    this.nbuf = [0, 0, 0, 0];
    this.nbuf8 = [0, 0, 0, 0, 0, 0, 0, 0];
    this.clusterTerritoryIds = null;
    this.nextTerritoryId = 1;
    this.player = r.player(s.player);
  }
}

const PlayerExecStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  lastCalc: zInt(),
  player: zPlayerRef(),
});
type PlayerExecState = z.infer<typeof PlayerExecStateSchema>;

export const PlayerExecutionSnapshot = execSnapshotType({
  name: "Player",
  version: 1,
  schema: PlayerExecStateSchema,
  cls: () => PlayerExecution,
});
