import { renderTroops } from "../../client/Utils";
import {
  Attack,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
  TerrainType,
  TerraNullius,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap"; // adjust path if needed

const malusForRetreat = 25;
export class AttackExecution implements Execution {
  private active: boolean = true;
  private toConquer = new FlatBinaryHeap();

  private random = new PseudoRandom(123);

  private target: Player | TerraNullius;

  private mg: Game;

  private attack: Attack | null = null;

  constructor(
    private startTroops: number | null = null,
    private _owner: Player,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
    private clickTile: TileRef | null = null,
  ) {}

  public targetID(): PlayerID | null {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;

    if (this._targetID !== null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.active = false;
      return;
    }

    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);

    if (this._owner === this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.active = false;
      return;
    }

    // ALLIANCE CHECK — block attacks on friendly (ally or same team)
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (this._owner.isFriendly(targetPlayer)) {
        console.warn(
          `${this._owner.displayName()} cannot attack ${targetPlayer.displayName()} because they are friendly (allied or same team)`,
        );
        this.active = false;
        return;
      }
    }

    if (this.target && this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this._owner.type() !== PlayerType.Bot
      ) {
        // Don't let bots embargo since they can't trade anyway.
        targetPlayer.addEmbargo(this._owner, true);
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target.isPlayer()) {
      if (
        this.mg.config().numSpawnPhaseTurns() +
          this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
      ) {
        console.warn("cannot attack player during immunity phase");
        this.active = false;
        return;
      }
    }

    this.startTroops ??= this.mg
      .config()
      .attackAmount(this._owner, this.target);
    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }
    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
      new Set<TileRef>(),
    );

    if (this.sourceTile !== null) {
      this.addNeighbors(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    // Record stats
    this.mg.stats().attack(this._owner, this.target, this.startTroops);

    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() === this.target) {
        // Target has opposing attack, cancel them out
        if (incoming.troops() > this.attack.troops()) {
          incoming.setTroops(incoming.troops() - this.attack.troops());
          this.attack.delete();
          this.active = false;
          return;
        } else {
          this.attack.setTroops(this.attack.troops() - incoming.troops());
          incoming.delete();
        }
      }
    }
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing !== this.attack &&
        outgoing.target() === this.attack.target() &&
        // Boat attacks (sourceTile is not null) are not combined with other attacks
        this.attack.sourceTile() === null
      ) {
        this.attack.setTroops(this.attack.troops() + outgoing.troops());
        outgoing.delete();
      }
    }

    if (this.target.isPlayer()) {
      this.target.updateRelation(this._owner, -80);
    }
  }

  private refreshToConquer() {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    this.toConquer.clear();
    this.attack.clearBorder();
    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile);
    }
  }

  private retreat(malusPercent = 0) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const deaths = this.attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        `Attack cancelled, ${renderTroops(deaths)} soldiers killed during retreat.`,
        MessageType.ATTACK_CANCELLED,
        this._owner.id(),
      );
    }
    const survivors = this.attack.troops() - deaths;
    this._owner.addTroops(survivors);
    this.attack.delete();
    this.active = false;

    // Not all retreats are canceled attacks
    if (this.attack.retreated()) {
      // Record stats
      this.mg.stats().attackCancel(this._owner, this.target, survivors);
    }
  }

  tick(ticks: number) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }
    let troopCount = this.attack.troops(); // cache troop count
    const targetIsPlayer = this.target.isPlayer(); // cache target type
    const targetPlayer = targetIsPlayer ? (this.target as Player) : null; // cache target player

    if (this.attack.retreated()) {
      if (targetIsPlayer) {
        this.retreat(malusForRetreat);
      } else {
        this.retreat();
      }
      this.active = false;
      return;
    }

    if (this.attack.retreating()) {
      return;
    }

    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    if (targetPlayer && this._owner.isFriendly(targetPlayer)) {
      // In this case a new alliance was created AFTER the attack started.
      this.retreat();
      return;
    }

    let numTilesPerTick = this.mg
      .config()
      .attackTilesPerTick(
        troopCount,
        this._owner,
        this.target,
        this.attack.borderSize() + this.random.nextInt(0, 5),
      );

    while (numTilesPerTick > 0) {
      if (troopCount < 1) {
        this.attack.delete();
        this.active = false;
        return;
      }

      if (this.toConquer.size() === 0) {
        this.refreshToConquer();
        this.retreat();
        return;
      }

      const [tileToConquer] = this.toConquer.dequeue();
      this.attack.removeBorderTile(tileToConquer);

      let onBorder = false;
      for (const n of this.mg.neighbors(tileToConquer)) {
        if (this.mg.owner(n) === this._owner) {
          onBorder = true;
          break;
        }
      }
      if (this.mg.owner(tileToConquer) !== this.target || !onBorder) {
        continue;
      }
      this.addNeighbors(tileToConquer);
      const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } = this.mg
        .config()
        .attackLogic(
          this.mg,
          troopCount,
          this._owner,
          this.target,
          tileToConquer,
        );
      numTilesPerTick -= tilesPerTickUsed;
      troopCount -= attackerTroopLoss;
      this.attack.setTroops(troopCount);
      if (targetPlayer) {
        targetPlayer.removeTroops(defenderTroopLoss);
      }
      this._owner.conquer(tileToConquer);
      this.handleDeadDefender();
    }
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this._owner
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  /**
   * Calculate the centroid (center point) of the attacker's border tiles.
   * This serves as the reference point for directional attack calculations.
   * @returns {x: number, y: number} The centroid coordinates
   */
  private getAttackerCentroid(): { x: number; y: number } {
    const borderTiles = Array.from(this._owner.borderTiles());
    if (borderTiles.length === 0) {
      // Fallback: use all tiles if no border tiles exist
      const allTiles = Array.from(this._owner.tiles());
      if (allTiles.length === 0) {
        return { x: 0, y: 0 }; // Ultimate fallback
      }
      const sumX = allTiles.reduce((sum, tile) => sum + this.mg.x(tile), 0);
      const sumY = allTiles.reduce((sum, tile) => sum + this.mg.y(tile), 0);
      return { x: sumX / allTiles.length, y: sumY / allTiles.length };
    }

    const sumX = borderTiles.reduce((sum, tile) => sum + this.mg.x(tile), 0);
    const sumY = borderTiles.reduce((sum, tile) => sum + this.mg.y(tile), 0);
    return { x: sumX / borderTiles.length, y: sumY / borderTiles.length };
  }

  private addNeighbors(tile: TileRef) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const tickNow = this.mg.ticks(); // cache tick

    for (const neighbor of this.mg.neighbors(tile)) {
      if (
        this.mg.isWater(neighbor) ||
        this.mg.owner(neighbor) !== this.target
      ) {
        continue;
      }
      this.attack.addBorderTile(neighbor);
      let numOwnedByMe = 0;
      for (const n of this.mg.neighbors(neighbor)) {
        if (this.mg.owner(n) === this._owner) {
          numOwnedByMe++;
        }
      }

      let mag = 0;
      switch (this.mg.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
      }

      const defensibilityWeight =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2);

      let priority = defensibilityWeight + tickNow;

      if (this.clickTile !== null) {
        // Direction-based attack: use dot product to favor tiles aligned with click direction
        const attackerPos = this.getAttackerCentroid();

        // Calculate direction vector from attacker to clickTile
        const dirX = this.mg.x(this.clickTile) - attackerPos.x;
        const dirY = this.mg.y(this.clickTile) - attackerPos.y;
        const dirMag = Math.sqrt(dirX * dirX + dirY * dirY);

        // Avoid division by zero
        if (dirMag > 0.001) {
          // Normalize direction vector
          const dirNormX = dirX / dirMag;
          const dirNormY = dirY / dirMag;

          // Calculate vector from attacker to neighbor
          const neighborX = this.mg.x(neighbor) - attackerPos.x;
          const neighborY = this.mg.y(neighbor) - attackerPos.y;
          const neighborMag = Math.sqrt(
            neighborX * neighborX + neighborY * neighborY,
          );

          if (neighborMag > 0.001) {
            // Normalize neighbor vector
            const neighborNormX = neighborX / neighborMag;
            const neighborNormY = neighborY / neighborMag;

            // Dot product measures alignment (-1 to 1)
            // 1.0 = same direction, 0.0 = perpendicular, -1.0 = opposite
            const dotProduct =
              dirNormX * neighborNormX + dirNormY * neighborNormY;

            // Convert to offset: additive approach for consistent directional behavior
            // (1.0 - dotProduct) gives us 0.0 for perfect alignment, 2.0 for opposite direction
            // Unlike the multiplicative approach, this adds a fixed offset regardless of defensibility
            // This makes direction equally noticeable for both empty and owned territories
            const directionOffset =
              (1.0 - dotProduct) * this.mg.config().attackDirectionWeight();
            priority += directionOffset;
          }
        }
      }

      this.toConquer.enqueue(neighbor, priority);
    }
  }

  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;

    this.mg.conquerPlayer(this._owner, this.target);

    for (let i = 0; i < 10; i++) {
      for (const tile of this.target.tiles()) {
        const borders = this.mg
          .neighbors(tile)
          .some((t) => this.mg.owner(t) === this._owner);
        if (borders) {
          this._owner.conquer(tile);
        } else {
          for (const neighbor of this.mg.neighbors(tile)) {
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no !== this.target) {
              this.mg.player(no.id()).conquer(tile);
              break;
            }
          }
        }
      }
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}
