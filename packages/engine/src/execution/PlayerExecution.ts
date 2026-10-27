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
// Touches coast, map edge or open land: never land cut off with no way out.
const CLUSTER_OPEN = 4;

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

    if (clusters.length === 1) {
      this.player.largestClusterBoundingBox = {
        min: new Cell(boxes[0], boxes[1]),
        max: new Cell(boxes[2], boxes[3]),
      };
      let removed = false;
      const surroundedBy = this.surroundedBySamePlayer(
        clusters[0],
        boxes[0],
        boxes[1],
        boxes[2],
        boxes[3],
      );
      if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
        removed = this.removeCluster(
          clusters[0],
          boxes[0],
          boxes[1],
          boxes[2],
          boxes[3],
          surroundedBy,
        );
      }
      const isPinched = this.hasDiagonalPinch(clusters[0]);
      if (!removed && isPinched) {
        const state = this.traversalState();
        const visited = state.visited;
        const stack = state.stack;
        const map = this.map;
        const mySmallID = this.player.smallID();
        let maxTerritory = 0;
        let gen = this.bumpGenerations(16);
        const territoryAreas: number[] = [0];
        const tileTIds = new Int32Array(clusters[0].length);
        let nextTId = 1;
        for (let j = 0; j < clusters[0].length; j++) {
          const t = clusters[0][j];
          if (state.gen < gen) gen = this.bumpGeneration();
          if (visited[t] >= gen) {
            const tId = visited[t] - gen + 1;
            tileTIds[j] = tId;
            const sz = territoryAreas[tId];
            if (sz > maxTerritory) maxTerritory = sz;
            continue;
          }
          if (map.ownerID(t) !== mySmallID) continue;
          const tId = nextTId++;
          tileTIds[j] = tId;
          const tGen = gen + tId - 1;
          while (state.gen < tGen && state.gen >= gen) {
            this.bumpGeneration();
          }
          visited[t] = tGen;
          stack.length = 0;
          stack.push(t);
          let sz = 0;
          while (stack.length > 0) {
            const cur = stack.pop()!;
            sz++;
            const numNeighbors = map.neighbors4(cur, this.nbuf);
            for (let k = 0; k < numNeighbors; k++) {
              const n = this.nbuf[k];
              if (visited[n] < gen && map.ownerID(n) === mySmallID) {
                visited[n] = tGen;
                stack.push(n);
              }
            }
          }
          territoryAreas[tId] = sz;
          if (sz > maxTerritory) maxTerritory = sz;
        }
        this.evaluatePinchCandidates(
          clusters[0],
          maxTerritory,
          tileTIds,
          territoryAreas,
        );
      }
      return;
    }

    const map = this.map;
    let hasInscribedBox = false;
    for (let i = 0; i < clusters.length && !hasInscribedBox; i++) {
      const iMinX = boxes[i * 4];
      const iMinY = boxes[i * 4 + 1];
      const iMaxX = boxes[i * 4 + 2];
      const iMaxY = boxes[i * 4 + 3];
      for (let j = 0; j < clusters.length; j++) {
        if (i !== j) {
          const jIdx = j * 4;
          if (
            boxes[jIdx] <= iMinX &&
            boxes[jIdx + 1] <= iMinY &&
            boxes[jIdx + 2] >= iMaxX &&
            boxes[jIdx + 3] >= iMaxY
          ) {
            hasInscribedBox = true;
            break;
          }
        }
      }
    }

    const isPinched = new Uint8Array(clusters.length);
    let hasPinch = false;
    for (let i = 0; i < clusters.length; i++) {
      if (this.hasDiagonalPinch(clusters[i])) {
        isPinched[i] = 1;
        hasPinch = true;
      }
    }

    let hasFallout = false;
    if (!hasInscribedBox && !hasPinch) {
      for (let i = 0; i < clusters.length && !hasFallout; i++) {
        const cl = clusters[i];
        for (let j = 0; j < cl.length; j++) {
          const t = cl[j];
          const numN = map.neighbors4(t, this.nbuf);
          for (let k = 0; k < numN; k++) {
            if (map.hasFallout(this.nbuf[k])) {
              hasFallout = true;
              break;
            }
          }
          if (hasFallout) break;
        }
      }
    }

    let largestIndex = 0;
    let maxTerritoryArea = 0;
    const clusterSizes = new Int32Array(clusters.length);
    let territoryAreas: number[] | undefined;
    let clusterTileTIds: Int32Array[] | undefined;

    if (!hasInscribedBox && !hasPinch && !hasFallout) {
      maxTerritoryArea = this.player.numTilesOwned();
      for (let i = 1; i < clusters.length; i++) {
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
    } else {
      // Sovereign invariant ranking: determine the primary territory by measuring the
      // largest contiguous 4-way territory area reachable from each border cluster,
      // rather than raw border tile count (which can be distorted by craters or enclaves).
      const state = this.traversalState();
      const reservedGenerations = clusters.length * 4 + 16;
      const areaGen = this.bumpGenerations(reservedGenerations);
      const visited = state.visited;
      const stack = state.stack;
      const mySmallID = this.player.smallID();
      territoryAreas = [0];
      clusterTileTIds = new Array(clusters.length);

      let nextTId = 1;
      for (let i = 0; i < clusters.length; i++) {
        const cluster = clusters[i];
        const tileTIds = new Int32Array(cluster.length);
        clusterTileTIds[i] = tileTIds;
        let maxClusterTerritory = 0;
        for (let j = 0; j < cluster.length; j++) {
          const t = cluster[j];
          if (visited[t] >= areaGen) {
            const tId = visited[t] - areaGen + 1;
            tileTIds[j] = tId;
            const sz = territoryAreas[tId];
            if (sz > maxClusterTerritory) maxClusterTerritory = sz;
            continue;
          }
          if (map.ownerID(t) !== mySmallID) continue;
          const tId = nextTId++;
          tileTIds[j] = tId;
          const tGen = areaGen + tId - 1;
          while (state.gen < tGen && state.gen >= areaGen) {
            this.bumpGeneration();
          }
          visited[t] = tGen;
          stack.length = 0;
          stack.push(t);
          let size = 0;
          while (stack.length > 0) {
            const cur = stack.pop()!;
            size++;
            const numNeighbors = map.neighbors4(cur, this.nbuf);
            for (let k = 0; k < numNeighbors; k++) {
              const n = this.nbuf[k];
              if (visited[n] < areaGen && map.ownerID(n) === mySmallID) {
                visited[n] = tGen;
                stack.push(n);
              }
            }
          }
          territoryAreas[tId] = size;
          if (size > maxClusterTerritory) maxClusterTerritory = size;
        }
        clusterSizes[i] = maxClusterTerritory;
        if (maxClusterTerritory > maxTerritoryArea) {
          maxTerritoryArea = maxClusterTerritory;
        }
      }

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
          }
        }
      }
    }

    // Fix: Doughnut borders. Prevents a heavily deformed crater (hole) from having more border tiles
    // and falsely claiming primary cluster. A cluster is a hole if it is completely enclosed by another
    // cluster of the SAME contiguous territory. Bbox containment alone is insufficient (disjoint C-shapes).
    const clusterTerritoryIdsRef: { ids: Int32Array | null } = { ids: null };
    const nextTerritoryIdRef = { id: 1 };

    if (
      this.isHoleCluster(
        largestIndex,
        clusters,
        boxes,
        clusterTerritoryIdsRef,
        nextTerritoryIdRef,
      )
    ) {
      let bestIndex = -1;
      let bestArea = -1;
      let bestLength = -1;
      for (let i = 0; i < clusters.length; i++) {
        if (i === largestIndex) continue;
        if (
          clusterSizes[i] < bestArea ||
          (clusterSizes[i] === bestArea && clusters[i].length <= bestLength)
        ) {
          continue;
        }
        if (
          !this.isHoleCluster(
            i,
            clusters,
            boxes,
            clusterTerritoryIdsRef,
            nextTerritoryIdRef,
          )
        ) {
          bestArea = clusterSizes[i];
          bestLength = clusters[i].length;
          bestIndex = i;
        }
      }
      if (bestIndex !== -1) {
        largestIndex = bestIndex;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const lIdx = largestIndex * 4;
    this.player.largestClusterBoundingBox = {
      min: new Cell(boxes[lIdx], boxes[lIdx + 1]),
      max: new Cell(boxes[lIdx + 2], boxes[lIdx + 3]),
    };

    // Classify the remaining clusters before the surrounded checks hand any
    // land over. The classification of each cluster reads only its own
    // side-by-side neighbours, none of them ours, so taking other land leaves
    // it the same before as after.
    const classes = new Uint8Array(clusters.length);
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      const idx = i * 4;
      classes[i] = this.classifyCluster(
        cluster,
        boxes[idx],
        boxes[idx + 1],
        boxes[idx + 2],
        boxes[idx + 3],
      );
    }

    const clusterRemoved = new Uint8Array(clusters.length);

    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      boxes[lIdx],
      boxes[lIdx + 1],
      boxes[lIdx + 2],
      boxes[lIdx + 3],
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      const removed = this.removeCluster(
        largestCluster,
        boxes[lIdx],
        boxes[lIdx + 1],
        boxes[lIdx + 2],
        boxes[lIdx + 3],
        surroundedBy,
      );
      if (removed) {
        clusterRemoved[largestIndex] = 1;
      }
    }

    // 1. Whole-cluster removal pass for secondary clusters
    for (let i = 0; i < clusters.length; i++) {
      if (!this.player.isAlive()) break;
      if (i === largestIndex) continue;
      if (classes[i] & CLUSTER_SURROUNDED) {
        const idx = i * 4;
        if (isPinched[i]) {
          const surroundedBy = this.surroundedBySamePlayer(
            clusters[i],
            boxes[idx],
            boxes[idx + 1],
            boxes[idx + 2],
            boxes[idx + 3],
          );
          if (!surroundedBy || surroundedBy.isFriendly(this.player)) {
            continue;
          }
          const removed = this.removeCluster(
            clusters[i],
            boxes[idx],
            boxes[idx + 1],
            boxes[idx + 2],
            boxes[idx + 3],
            surroundedBy,
          );
          if (removed) {
            clusterRemoved[i] = 1;
          }
          continue;
        }
        const removed = this.removeCluster(
          clusters[i],
          boxes[idx],
          boxes[idx + 1],
          boxes[idx + 2],
          boxes[idx + 3],
        );
        if (removed) {
          clusterRemoved[i] = 1;
        }
      }
    }

    // 2. Pinch pass
    for (let i = 0; i < clusters.length; i++) {
      if (!this.player.isAlive()) break;
      if (clusterRemoved[i]) continue;
      if (!isPinched[i]) continue;
      // Guard interior hole clusters so hole crenellations are not falsely annexed
      if (
        this.isHoleCluster(
          i,
          clusters,
          boxes,
          clusterTerritoryIdsRef,
          nextTerritoryIdRef,
        )
      ) {
        continue;
      }
      this.evaluatePinchCandidates(
        clusters[i],
        maxTerritoryArea,
        clusterTileTIds?.[i],
        territoryAreas,
      );
    }

    if (clusterTerritoryIdsRef.ids) {
      const scratch = this.traversalState();
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        for (let k = 0; k < cl.length; k++) {
          scratch.clusterIndexMap[cl[k]] = 0;
        }
      }
    }
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

  private isHoleCluster(
    i: number,
    clusters: TileRef[][],
    boxes: Int32Array,
    clusterTerritoryIdsRef: { ids: Int32Array | null },
    nextTerritoryIdRef: { id: number },
  ): boolean {
    const iIdx = i * 4;
    const iMinX = boxes[iIdx];
    const iMinY = boxes[iIdx + 1];
    const iMaxX = boxes[iIdx + 2];
    const iMaxY = boxes[iIdx + 3];

    for (let j = 0; j < clusters.length; j++) {
      if (j !== i) {
        const jIdx = j * 4;
        if (
          boxes[jIdx] <= iMinX &&
          boxes[jIdx + 1] <= iMinY &&
          boxes[jIdx + 2] >= iMaxX &&
          boxes[jIdx + 3] >= iMaxY
        ) {
          if (!clusterTerritoryIdsRef.ids) {
            clusterTerritoryIdsRef.ids = new Int32Array(clusters.length);
            const scratch = this.traversalState();
            for (let c = 0; c < clusters.length; c++) {
              const cl = clusters[c];
              for (let k = 0; k < cl.length; k++) {
                scratch.clusterIndexMap[cl[k]] = c + 1;
              }
            }
          }
          nextTerritoryIdRef.id = this.checkAndAssignTerritory(
            clusters,
            i,
            j,
            clusterTerritoryIdsRef.ids,
            nextTerritoryIdRef.id,
          );
          if (clusterTerritoryIdsRef.ids[i] === clusterTerritoryIdsRef.ids[j]) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private checkAndAssignTerritory(
    clusters: TileRef[][],
    cIdxA: number,
    cIdxB: number,
    clusterTerritoryIds: Int32Array,
    nextTerritoryId: number,
  ): number {
    if (
      clusterTerritoryIds[cIdxA] !== 0 &&
      clusterTerritoryIds[cIdxA] === clusterTerritoryIds[cIdxB]
    ) {
      return nextTerritoryId;
    }
    if (clusterTerritoryIds[cIdxA] !== 0 && clusterTerritoryIds[cIdxB] !== 0) {
      return nextTerritoryId;
    }

    const startIdx = clusterTerritoryIds[cIdxB] === 0 ? cIdxB : cIdxA;
    const territoryId = nextTerritoryId++;

    const state = this.traversalState();
    const visited = state.visited;
    const floodGen = this.bumpGeneration();
    const stack = state.stack;
    stack.length = 0;

    const start = clusters[startIdx]?.[0];
    const map = this.map;
    const myOwner = this.player.smallID();
    if (start === undefined || map.ownerID(start) !== myOwner) {
      return nextTerritoryId;
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
    return nextTerritoryId;
  }

  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects for every target evaluated.
  private surroundedBySamePlayer(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): false | Player {
    const enemies = new Set<number>();

    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tile = cluster[j];
      if (map.isOceanShore(tile) || map.isOnEdgeOfMap(tile)) {
        return false;
      }
      const numNeighbors = map.neighbors4(tile, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        const n = this.nbuf[i];
        const ownerId = map.ownerID(n);
        if (ownerId === 0) {
          // Unowned neighbor: the cluster is not fully surrounded.
          return false;
        }
        if (ownerId !== mySmallID) {
          enemies.add(ownerId);
          const px = map.x(n);
          const py = map.y(n);
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      }
      if (enemies.size > 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }

    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    if (
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      return enemy;
    }
    return false;
  }

  /**
   * The enemy box test ignores unclaimed land. Coast or map edge rules out annexation.
   * Coast, map edge or open land make it CLUSTER_OPEN.
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
    let hasOpenLand = false;
    let hasFallout = false;
    let minX = 1e9,
      minY = 1e9,
      maxX = -1e9,
      maxY = -1e9;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let j = 0; j < cluster.length; j++) {
      const tr = cluster[j];
      if (map.isShore(tr) || map.isOnEdgeOfMap(tr)) {
        return CLUSTER_OPEN;
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
            hasFallout = true;
            const x = map.x(n);
            const y = map.y(n);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          } else {
            hasOpenLand = true;
          }
        }
      }
    }
    void hasFallout;
    if (!hasEnemy) {
      return hasOpenLand ? CLUSTER_OPEN : 0;
    }
    let result = hasOpenLand ? CLUSTER_OPEN : 0;
    if (
      !hasOpenLand &&
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    ) {
      result |= CLUSTER_SURROUNDED;
    }
    return result;
  }

  private removeCluster(
    cluster: readonly TileRef[],
    minX?: number,
    minY?: number,
    maxX?: number,
    maxY?: number,
    knownCaptor?: Player,
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

    // The checks above only ever looked at this one cluster of border tiles,
    // but the fill below hands over the whole territory the cluster sits on.
    // Those are different sets: every hole in a territory — an enemy enclave,
    // a nuke crater — gives it another border cluster, so a cluster that
    // passes can be wrapped around a hole in the middle of a wide open
    // empire. Verify the land actually changing hands is sealed in.
    if (!this.isEnclosed(firstTile, minX, minY, maxX, maxY)) {
      return false;
    }

    const capturing = knownCaptor ?? this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return false;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      cluster,
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
