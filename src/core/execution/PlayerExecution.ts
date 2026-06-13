import { Config } from "../configuration/Config";
import {
  Cell,
  Execution,
  Game,
  Player,
  Structures,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";

interface ClusterTraversalState {
  visited: Uint32Array;
  gen: number;
}

// Per-game traversal state used by calculateClusters() to avoid per-player buffers.
const traversalStates = new WeakMap<Game, ClusterTraversalState>();

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

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.map = mg.map();
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
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
    const clusters = this.calculateClusters();

    if (clusters.length === 0) {
      this.player.largestClusterBoundingBox = null;
      return;
    }

    // Find the largest cluster with a single linear scan (O(n)).
    let largestIndex = 0;
    let largestSize = clusters[0].size;
    for (let i = 1; i < clusters.length; i++) {
      const size = clusters[i].size;
      if (size > largestSize) {
        largestSize = size;
        largestIndex = i;
      }
    }

    const largestCluster = clusters[largestIndex];
    if (largestCluster === undefined) throw new Error("No clusters");

    const largestClusterBox = calculateBoundingBox(this.mg, largestCluster);
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
    cluster: Set<TileRef>,
    clusterBox: { min: Cell; max: Cell },
  ): false | Player {
    const enemies = new Set<number>();

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tile of cluster) {
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

  private isSurrounded(cluster: Set<TileRef>): boolean {
    let hasEnemy = false;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const map = this.map;
    const mySmallID = this.player.smallID();
    for (const tr of cluster) {
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
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    const enemyBox = { min: new Cell(minX, minY), max: new Cell(maxX, maxY) };
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
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

    const firstTile = cluster.values().next().value;
    if (!firstTile) {
      return;
    }

    const tiles = this.floodFillWithGen(
      this.bumpGeneration(),
      this.traversalState().visited,
      [firstTile],
      (tile, cb) => this.mg.forEachNeighbor(tile, cb),
      (tile) => this.mg.ownerID(tile) === this.player.smallID(),
    );

    if (this.player.numTilesOwned() === tiles.size) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
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

  private calculateClusters(): Set<TileRef>[] {
    const borderTiles = this.player.borderTiles();
    if (borderTiles.size === 0) return [];

    const state = this.traversalState();
    const currentGen = this.bumpGeneration();
    const visited = state.visited;

    const clusters: Set<TileRef>[] = [];

    for (const startTile of borderTiles) {
      if (visited[startTile] === currentGen) continue;

      const cluster = this.floodFillWithGen(
        currentGen,
        visited,
        [startTile],
        (tile, cb) => this.mg.forEachNeighborWithDiag(tile, cb),
        (tile) => borderTiles.has(tile),
      );
      clusters.push(cluster);
    }
    return clusters;
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

  private traversalState(): ClusterTraversalState {
    const totalTiles = this.mg.width() * this.mg.height();
    let state = traversalStates.get(this.mg);
    if (!state || state.visited.length < totalTiles) {
      state = {
        visited: new Uint32Array(totalTiles),
        gen: 0,
      };
      traversalStates.set(this.mg, state);
    }
    return state;
  }

  private bumpGeneration(): number {
    const state = this.traversalState();
    state.gen++;
    if (state.gen === 0xffffffff) {
      state.visited.fill(0);
      state.gen = 1;
    }
    return state.gen;
  }

  private floodFillWithGen(
    currentGen: number,
    visited: Uint32Array,
    startTiles: TileRef[],
    neighborFn: (tile: TileRef, callback: (neighbor: TileRef) => void) => void,
    includeFn: (tile: TileRef) => boolean,
  ): Set<TileRef> {
    const result = new Set<TileRef>();
    const stack: TileRef[] = [];

    for (const start of startTiles) {
      if (visited[start] === currentGen) continue;
      if (!includeFn(start)) continue;
      visited[start] = currentGen;
      result.add(start);
      stack.push(start);
    }

    const visit = (neighbor: TileRef) => {
      if (visited[neighbor] === currentGen) {
        return;
      }
      if (!includeFn(neighbor)) {
        return;
      }
      visited[neighbor] = currentGen;
      result.add(neighbor);
      stack.push(neighbor);
    };

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, visit);
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
