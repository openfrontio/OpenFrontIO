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
  private origOwner: Player;
  private wasCaptured = false;
  private pathFinder: PathFinder;

  // OwnerUnit => Source Port
  // TargetUnit => Destination Port
  constructor(private ship: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.origOwner = this.ship.owner();
    this.pathFinder = PathFinder.Mini(this.mg, 2500);
  }

  tick(ticks: number): void {
    if (!this.ship.isActive()) {
      return;
    }

    if (this.origOwner != this.ship.owner()) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (this.ship.targetUnit().owner().id() == this.ship.owner().id()) {
      this.ship.delete(false);
      return;
    }

    if (
      !this.wasCaptured &&
      (!this.ship.targetUnit().isActive() ||
        !this.ship.owner().canTrade(this.ship.targetUnit().owner()))
    ) {
      this.ship.delete(false);
      return;
    }

    if (this.wasCaptured) {
      const ports = this.ship
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.ship));
      if (ports.length == 0) {
        this.ship.delete(false);
        return;
      } else {
        this.ship.setDstPort(ports[0]);
      }
    }

    const result = this.pathFinder.nextTile(
      this.ship.tile(),
      this.ship.targetUnit().tile(),
    );

    switch (result.type) {
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.ship.move(this.ship.tile());
        break;
      case PathFindResultType.NextTile:
        // Update safeFromPirates status
        if (this.mg.isWater(result.tile) && this.mg.isShoreline(result.tile)) {
          this.ship.setSafeFromPirates();
        }
        this.ship.move(result.tile);
        break;
      case PathFindResultType.PathNotFound:
        consolex.warn("captured trade ship cannot find route");
        if (this.ship.isActive()) {
          this.ship.delete(false);
        }
        break;
    }
  }

  private complete() {
    this.ship.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(
        this.mg.manhattanDist(
          this.ship.ownerUnit().tile(),
          this.ship.targetUnit().tile(),
        ),
      );

    if (this.wasCaptured) {
      this.ship.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
        MessageType.SUCCESS,
        this.ship.owner().id(),
      );
    } else {
      this.ship.owner().addGold(gold);
      this.ship.targetUnit().owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.ship.ownerUnit().owner().displayName()}`,
        MessageType.SUCCESS,
        this.ship.targetUnit().owner().id(),
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.ship.targetUnit().owner().displayName()}`,
        MessageType.SUCCESS,
        this.ship.ownerUnit().owner().id(),
      );
    }
    return;
  }

  isActive(): boolean {
    return this.ship.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
