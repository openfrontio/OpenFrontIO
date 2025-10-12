import { Config } from "../configuration/Config";
import { Execution, Game, Player, UnitType } from "../game/Game";
import { GameImpl } from "../game/GameImpl";
import { GameMap, TileRef } from "../game/GameMap";
import { calculateBoundingBox, inscribed, simpleHash } from "../Util";

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
    if (surroundedBy && !this.player.isFriendly(surroundedBy)) {
      this.removeCluster(main);
    }

    for (const cluster of clusters) {
      if (this.isSurrounded(cluster)) {
        this.removeCluster(cluster);
      }
    }
  }

  private surroundedBySamePlayer(cluster: Set<TileRef>): false | Player {
    const enemies = new Set<number>();
    for (const tile of cluster) {
      const isOceanShore = this.mg.isOceanShore(tile);
      if (this.mg.isOceanShore(tile) && !isOceanShore) {
        continue;
      }
      if (
        isOceanShore ||
        this.mg.isOnEdgeOfMap(tile) ||
        this.mg.neighbors(tile).some((n) => !this.mg?.hasOwner(n))
      ) {
        return false;
      }
      this.mg
        .neighbors(tile)
        .filter((n) => this.mg?.ownerID(n) !== this.player?.smallID())
        .forEach((p) => this.mg && enemies.add(this.mg.ownerID(p)));
      if (enemies.size !== 1) {
        return false;
      }
    }
    if (enemies.size !== 1) {
      return false;
    }
    const enemy = this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
    const enemyBox = calculateBoundingBox(this.mg, enemy.borderTiles());
    const clusterBox = calculateBoundingBox(this.mg, cluster);
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
      this.mg
        .neighbors(tr)
        .filter(
          (n) =>
            this.mg?.owner(n).isPlayer() &&
            this.mg?.ownerID(n) !== this.player?.smallID(),
        )
        .forEach((n) => enemyTiles.add(n));
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

    const filter = (_: GameMap, t: TileRef): boolean =>
      this.mg?.ownerID(t) === this.player?.smallID();
    const tiles = this.mg.bfs(firstTile, filter);

    if (this.player.numTilesOwned() === tiles.size) {
      this.mg.conquerPlayer(capturing, this.player);
    }

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    // Collect unique neighbor IDs (excluding self) as candidates
    const candidatesIDs = new Set<number>();
    const selfID = this.player.smallID();

    for (const t of cluster) {
      for (const neighbor of this.mg.neighbors(t)) {
        if (this.mg.ownerID(neighbor) !== selfID) {
          candidatesIDs.add(this.mg.ownerID(neighbor));
        }
      }
    }

    // Filter out friendly and non-player candidates
    const neighbors = new Set<Player>();
    for (const id of candidatesIDs) {
      const neighbor = this.mg.playerBySmallID(id);
      if (!neighbor.isPlayer() || neighbor.isFriendly(this.player)) {
        continue;
      }
      neighbors.add(neighbor);
    }

    // If there are no enemies, return null
    if (neighbors.size === 0) {
      return null;
    }

    // Get the largest attack from the neighbors
    let largestNeighborAttack: Player | null = null;
    let largestTroopCount = 0;
    for (const neighbor of neighbors) {
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() === this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }

    // Return the largest neighbor attack
    // If there is no largest neighbor attack, this will return null
    return largestNeighborAttack;
  }

  private calculateClusters(): Set<TileRef>[] {
    const seen = new Set<TileRef>();
    const border = this.player.borderTiles();
    const clusters: Set<TileRef>[] = [];
    for (const tile of border) {
      if (seen.has(tile)) {
        continue;
      }

      const cluster = new Set<TileRef>();
      const queue: TileRef[] = [tile];
      seen.add(tile);
      while (queue.length > 0) {
        const curr = queue.shift();
        if (curr === undefined) throw new Error("curr is undefined");
        cluster.add(curr);

        const neighbors = (this.mg as GameImpl).neighborsWithDiag(curr);
        for (const neighbor of neighbors) {
          if (border.has(neighbor) && !seen.has(neighbor)) {
            queue.push(neighbor);
            seen.add(neighbor);
          }
        }
      }
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
}
