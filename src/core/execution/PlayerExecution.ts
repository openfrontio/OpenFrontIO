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
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";

/** A border cluster stored in PlayerExecution.clusterBuf as [start, start+len). */
interface ClusterSpan {
  start: number;
  len: number;
}

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private config: Config;
  private lastCalc = 0;
  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;
  private active = true;
  // Reusable neighbor buffer to avoid closures/allocation in cluster checks.
  private nbuf: TileRef[] = [0, 0, 0, 0];
  // 8-neighbor buffer for flood fills (diagonals included).
  private nbuf8: TileRef[] = [0, 0, 0, 0, 0, 0, 0, 0];
  // Shared backing store for border clusters, with per-cluster spans.
  private clusterBuf: TileRef[] = [];
  private clusterSpans: ClusterSpan[] = [];

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
    this.calculateClusters();
    const clusters = this.clusterSpans;

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].len;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].len;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const largestClusterBox = calculateBoundingBox(
      this.mg,
      this.clusterBuf,
      largestCluster.start,
      largestCluster.len,
    );
    this.player.largestClusterBoundingBox = largestClusterBox;
    const surroundedBy = this.surroundedBySamePlayer(
      largestCluster,
      largestClusterBox,
    );
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(largestCluster);
    }

    // Process remaining clusters
    for (let i = 0; i < clusters.length; i++) {
      if (i === largestIndex) continue;
      const cluster = clusters[i];
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(
    cluster: ClusterSpan,
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const map = this.map;
    const mySmallID = this.player.smallID();
    const buf = this.clusterBuf;
    for (let k = cluster.start; k < cluster.start + cluster.len; k++) {
      const tile = buf[k];
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
          minX = Math.min(minX, px);
          minY = Math.min(minY, py);
          maxX = Math.max(maxX, px);
          maxY = Math.max(maxY, py);
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
    const localEnemyBox = {
      min: new Cell(minX, minY),
      max: new Cell(maxX, maxY),
    };
    if (inscribed(localEnemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: ClusterSpan): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const map = this.map;
    const mySmallID = this.player.smallID();
    const buf = this.clusterBuf;
    for (let k = cluster.start; k < cluster.start + cluster.len; k++) {
      const tr = buf[k];
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
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!hasEnemy) {
      return false;
    }
    const clusterBox = calculateBoundingBox(
      this.mg,
      this.clusterBuf,
      cluster.start,
      cluster.len,
    );
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  /**
   * removeClusters() passes spans into the shared clusterBuf; the
   * TileRef[] overload is kept for tests that drive this internal API
   * directly (AnnexationRequiresEnclosure.test.ts).
   */
  private removeCluster(cluster: ClusterSpan | readonly TileRef[]) {
    const isSpan = !Array.isArray(cluster);
    const buf = isSpan ? this.clusterBuf : cluster;
    const start = isSpan ? (cluster as ClusterSpan).start : 0;
    const end = isSpan ? start + (cluster as ClusterSpan).len : cluster.length;
    for (let k = start; k < end; k++) {
      if (this.mg?.ownerID(buf[k]) !== this.player?.smallID()) {
        // Other removeCluster operations could change tile owners,
        // so double check.
        return;
      }
    }

    const capturing = this.getCapturingPlayer(buf, start, end);
    if (capturing === null) {
      return;
    }

    if (end <= start) {
      return;
    }
    const firstTile = buf[start];
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
      (tile, out) => this.map.neighbors4(tile, out),
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

  private getCapturingPlayer(
    buf: readonly TileRef[],
    start: number,
    end: number,
  ): Player | null {
    const neighbors = new Map<Player, number>();
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (let k = start; k < end; k++) {
      const t = buf[k];
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

  /**
   * Floods all border clusters and stores them as spans into the shared
   * clusterBuf, replacing per-cluster TileRef[] allocations (the previous
   * floodFillWithGen result arrays) with a single reused buffer. Called from
   * removeClusters, which consumes the spans synchronously.
   */
  private calculateClusters(): void {
    const borderTiles = this.player.borderTiles();
    this.clusterSpans.length = 0;
    if (borderTiles.size === 0) {
      this.clusterBuf.length = 0;
      return;
    }

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;
    const stack = state.stack;

    const buf = this.clusterBuf;
    let used = 0;
    const out = this.nbuf8;

    // Set.forEach instead of for..of: iterating a large Set allocates an
    // iterator-result object per element, and border sets can be huge.
    borderTiles.forEach((startTile) => {
      if (visited[startTile] === currentGen) return;

      const start = used;
      // Inline flood fill (same DFS order as floodFillWithGen: LIFO stack,
      // dx-major neighbors via neighbors8).
      visited[startTile] = currentGen;
      buf[used++] = startTile;
      stack.length = 0;
      stack.push(startTile);
      while (stack.length > 0) {
        const tile = stack.pop()!;
        const numNeighbors = this.map.neighbors8(tile, out);
        for (let i = 0; i < numNeighbors; i++) {
          const neighbor = out[i];
          if (visited[neighbor] === currentGen) {
            continue;
          }
          if (!borderTiles.has(neighbor)) {
            continue;
          }
          visited[neighbor] = currentGen;
          buf[used++] = neighbor;
          stack.push(neighbor);
        }
      }
      this.clusterSpans.push({ start, len: used - start });
    });
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

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, out: TileRef[]) => number,
    includeFn: (tile: TileRef) => boolean,
  ): TileRef[] {
    // The visited generation array already deduplicates, so the result can be
    // a plain array (in mark order) — far cheaper than a Set of the same
    // size. The DFS stack is reused across fills via the traversal state.
    const result: TileRef[] = [];
    const stack = this.traversalState().stack;
    stack.length = 0;

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.push(start);
      stack.push(start);
    }

    // Neighbors are written into a reusable buffer instead of being pushed
    // through a per-neighbor callback closure (forEachNeighbor*), which was
    // the hottest per-tile cost in cluster recomputation.
    const out = this.nbuf8;
    while (stack.length > 0) {
      const tile = stack.pop()!;
      const numNeighbors = neighborFn(tile, out);
      for (let i = 0; i < numNeighbors; i++) {
        const neighbor = out[i];
        if (visited[neighbor] === currentGen) {
          continue;
        }
        if (!includeFn(neighbor)) {
          continue;
        }
        visited[neighbor] = currentGen;
        result.push(neighbor);
        stack.push(neighbor);
      }
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
}
