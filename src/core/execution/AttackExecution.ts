import { renderNumber, renderTroops } from "../../client/Utils";
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

const malusForRetreat = 25;

// This class handles the lifecycle of an attack between one player and a target.
// It determines what tiles to conquer, resolves combat logic, and manages retreat/end conditions.
export class AttackExecution implements Execution {
  private breakAlliance = false;
  private active: boolean = true;

  // These are the tiles we are considering conquering
  private toConquerList: TileRef[] = []; // ordered list for random selection
  private toConquerSet = new Set<TileRef>(); // fast presence checks
  private toConquerIndex = new Map<TileRef, number>(); // O(1) removal from list
  private validTileList: TileRef[] = []; // subset of list that is currently on the front line

  private random = new PseudoRandom(123);

  // Map of each tile to its combat weight and adjacency info
  private tileWeights: Map<
    TileRef,
    { weight: number; ownedCount: number; valid: boolean }
  > = new Map();

  private _owner: Player;
  private target: Player | TerraNullius;
  private mg: Game;
  private border = new Set<TileRef>();
  private attack: Attack = null;

  constructor(
    private startTroops: number | null = null,
    private _ownerID: PlayerID,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
  ) {}

  public targetID(): PlayerID {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  // Initializes the attack object and prepares the first batch of tiles to conquer
  init(mg: Game, ticks: number) {
    if (!this.active) return;
    this.mg = mg;

    if (!mg.hasPlayer(this._ownerID)) {
      console.warn(`player ${this._ownerID} not found`);
      this.active = false;
      return;
    }

    if (this._targetID != null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.active = false;
      return;
    }

    this._owner = mg.player(this._ownerID);
    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);

    // Embargo if non-bots are fighting
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() != PlayerType.Bot &&
        this._owner.type() != PlayerType.Bot
      ) {
        targetPlayer.addEmbargo(this._owner.id());
      }
    }

    if (this._owner == this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.active = false;
      return;
    }

    // Prevent attacks during spawn protection
    if (
      this.target.isPlayer() &&
      this.mg.config().numSpawnPhaseTurns() +
        this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
    ) {
      console.warn("cannot attack player during immunity phase");
      this.active = false;
      return;
    }

    // Determine troop count
    if (this.startTroops == null) {
      this.startTroops = this.mg
        .config()
        .attackAmount(this._owner, this.target);
    }

    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }

    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
    );

    // Cancel out opposing incoming attacks
    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() == this.target) {
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

    // Combine with duplicate outgoing attack
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing != this.attack &&
        outgoing.target() == this.attack.target() &&
        outgoing.sourceTile() == this.attack.sourceTile()
      ) {
        outgoing.setTroops(outgoing.troops() + this.attack.troops());
        this.active = false;
        this.attack.delete();
        return;
      }
    }

    // Start conquest from source tile or full border
    if (this.sourceTile != null) {
      this.addNeighbors(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    if (this.target.isPlayer()) {
      if (this._owner.isAlliedWith(this.target)) {
        this.breakAlliance = true;
      }
      this.target.updateRelation(this._owner, -80);
    }
  }

  // Rebuilds the list of tiles to conquer from scratch
  private refreshToConquer() {
    this.toConquerList = [];
    this.toConquerSet.clear();
    this.toConquerIndex.clear();
    this.border.clear();
    this.tileWeights.forEach((entry) => (entry.valid = false));
    this.validTileList = [];

    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile);
    }
  }

  // Retreats from battle, possibly killing some troops
  private retreat(malusPercent = 0) {
    const deaths = this.attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        `Attack cancelled, ${renderTroops(deaths)} soldiers killed during retreat.`,
        MessageType.SUCCESS,
        this._owner.id(),
      );
    }
    this._owner.addTroops(this.attack.troops() - deaths);
    this.attack.delete();
    this.active = false;
  }

  // Runs attack logic every game tick: conquers tiles, calculates losses, refreshes conquest front
  tick(ticks: number) {
    if (this.attack.retreated()) {
      this.retreat(this.attack.target().isPlayer() ? malusForRetreat : 0);
      this.active = false;
      return;
    }

    if (this.attack.retreating()) {
      return; // Keep waiting for retreat flag to become "retreated"
    }

    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    // Break alliance if needed
    const alliance = this._owner.allianceWith(this.target as Player);
    if (this.breakAlliance && alliance) {
      this.breakAlliance = false;
      this._owner.breakAlliance(alliance);
    }

    if (this.target.isPlayer() && this._owner.isAlliedWith(this.target)) {
      this.retreat();
      return;
    }

    let numTilesPerTick = this.mg
      .config()
      .attackTilesPerTick(
        this.attack.troops(),
        this._owner,
        this.target,
        this.border.size + this.random.nextInt(0, 5),
      );

    while (numTilesPerTick > 0) {
      if (this.attack.troops() < 1) {
        this.attack.delete();
        this.active = false;
        return;
      }

      if (this.toConquerList.length === 0) {
        this.refreshToConquer();
        this.retreat();
        return;
      }

      const validTiles = this.validTileList;
      if (validTiles.length === 0) {
        this.retreat();
        return;
      }

      // Prioritize tiles touching 3+ owned neighbors
      const priorityTiles: { tile: TileRef; weight: number }[] = [];
      const fallbackTiles: { tile: TileRef; weight: number }[] = [];

      for (const tile of validTiles) {
        const meta = this.tileWeights.get(tile);
        if (!meta) continue;
        const { weight, ownedCount } = meta;
        if (ownedCount >= 3) {
          priorityTiles.push({ tile, weight });
        } else {
          fallbackTiles.push({ tile, weight });
        }
      }

      const candidates =
        priorityTiles.length > 0 ? priorityTiles : fallbackTiles;
      if (candidates.length === 0) {
        this.retreat();
        return;
      }

      // Weighted random selection
      const cumulativeWeights: number[] = [];
      let runningTotal = 0;
      for (const { weight } of candidates) {
        runningTotal += weight;
        cumulativeWeights.push(runningTotal);
      }

      if (runningTotal === 0) {
        this.retreat();
        return;
      }

      const r = (this.random.nextInt(0, 10000) / 10000) * runningTotal;
      let low = 0;
      let high = cumulativeWeights.length - 1;
      while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (r < cumulativeWeights[mid]) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }

      const tileToConquer = candidates[low].tile;

      // Remove tile from list/set/index after selection
      const index = this.toConquerIndex.get(tileToConquer);
      if (index !== undefined) {
        const last = this.toConquerList.length - 1;
        const lastTile = this.toConquerList[last];
        this.toConquerList[index] = lastTile;
        this.toConquerIndex.set(lastTile, index);
        this.toConquerList.pop();
        this.toConquerSet.delete(tileToConquer);
        this.toConquerIndex.delete(tileToConquer);
      }

      const meta = this.tileWeights.get(tileToConquer);
      if (meta) {
        meta.valid = false;
        this.validTileList = this.validTileList.filter(
          (t) => t !== tileToConquer,
        );
      }

      this.border.delete(tileToConquer);

      // Make sure tile still borders friendly land
      const onBorder = this.mg
        .neighbors(tileToConquer)
        .some((t) => this.mg.owner(t) == this._owner);
      if (this.mg.owner(tileToConquer) != this.target || !onBorder) continue;

      this.addNeighbors(tileToConquer);

      const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } = this.mg
        .config()
        .attackLogic(
          this.mg,
          this.attack.troops(),
          this._owner,
          this.target,
          tileToConquer,
        );

      numTilesPerTick -= tilesPerTickUsed;
      this.attack.setTroops(this.attack.troops() - attackerTroopLoss);
      if (this.target.isPlayer()) this.target.removeTroops(defenderTroopLoss);
      this._owner.conquer(tileToConquer);

      // Update border and validity of neighbor tiles
      for (const neighbor of this.mg.neighbors(tileToConquer)) {
        if (this.toConquerSet.has(neighbor)) {
          const onBorder = this.mg
            .neighbors(neighbor)
            .some((t) => this.mg.owner(t) === this._owner);
          const meta = this.tileWeights.get(neighbor);
          if (meta) {
            meta.valid = onBorder;
            if (onBorder && !this.validTileList.includes(neighbor)) {
              this.validTileList.push(neighbor);
            } else if (!onBorder) {
              this.validTileList = this.validTileList.filter(
                (t) => t !== neighbor,
              );
            }
          }
          this.updateTileWeight(neighbor);
        }
      }

      this.handleDeadDefender();
    }
  }

  // Adds enemy neighbors of a tile to the conquest frontier
  private addNeighbors(tile: TileRef) {
    for (const neighbor of this.mg.neighbors(tile)) {
      if (this.mg.isWater(neighbor) || this.mg.owner(neighbor) != this.target)
        continue;

      this.border.add(neighbor);

      if (!this.toConquerSet.has(neighbor)) {
        this.toConquerSet.add(neighbor);
        this.toConquerIndex.set(neighbor, this.toConquerList.length);
        this.toConquerList.push(neighbor);
        this.updateTileWeight(neighbor);
      }

      const onBorder = this.mg
        .neighbors(neighbor)
        .some((t) => this.mg.owner(t) === this._owner);
      const meta = this.tileWeights.get(neighbor);
      if (meta) {
        meta.valid = onBorder;
        if (onBorder && !this.validTileList.includes(neighbor)) {
          this.validTileList.push(neighbor);
        } else if (!onBorder) {
          this.validTileList = this.validTileList.filter((t) => t !== neighbor);
        }
      }
    }
  }

  // If defender collapses (few tiles left), conquer everything and transfer gold
  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;

    const gold = this.target.gold();
    this.mg.displayMessage(
      `Conquered ${this.target.displayName()} received ${renderNumber(gold)} gold`,
      MessageType.SUCCESS,
      this._owner.id(),
    );
    this.target.removeGold(gold);
    this._owner.addGold(gold);

    for (let i = 0; i < 10; i++) {
      for (const tile of this.target.tiles()) {
        const borders = this.mg
          .neighbors(tile)
          .some((t) => this.mg.owner(t) == this._owner);
        if (borders) {
          this._owner.conquer(tile);
        } else {
          for (const neighbor of this.mg.neighbors(tile)) {
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no != this.target) {
              this.mg.player(no.id()).conquer(tile);
              break;
            }
          }
        }
      }
    }
  }

  // Recomputes how desirable a tile is to conquer, based on terrain and neighbor ownership
  private updateTileWeight(tile: TileRef) {
    const neighbors = this.mg.neighbors(tile);
    const ownedCount = neighbors.filter(
      (t) => this.mg.owner(t) === this._owner,
    ).length;

    let weight = 1.0;
    switch (this.mg.terrainType(tile)) {
      case TerrainType.Plains:
        weight = 3.0;
        break;
      case TerrainType.Highland:
        weight = 0.5;
        break;
      case TerrainType.Mountain:
        weight = 0.25;
        break;
    }

    if (ownedCount === 2) weight *= 8;

    const existing = this.tileWeights.get(tile);
    const valid = existing?.valid ?? false;
    this.tileWeights.set(tile, { weight, ownedCount, valid });
  }

  // Returns the player who owns this attack
  owner(): Player {
    return this._owner;
  }

  // Indicates whether the attack is still in progress
  isActive(): boolean {
    return this.active;
  }
}
