import { z } from "zod";
import { Config } from "../configuration/Config";
import {
  Cell,
  Execution,
  Game,
  Player,
  PlayerType,
  Structures,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
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
import { zInt, zPlayerRef } from "../snapshot/SnapshotType";
import { getMode, simpleHash } from "../Util";

const TICKS_PER_CLUSTER_CALC = 20;

export class PlayerExecution implements Execution {
  private ticksPerClusterCalc = TICKS_PER_CLUSTER_CALC;

  private config: Config;
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
      const surroundedBy = this.surroundedBySamePlayer(
        clusters[0],
        boxes[0],
        boxes[1],
        boxes[2],
        boxes[3],
      );
      if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
        this.removeCluster(clusters[0]);
      }
      return;
    }

    let largestIndex = 0;
    for (let i = 1; i < clusters.length; i++) {
      if (clusters[i].length > clusters[largestIndex].length) {
        largestIndex = i;
      }
    }

    const tMinX = boxes[largestIndex * 4];
    const tMinY = boxes[largestIndex * 4 + 1];
    const tMaxX = boxes[largestIndex * 4 + 2];
    const tMaxY = boxes[largestIndex * 4 + 3];

    // Fix: Doughnut borders. Prevents a heavily deformed crater (hole) from having more border tiles
    // and falsely claiming primary cluster. A cluster is a hole if it is completely enclosed by another
    // cluster of the SAME contiguous territory. Bbox containment alone is insufficient (disjoint C-shapes).
    let clusterTerritoryIds: Int32Array | null = null;
    let nextTerritoryId = 1;

    let isLargestHole = false;
    for (let j = 0; j < clusters.length; j++) {
      if (j !== largestIndex) {
        const jIdx = j * 4;
        if (
          boxes[jIdx] <= tMinX &&
          boxes[jIdx + 1] <= tMinY &&
          boxes[jIdx + 2] >= tMaxX &&
          boxes[jIdx + 3] >= tMaxY
        ) {
          if (!clusterTerritoryIds) {
            clusterTerritoryIds = new Int32Array(clusters.length);
            const scratch = this.traversalState();
            for (let c = 0; c < clusters.length; c++) {
              const cl = clusters[c];
              for (let k = 0; k < cl.length; k++) {
                scratch.clusterIndexMap[cl[k]] = c + 1;
              }
            }
          }
          nextTerritoryId = this.checkAndAssignTerritory(
            clusters,
            largestIndex,
            j,
            clusterTerritoryIds,
            nextTerritoryId,
          );
          if (clusterTerritoryIds[largestIndex] === clusterTerritoryIds[j]) {
            isLargestHole = true;
            break;
          }
        }
      }
    }

    if (isLargestHole) {
      let bestIndex = -1;
      let bestLength = -1;
      for (let i = 0; i < clusters.length; i++) {
        if (i === largestIndex || clusters[i].length <= bestLength) continue;
        let isHole = false;
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
              nextTerritoryId = this.checkAndAssignTerritory(
                clusters,
                i,
                j,
                clusterTerritoryIds!,
                nextTerritoryId,
              );
              if (clusterTerritoryIds![i] === clusterTerritoryIds![j]) {
                isHole = true;
                break;
              }
            }
          }
        }
        if (!isHole) {
          bestLength = clusters[i].length;
          bestIndex = i;
        }
      }
      if (bestIndex !== -1) {
        largestIndex = bestIndex;
      }
    }

    if (clusterTerritoryIds) {
      const scratch = this.traversalState();
      for (let c = 0; c < clusters.length; c++) {
        const cl = clusters[c];
        for (let k = 0; k < cl.length; k++) {
          scratch.clusterIndexMap[cl[k]] = 0;
        }
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const lIdx = largestIndex * 4;
    this.player.largestClusterBoundingBox = {
      min: new Cell(boxes[lIdx], boxes[lIdx + 1]),
      max: new Cell(boxes[lIdx + 2], boxes[lIdx + 3]),
    };

    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      boxes[lIdx],
      boxes[lIdx + 1],
      boxes[lIdx + 2],
      boxes[lIdx + 3],
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      const idx = i * 4;
      if (
        this.isSurrounded(
          cluster,
          boxes[idx],
          boxes[idx + 1],
          boxes[idx + 2],
          boxes[idx + 3],
        )
      ) {
        this.removeCluster(cluster);
      }
    }
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

    const start = clusters[startIdx][0];
    visited[start] = floodGen;
    stack.push(start);

    const map = this.map;
    const myOwner = this.player.smallID();
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
      if (enemies.size !== 1) {
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

  // Perf: Accepts raw bounds to skip allocating {min, max} Box objects.
  private isSurrounded(
    cluster: readonly TileRef[],
    clusterBoxMinX: number,
    clusterBoxMinY: number,
    clusterBoxMaxX: number,
    clusterBoxMaxY: number,
  ): boolean {
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
        return false;
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
        }
      }
    }
    if (!hasEnemy) {
      return false;
    }
    return (
      minX <= clusterBoxMinX &&
      minY <= clusterBoxMinY &&
      maxX >= clusterBoxMaxX &&
      maxY >= clusterBoxMaxY
    );
  }

  private removeCluster(cluster: readonly TileRef[]) {
    for (const t of cluster) {
      if (this.mg?.ownerID(t) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing === null) {
      return;
    }

    const firstTile = cluster[0];
    if (firstTile === undefined) {
      return;
    }

    // The checks above only ever looked at this one cluster of border tiles,
    // but the fill below hands over the whole territory the cluster sits on.
    // Those are different sets: every hole in a territory — an enemy enclave,
    // a nuke crater — gives it another border cluster, so a cluster that
    // passes can be wrapped around a hole in the middle of a wide open
    // empire. Verify the land actually changing hands is sealed in.
    if (!this.isEnclosed(firstTile)) {
      return;
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
  }

  /**
   * Whether the player's territory reachable from `start` is walled in by
   * other players: walking from it through our own tiles and any unclaimed
   * land can never reach water or the edge of the map, so the only way out
   * is across someone else's territory.
   *
   * Unclaimed land is walked through rather than treated as a way out — a
   * crater inside our own land is a hole, not an exit — but water and the
   * map edge end it, matching what the cluster checks already require of the
   * tiles they inspect.
   */
  private isEnclosed(start: TileRef): boolean {
    const map = this.map;
    const mySmallID = this.player.smallID();
    const state = this.traversalState();
    const gen = bumpTraversalGeneration(state);
    const visited = state.visited;
    const stack = state.stack;
    stack.length = 0;
    visited[start] = gen;
    stack.push(start);

    while (stack.length > 0) {
      const tile = stack.pop()!;
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
        if (ownerId !== 0 && ownerId !== mySmallID) {
          // Someone else's tile — part of the wall, so stop here.
          continue;
        }
        if (ownerId === 0 && !map.isLand(n)) {
          // Open water is a way out.
          return false;
        }
        visited[n] = gen;
        stack.push(n);
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
    const borderGen = this.bumpGeneration();
    borderTiles.forEach((tile) => {
      visited[tile] = borderGen;
    });
    const currentGen = this.bumpGeneration();

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

  // Perf: Replaced `neighborFn` closure parameter with a native 1D loop via `GameMap.neighbors8/4`.
  // Computes cluster boundary extremes natively inside `outBox` without requiring a secondary iterator pass.
  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
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
