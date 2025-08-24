import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game | undefined;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: PathFinder | undefined;
  private tilesTraveled = 0;

  constructor(
    private readonly origOwner: Player,
    private readonly srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 2500);
  }

  tick(ticks: number): void {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.pathFinder === undefined) throw new Error("Not initialized");
    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn("cannot build trade ship");
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        lastSetSafeFromPirates: ticks,
        targetUnit: this._dstPort,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
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

    const curTile = this.tradeShip.tile();
    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const result = this.pathFinder.nextTile(curTile, this._dstPort.tile());

    switch (result.type) {
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.tradeShip.move(curTile);
        break;
      case PathFindResultType.NextTile:
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        break;
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.PathNotFound:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        break;
    }
  }

  private complete() {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.tradeShip === undefined) throw new Error("Not initialized");
    this.active = false;
    this.tradeShip.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(
        this.tilesTraveled,
        this.tradeShip.owner().unitCount(UnitType.Port),
      );

    if (this.wasCaptured) {
      this.tradeShip.owner().addGold(gold, this._dstPort.tile());
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip.owner().id(),
        gold,
      );
    } else {
      this.srcPort.owner().addGold(gold);
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.srcPort.owner().displayName()}`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this._dstPort.owner().id(),
        gold,
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this._dstPort.owner().displayName()}`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this.srcPort.owner().id(),
        gold,
      );
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
