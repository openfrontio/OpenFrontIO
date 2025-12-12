import { Config } from "../configuration/Config";
import { Cell, Execution, Game, Player, UnitType } from "../game/Game";
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

  private isEdgeTileFast(
    tile: TileRef,
    x: number,
    width: number,
    height: number,
  ): boolean {
    return (
      x === 0 || x === width - 1 || tile < width || tile >= (height - 1) * width
    );
  }

  private scanClusterBoundary(
    cluster: ReadonlySet<TileRef>,
    opts: {
      rejectIfEdgeTile?: boolean;
      // IMPORTANT: This checks `mg.isShore(tile)` which is based on the terrain "shoreline" bit.
      // That can include shorelines around BOTH oceans and lakes.
      // If you only want to reject true *ocean* adjacency, use `rejectIfOceanNeighbor` instead.
      rejectIfShoreTile?: boolean;
      // Reject if any neighbor is `mg.isOcean(...)` (i.e. true ocean).
      // This is *not* equivalent to `rejectIfShoreTile`:
      // - `rejectIfOceanNeighbor` rejects only ocean-adjacent land (like `mg.isOceanShore(tile)`),
      //   and in this helper we detect it without allocating `neighbors(...)` arrays.
      // - `rejectIfShoreTile` rejects any shoreline-bit tile (including lake shorelines).
      rejectIfOceanNeighbor?: boolean;
      rejectIfUnownedNeighbor?: boolean;
      trackEnemyBBox?: boolean;
      trackSingleEnemyId?: boolean;
    },
  ):
    | {
        enemyId: number | null;
        hasMultipleEnemies: boolean;
        hasEnemyNeighbor: boolean;
        enemyMinX: number;
        enemyMinY: number;
        enemyMaxX: number;
        enemyMaxY: number;
      }
    | undefined {
    const mg = this.mg;
    const playerSmallID = this.player.smallID();
    const width = mg.width();
    const height = mg.height();

    let tileTouchesOcean = false;
    let tileTouchesUnowned = false;

    let enemyId: number | null = null;
    let hasMultipleEnemies = false;

    let hasEnemyNeighbor = false;
    let enemyMinX = Infinity;
    let enemyMinY = Infinity;
    let enemyMaxX = -Infinity;
    let enemyMaxY = -Infinity;

    const visitNeighbor = (n: TileRef) => {
      if (hasMultipleEnemies) return;
      if (opts.rejectIfOceanNeighbor && tileTouchesOcean) return;
      if (opts.rejectIfUnownedNeighbor && tileTouchesUnowned) return;

      // Equivalent to GameMapImpl.isOceanShore(tile) but without allocating neighbor arrays.
      // Owned tiles are land (GameImpl.conquer rejects water), so any adjacent ocean means "ocean shore".
      if (opts.rejectIfOceanNeighbor && mg.isOcean(n)) {
        tileTouchesOcean = true;
        return;
      }

      const ownerId = mg.ownerID(n);
      if (ownerId === 0) {
        if (opts.rejectIfUnownedNeighbor) {
          tileTouchesUnowned = true;
        }
        return;
      }
      if (ownerId === playerSmallID) return;

      hasEnemyNeighbor = true;

      if (opts.trackSingleEnemyId) {
        if (enemyId === null) {
          enemyId = ownerId;
        } else if (enemyId !== ownerId) {
          hasMultipleEnemies = true;
          return;
        }
      }

      if (opts.trackEnemyBBox) {
        const nx = mg.x(n);
        const ny = mg.y(n);
        if (nx < enemyMinX) enemyMinX = nx;
        if (ny < enemyMinY) enemyMinY = ny;
        if (nx > enemyMaxX) enemyMaxX = nx;
        if (ny > enemyMaxY) enemyMaxY = ny;
      }
    };

    for (const tile of cluster) {
      if (opts.rejectIfShoreTile && mg.isShore(tile)) {
        return;
      }

      const x = mg.x(tile);
      if (
        (opts.rejectIfEdgeTile ?? true) &&
        this.isEdgeTileFast(tile, x, width, height)
      ) {
        return;
      }

      tileTouchesOcean = false;
      tileTouchesUnowned = false;
      mg.forEachNeighbor(tile, visitNeighbor);

      if (hasMultipleEnemies) return;
      if (opts.rejectIfOceanNeighbor && tileTouchesOcean) return;
      if (opts.rejectIfUnownedNeighbor && tileTouchesUnowned) return;
    }

    return {
      enemyId,
      hasMultipleEnemies,
      hasEnemyNeighbor,
      enemyMinX,
      enemyMinY,
      enemyMaxX,
      enemyMaxY,
    };
  }

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
    // Hot path: avoid per-tile allocations and keep neighbor processing single-pass.
    // We only care about "exactly one distinct non-player owner around the cluster",
    // early reject clusters that touch the map edge or ocean shore.
    const scan = this.scanClusterBoundary(cluster, {
      rejectIfEdgeTile: true,
      // We want the stricter "ocean shore" behavior (adjacent to true ocean),
      // matching previous `isOceanShore` semantics without allocating neighbor arrays.
      rejectIfOceanNeighbor: true,
      rejectIfUnownedNeighbor: true,
      trackSingleEnemyId: true,
    });
    if (!scan || scan.hasMultipleEnemies || scan.enemyId === null) {
      return false;
    }
    /* dont think this is needed anymore, but keeping it for now */
    const enemy = mg.playerBySmallID(scan.enemyId) as Player;
    const enemyBox = calculateBoundingBox(mg, enemy.borderTiles());
    const clusterBox = calculateBoundingBox(mg, cluster);
    if (inscribed(enemyBox, clusterBox)) {
      return enemy;
    }
    return false;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    const mg = this.mg;
    const scan = this.scanClusterBoundary(cluster, {
      rejectIfEdgeTile: true,
      // This keeps the prior `mg.isShore(tile)` behavior which is based on the terrain "shoreline" bit.
      // which can include both ocean and lake shorelines.
      //we may also(only?) want rejectIfOceanNeighbor: true, but this matches the previous behavior.
      rejectIfShoreTile: true,
      trackEnemyBBox: true,
    });
    if (!scan || !scan.hasEnemyNeighbor) return false;

    const enemyBox = {
      min: new Cell(scan.enemyMinX, scan.enemyMinY),
      max: new Cell(scan.enemyMaxX, scan.enemyMaxY),
    };
    const clusterBox = calculateBoundingBox(mg, cluster);
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
