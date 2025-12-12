import { Config } from "../configuration/Config";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
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
  private active = true;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    this.config = mg.config();
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    for (const u of this.player.units()) {
      if (!u.info().territoryBound) {
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
        u.decreaseLevel(captor);
        if (u.isActive()) {
          captor.captureUnit(u);
        }
      } else {
        captor.captureUnit(u);
      }
    }

    if (!this.player.isAlive()) {
      // Player has no tiles, delete any remaining units and gold
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

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (alliance.expiresAt() <= this.mg.ticks()) {
        alliance.expire();
      }
    }

    const embargoes = this.player.getEmbargoes();
    for (const embargo of embargoes) {
      if (
        embargo.isTemporary &&
        this.mg.ticks() - embargo.createdAt >
          this.mg.config().temporaryEmbargoDuration()
      ) {
        this.player.stopEmbargo(embargo.target);
      }
    }

    if (ticks - this.lastCalc > this.ticksPerClusterCalc) {
      if (this.player.lastTileChange() > this.lastCalc) {
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
    clusters.sort((a, b) => b.size - a.size);

    const main = clusters.shift();
    if (main === undefined) throw new Error("No clusters");
    this.player.largestClusterBoundingBox = calculateBoundingBox(this.mg, main);
    const surroundedBy = this.surroundedBySamePlayer(main);
    if (surroundedBy && !surroundedBy.isFriendly(this.player)) {
      this.removeCluster(main);
    }

    for (const cluster of clusters) {
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(cluster: Set<TileRef>): false | Player {
    const mg = this.mg;
    const playerSmallID = this.player.smallID();

    // Hot path: avoid per-tile allocations and keep neighbor processing single-pass.
    // We only care about "exactly one distinct non-player owner around the cluster",
    // early reject clusters that touch the map edge or ocean shore.
    let hasUnownedNeighbor = false;
    let touchesOceanShore = false;
    let enemyId: number | null = null;
    let hasMultipleEnemies = false;

    // Reusable callback (allocated once per surroundedBySamePlayer call).
    const visitNeighbor = (n: TileRef) => {
      // Can't short-circuit forEachNeighbor, but this guard avoids extra work.
      if (hasUnownedNeighbor || touchesOceanShore || hasMultipleEnemies) return;

      // Equivalent to GameMapImpl.isOceanShore(tile) but without allocating neighbor arrays.
      // Owned tiles are land (GameImpl.conquer rejects water), so any adjacent ocean means "ocean shore".
      if (mg.isOcean(n)) {
        touchesOceanShore = true;
        return;
      }

      if (!mg.hasOwner(n)) {
        hasUnownedNeighbor = true;
        return;
      }

      const ownerId = mg.ownerID(n);
      if (ownerId === playerSmallID) return;

      if (enemyId === null) {
        enemyId = ownerId;
        return;
      }

      if (enemyId !== ownerId) {
        hasMultipleEnemies = true;
      }
    };

    const width = mg.width();
    const height = mg.height();

    for (const tile of cluster) {
      const x = mg.x(tile);
      // Edge-of-map check
      if (
        x === 0 ||
        x === width - 1 ||
        tile < width ||
        tile >= (height - 1) * width
      ) {
        return false;
      }

      hasUnownedNeighbor = false;
      touchesOceanShore = false;
      mg.forEachNeighbor(tile, visitNeighbor);

      if (
        touchesOceanShore ||
        hasUnownedNeighbor ||
        hasMultipleEnemies ||
        enemyId === null
      ) {
        return false;
      }
    }
    if (hasMultipleEnemies || enemyId === null) {
      return false;
    }
    /* dont think this is needed anymore, but keeping it for now */
    const enemy = mg.playerBySmallID(enemyId) as Player;
    const enemyBox = calculateBoundingBox(mg, enemy.borderTiles());
    const clusterBox = calculateBoundingBox(mg, cluster);
    if (inscribed(enemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    const enemyTiles = new Set<TileRef>();
    for (const tr of cluster) {
      if (this.mg.isShore(tr) || this.mg.isOnEdgeOfMap(tr)) {
        return false;
      }
      this.mg.forEachNeighbor(tr, (n) => {
        const owner = this.mg.owner(n);
        if (owner.isPlayer() && this.mg.ownerID(n) !== this.player.smallID()) {
          enemyTiles.add(n);
        }
      });
    }
    if (enemyTiles.size === 0) {
      return false;
    }
    const enemyBox = calculateBoundingBox(this.mg, enemyTiles);
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
    if (
      Array.from(cluster).some(
        (t) => this.mg?.ownerID(t) !== this.player?.smallID(),
      )
    ) {
      // Other removeCluster operations could change tile owners,
      // so double check.
      return;
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
    for (const t of cluster) {
      this.mg.forEachNeighbor(t, (neighbor) => {
        const owner = this.mg.owner(neighbor);
        if (
          owner.isPlayer() &&
          owner !== this.player &&
          !owner.isFriendly(this.player)
        ) {
          neighbors.set(owner, (neighbors.get(owner) ?? 0) + 1);
        }
      });
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

    while (stack.length > 0) {
      const tile = stack.pop()!;
      neighborFn(tile, (neighbor) => {
        if (visited[neighbor] === currentGen) {
          return;
        }
        if (!includeFn(neighbor)) {
          return;
        }
        visited[neighbor] = currentGen;
        result.add(neighbor);
        stack.push(neighbor);
      });
    }

    return result;
  }
}
