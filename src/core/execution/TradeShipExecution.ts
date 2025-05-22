import { renderNumber } from "../../client/Utils";
import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private origOwner: Player | null = null;
  private tradeShip: Unit | null = null;
  private index = 0;
  private wasCaptured = false;
  private tilesTraveled = 0;

  constructor(
    private _owner: PlayerID,
    private srcPort: Unit,
    private _dstPort: Unit,
    private pathFinder: PathFinder,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.origOwner = mg.player(this._owner);
  }

  tick(ticks: number): void {
    if (this.mg === null || this.origOwner === null) {
      throw new Error("Not initialized");
    }
    if (this.tradeShip === null) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        consolex.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        dstPort: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });

      // Record stats
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    if (this.origOwner !== this.tradeShip.owner()) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (this._dstPort.owner().id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() ||
        !this.tradeShip.owner().canTrade(this._dstPort.owner()))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (this.wasCaptured) {
      const ports = this.tradeShip
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.tradeShip));
      if (ports.length === 0) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = ports[0];
        this.tradeShip.setTargetUnit(this._dstPort);
      }
    }

    const cachedNextTile = this._dstPort.cacheGet(this.tradeShip.tile());
    if (cachedNextTile !== undefined) {
      if (
        this.mg.isWater(cachedNextTile) &&
        this.mg.isShoreline(cachedNextTile)
      ) {
        this.tradeShip.setSafeFromPirates();
      }
      this.tradeShip.move(cachedNextTile);
      this.tilesTraveled++;
      return;
    }

    const result = this.pathFinder.nextTile(
      this.tradeShip.tile(),
      this._dstPort.tile(),
    );

    switch (result.type) {
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.tradeShip.touch();
        break;
      case PathFindResultType.NextTile:
        this._dstPort.cachePut(this.tradeShip.tile(), result.tile);
        // Update safeFromPirates status
        if (this.mg.isWater(result.tile) && this.mg.isShoreline(result.tile)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.tile);
        this.tilesTraveled++;
        break;
      case PathFindResultType.PathNotFound:
        consolex.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        break;
    }
  }

  private complete() {
    if (this.mg === null || this.origOwner === null) {
      throw new Error("Not initialized");
    }
    if (this.tradeShip === null) return;
    this.active = false;
    this.tradeShip.delete(false);
    const gold = this.mg.config().tradeShipGold(this.tilesTraveled);

    if (this.wasCaptured) {
      const player = this.tradeShip.owner();
      player.addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.SUCCESS,
        this.tradeShip.owner().id(),
      );

      // Record stats
      this.mg.stats().boatCapturedTrade(player, this.origOwner, gold);
    } else {
      this.srcPort.owner().addGold(gold);
      this._dstPort.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.srcPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this._dstPort.owner().id(),
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this._dstPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this.srcPort.owner().id(),
      );

      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }
}
