import { Execution, Game, Player, Unit, UnitType, isUnit } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { TrainStationExecution } from "./TrainStationExecution";

export class CityExecution implements Execution {
  private mg: Game;
  private city: Unit | null = null;
  private active: boolean = true;

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
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.city) {
      if (isUnit(this.playerOrUnit)) {
        this.city = this.playerOrUnit;
        this.createStation();
      } else {
        const spawnTile = this.playerOrUnit.canBuild(UnitType.City, this.tile!);
        if (spawnTile === false) {
          console.warn("cannot build city");
          this.active = false;
          return;
        }
        this.city = this.playerOrUnit.buildUnit(UnitType.City, spawnTile, {});
        this.createStation();
      }
    }
    if (!this.city.isActive()) {
      this.active = false;
      return;
    }

    if (!isUnit(this.playerOrUnit)) {
      if (this.playerOrUnit !== this.city.owner()) {
        this.playerOrUnit = this.city.owner();
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
    if (this.city !== null) {
      const nearbyFactory = this.mg.hasUnitNearby(
        this.city.tile()!,
        this.mg.config().trainStationMaxRange(),
        UnitType.Factory,
      );
      if (nearbyFactory) {
        this.mg.addExecution(new TrainStationExecution(this.city));
      }
    }
  }
}
