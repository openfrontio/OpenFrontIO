import { Config } from "../configuration/Config";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  TerraNullius,
  UnitType,
} from "../game/Game";
import { calculateBoundingBox, getMode, inscribed, simpleHash } from "../Util";
import { GameImpl } from "../game/GameImpl";
import { consolex } from "../Consolex";
import { GameMap, TileRef } from "../game/GameMap";

export class PlayerExecution implements Execution {
  private readonly ticksPerClusterCalc = 20;

  private player: Player;
  private config: Config;
  private lastCalc = 0;
  private mg: Game;
  private active = true;

  constructor(private playerID: PlayerID) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(`PlayerExecution: player ${this.playerID} not found`);
      this.active = false;
      return;
    }
    this.mg = mg;
    this.config = mg.config();
    this.player = mg.player(this.playerID);
    this.lastCalc =
      ticks + (simpleHash(this.player.name()) % this.ticksPerClusterCalc);
  }

  tick(ticks: number) {
    this.player.decayRelations();
    this.player.units().forEach((u) => {
      if (u.health() <= 0) {
        u.delete();
        return;
      }
      u.modifyHealth(1);
      const tileOwner = this.mg.owner(u.tile());
      if (u.info().territoryBound) {
        if (tileOwner.isPlayer()) {
          if (tileOwner != this.player) {
            this.mg.player(tileOwner.id()).captureUnit(u);
          }
        } else {
          u.delete();
        }
      }
    });

    if (!this.player.isAlive()) {
      this.player.units().forEach((u) => {
        if (
          u.type() != UnitType.AtomBomb &&
          u.type() != UnitType.HydrogenBomb &&
          u.type() != UnitType.MIRVWarhead &&
          u.type() != UnitType.MIRV
        ) {
          u.delete();
        }
      });
      this.active = false;
      return;
    }

    const popInc = this.config.populationIncreaseRate(this.player);
    this.player.addWorkers(popInc * (1 - this.player.targetTroopRatio()));
    this.player.addTroops(popInc * this.player.targetTroopRatio());
    this.player.addGold(this.config.goldAdditionRate(this.player));
    const adjustRate = this.config.troopAdjustmentRate(this.player);
    this.player.addTroops(adjustRate);
    this.player.removeWorkers(adjustRate);

    const alliances = Array.from(this.player.alliances());
    for (const alliance of alliances) {
      if (
        this.mg.ticks() - alliance.createdAt() >
        this.mg.config().allianceDuration()
      ) {
        alliance.expire();
      }
    }

    if (ticks - this.lastCalc > this.ticksPerClusterCalc) {
      if (this.player.lastTileChange() > this.lastCalc) {
        this.lastCalc = ticks;
        const start = performance.now();
        this.removeClusters();
        const end = performance.now();
        if (end - start > 1000) {
          consolex.log(`player ${this.player.name()}, took ${end - start}ms`);
        }
      }
    }
  }

  private removeClusters() {
    const clusters = this.calculateClusters();
    clusters.sort((a, b) => b.size - a.size);

    const main = clusters.shift();
    this.player.largestClusterBoundingBox = calculateBoundingBox(this.mg, main);
    const surroundedBy = this.surroundedBySamePlayer(main);
    if (surroundedBy && !this.player.isAlliedWith(surroundedBy)) {
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
        this.mg.neighbors(tile).some((n) => !this.mg.hasOwner(n))
      ) {
        return false;
      }
      this.mg
        .neighbors(tile)
        .filter((n) => this.mg.ownerID(n) != this.player.smallID())
        .forEach((p) => enemies.add(this.mg.ownerID(p)));
      if (enemies.size != 1) {
        return false;
      }
    }
    if (enemies.size != 1) {
      return false;
    }
    return this.mg.playerBySmallID(Array.from(enemies)[0]) as Player;
  }

  private isSurrounded(cluster: Set<TileRef>): boolean {
    const enemyTiles = new Set<TileRef>();
    for (const tr of cluster) {
      if (this.mg.isOceanShore(tr) || this.mg.isOnEdgeOfMap(tr)) {
        return false;
      }
      this.mg
        .neighbors(tr)
        .filter((n) => this.mg.ownerID(n) != this.player.smallID())
        .forEach((n) => enemyTiles.add(n));
    }
    if (enemyTiles.size == 0) {
      return false;
    }
    const enemyBox = calculateBoundingBox(this.mg, enemyTiles);
    const clusterBox = calculateBoundingBox(this.mg, cluster);
    return inscribed(enemyBox, clusterBox);
  }

  private removeCluster(cluster: Set<TileRef>) {
    if (
      Array.from(cluster).some(
        (t) => this.mg.ownerID(t) != this.player.smallID(),
      )
    ) {
      // Other removeCluster operations could change tile owners,
      // so double check.
      return;
    }

    const capturing = this.getCapturingPlayer(cluster);
    if (capturing == null) {
      return;
    }

    const firstTile = cluster.values().next().value;
    const filter = (_, t: TileRef): boolean =>
      this.mg.ownerID(t) == this.player.smallID();
    const tiles = this.mg.bfs(firstTile, filter);

    for (const tile of tiles) {
      capturing.conquer(tile);
    }
  }

  private getCapturingPlayer(cluster: Set<TileRef>): Player | null {
    const neighborsIDs = new Set<number>();
    for (const t of cluster) {
      for (const neighbor of this.mg.neighbors(t)) {
        if (this.mg.ownerID(neighbor) != this.player.smallID()) {
          neighborsIDs.add(this.mg.ownerID(neighbor));
        }
      }
    }

    let largestNeighborAttack: Player | null = null;
    let largestTroopCount: number = 0;
    for (const id of neighborsIDs) {
      const neighbor = this.mg.playerBySmallID(id);
      if (!neighbor.isPlayer()) {
        continue;
      }
      for (const attack of neighbor.outgoingAttacks()) {
        if (attack.target() == this.player) {
          if (attack.troops() > largestTroopCount) {
            largestTroopCount = attack.troops();
            largestNeighborAttack = neighbor;
          }
        }
      }
    }
    if (largestNeighborAttack != null) {
      return largestNeighborAttack;
    }

    // fall back to getting mode if no attacks
    const mode = getMode(neighborsIDs);
    if (!this.mg.playerBySmallID(mode).isPlayer()) {
      return null;
    }
    const capturing = this.mg.playerBySmallID(mode);
    if (!capturing.isPlayer()) {
      return null;
    }
    return capturing as Player;
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
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }
}
