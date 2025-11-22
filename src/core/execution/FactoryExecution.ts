import { Execution, Game, Player, Unit, UnitType, isUnit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TrainStationExecution } from "./TrainStationExecution";

export class FactoryExecution implements Execution {
  private factory: Unit | null = null;
  private active: boolean = true;
  private game: Game;

  constructor(playerOrUnit: Unit);
  constructor(playerOrUnit: Player, tile: TileRef);

  constructor(
    private playerOrUnit: Player | Unit,
    private tile?: TileRef,
  ) {
    if (!isUnit(playerOrUnit) && tile === undefined) {
      throw new Error("tile is required when playerOrUnit is a Player");
    }
  }

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (!this.factory) {
      if (isUnit(this.playerOrUnit)) {
        this.factory = this.playerOrUnit;
        this.createStation();
      } else {
        const spawnTile = this.playerOrUnit.canBuild(
          UnitType.Factory,
          this.tile!,
        );
        if (spawnTile === false) {
          console.warn("cannot build factory");
          this.active = false;
          return;
        }
        this.factory = this.playerOrUnit.buildUnit(
          UnitType.Factory,
          spawnTile,
          {},
        );
        this.createStation();
      }
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }

    if (!isUnit(this.playerOrUnit)) {
      if (this.playerOrUnit !== this.factory.owner()) {
        this.playerOrUnit = this.factory.owner();
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  createStation(): void {
    if (this.factory !== null) {
      const structures = this.game.nearbyUnits(
        this.factory.tile()!,
        this.game.config().trainStationMaxRange(),
        [UnitType.City, UnitType.Port, UnitType.Factory],
      );

      this.game.addExecution(new TrainStationExecution(this.factory, true));
      for (const { unit } of structures) {
        if (!unit.hasTrainStation()) {
          this.game.addExecution(new TrainStationExecution(unit));
        }
      }
    }
  }
}
