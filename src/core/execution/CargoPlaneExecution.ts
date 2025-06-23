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
import { StraightPathFinder } from "../pathfinding/PathFinding";

export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private cargoPlane: Unit | undefined;
  private pathFinder: StraightPathFinder;
  private tilesTraveled = 0;

  constructor(
    private origOwner: Player,
    private sourceAirport: Unit,
    private destinationAirport: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathFinder = new StraightPathFinder(mg);
  }

  tick(ticks: number): void {
    if (this.cargoPlane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.CargoPlane,
        this.sourceAirport.tile(),
      );
      if (spawn === false) {
        console.warn(`Cargo plane cannot be built`);
        this.active = false;
        return;
      }
      this.cargoPlane = this.origOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this.destinationAirport,
      });
    }

    if (!this.cargoPlane.isActive()) {
      this.active = false;
      return;
    }

    if (
      this.destinationAirport.owner().id() === this.sourceAirport.owner().id()
    ) {
      this.cargoPlane.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.destinationAirport.isActive() ||
      !this.cargoPlane.owner().canTrade(this.destinationAirport.owner())
    ) {
      this.cargoPlane.delete(false);
      this.active = false;
      return;
    }

    const result = this.pathFinder.nextTile(
      this.cargoPlane.tile(),
      this.destinationAirport.tile(),
      2,
    );

    if (result === true) {
      this.complete();
      return;
    } else {
      this.cargoPlane.move(result);
      this.tilesTraveled++;
    }
  }

  private complete() {
    this.active = false;
    this.cargoPlane!.delete(false);
    const gold = this.mg.config().cargoPlaneGold(this.tilesTraveled);

    this.sourceAirport.owner().addGold(gold);
    this.destinationAirport.owner().addGold(gold);

    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.sourceAirport.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.destinationAirport.owner().id(),
      gold,
    );
    this.mg.displayMessage(
      `Received ${renderNumber(gold)} gold from trade using cargo plane with ${this.destinationAirport.owner().displayName()}`,
      MessageType.RECEIVED_GOLD_FROM_TRADE,
      this.sourceAirport.owner().id(),
      gold,
    );

    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstAirport(): TileRef {
    return this.destinationAirport.tile();
  }
}
