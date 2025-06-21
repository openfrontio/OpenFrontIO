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

export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private cargoPlane: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: PathFinder;
  private tilesTraveled = 0;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 2500);
  }

  tick(ticks: number): void {
    if (this.cargoPlane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.CargoPlane,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build cargo plane`);
        this.active = false;
        return;
      }
      this.cargoPlane = this.origOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
    }

    if (!this.cargoPlane.isActive()) {
      this.active = false;
      return;
    }

    if (this.origOwner !== this.cargoPlane.owner()) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (this._dstPort.owner().id() === this.srcPort.owner().id()) {
      this.cargoPlane.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() ||
        !this.cargoPlane.owner().canTrade(this._dstPort.owner()))
    ) {
      this.cargoPlane.delete(false);
      this.active = false;
      return;
    }

    if (this.wasCaptured) {
      const airports = this.cargoPlane
        .owner()
        .units(UnitType.Airport)
        .sort(distSortUnit(this.mg, this.cargoPlane));

      if (airports.length === 0) {
        this.cargoPlane.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = airports[0];
        this.cargoPlane.setTargetUnit(this._dstPort);
      }
    }

    const result = this.pathFinder.nextTile(
      this.cargoPlane.tile(),
      this._dstPort.tile(),
    );

    switch (result.type) {
      case PathFindResultType.Completed:
        this.complete();
        break;
      case PathFindResultType.Pending:
        // Fire unit event to rerender.
        this.cargoPlane.move(this.cargoPlane.tile());
        break;
      case PathFindResultType.NextTile:
        // Update safeFromPirates status
        // todo: fixme
        if (this.mg.isWater(result.tile) && this.mg.isShoreline(result.tile)) {
          this.cargoPlane.setSafeFromPirates();
        }
        this.cargoPlane.move(result.tile);
        this.tilesTraveled++;
        break;
      case PathFindResultType.PathNotFound:
        console.warn("captured cargo plane cannot find route");
        if (this.cargoPlane.isActive()) {
          this.cargoPlane.delete(false);
        }
        this.active = false;
        break;
    }
  }

  private complete() {
    this.active = false;
    this.cargoPlane!.delete(false);
    const gold = this.mg.config().cargoPlaneGold(this.tilesTraveled);

    // todo: you cannot capture a cargo plane
    if (this.wasCaptured) {
      this.cargoPlane!.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from cargo plane captured from ${this.origOwner.displayName()}`,
        MessageType.CAPTURED_ENEMY_UNIT,
        this.cargoPlane!.owner().id(),
        gold,
      );
    } else {
      this.srcPort.owner().addGold(gold);
      this._dstPort.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.srcPort.owner().displayName()}`,
        MessageType.RECEIVED_GOLD_FROM_TRADE,
        this._dstPort.owner().id(),
        gold,
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this._dstPort.owner().displayName()}`,
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
