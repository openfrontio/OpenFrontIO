import { renderNumber } from "../../client/Utils";
import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private mg: Game;
  private index = 0;
  private wasCaptured = false;
  private origOwner: Player;

  private pathFinder: PathFinder;

  constructor(private tradeShip: Unit<UnitType.TradeShip>) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000); // TODO: check iterations
  }

  tick(ticks: number): void {
    if (this.origOwner != this.tradeShip.owner()) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    const dstPort = this.tradeShip.info().dstPort;
    const srcPort = this.tradeShip.info().srcPort;
    if (dstPort.owner().id() == srcPort.owner().id()) {
      this.tradeShip.delete(false);
      return;
    }

    if (
      !this.wasCaptured &&
      (!this.tradeShip.info().dstPort.isActive() ||
        !this.tradeShip.owner().canTrade(this.tradeShip.info().dstPort.owner()))
    ) {
      this.tradeShip.delete(false);
      return;
    }

    if (this.wasCaptured) {
      const ports = this.tradeShip
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.tradeShip));
      if (ports.length == 0) {
        this.tradeShip.delete(false);
        return;
      } else {
        this.tradeShip.info().dstPort = ports[0];
      }
    }

    const result = this.pathFinder.nextTile(
      this.tradeShip.tile(),
      this.tradeShip.info().dstPort.tile(),
    );

    switch (result.type) {
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.tradeShip.move(this.tradeShip.tile());
        break;
      case PathFindResultType.NextTile:
        // Update safeFromPirates status
        if (this.mg.isWater(result.tile) && this.mg.isShoreline(result.tile)) {
          this.tradeShip.info().lastSetSafeFromPirates = this.mg.ticks();
        }
        this.tradeShip.move(result.tile);
        break;
      case PathFindResultType.PathNotFound:
        consolex.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        break;
    }
  }

  private complete() {
    this.tradeShip.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(
        this.mg.manhattanDist(
          this.tradeShip.info().srcPort.tile(),
          this.tradeShip.info().dstPort.tile(),
        ),
      );

    if (this.wasCaptured) {
      this.tradeShip.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.SUCCESS,
        this.tradeShip.owner().id(),
      );
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
    }
    return;
  }

  isActive(): boolean {
    return this.tradeShip.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
