import { Execution, Game, Unit, UnitType } from "../game/Game";
import { TrainStationExecution } from "./TrainStationExecution";

export class FactoryExecution implements Execution {
  private active: boolean = true;
  private game: Game;
  private stationCreated = false;

  constructor(private factory: Unit) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
  }

  tick(ticks: number): void {
    if (!this.stationCreated) {
      this.createStation();
      this.stationCreated = true;
    }
    if (!this.factory.isActive()) {
      this.active = false;
      return;
    }
    if (this.factory.isUnderConstruction()) return;

    if ((ticks + this.factory.id()) % 10 !== 0) return;

    const station = this.game
      .railNetwork()
      .stationManager()
      .findStation(this.factory);
    const connections = station?.getRailroads().size ?? 0;
    const owner = this.factory.owner();
    const gold = this.game
      .config()
      .factoryGold(this.factory.level(), connections, owner);
    // Supplying the tile emits the standard map bonus event, making steady
    // factory production visible instead of silently changing the balance.
    owner.addGold(gold, this.factory.tile());
    owner.addTrainGold(gold);
    this.game.stats().trainSelfTrade(owner, gold);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private createStation(): void {
    const structures = this.game.nearbyUnits(
      this.factory.tile()!,
      this.game.config().trainStationMaxRange(),
      [
        UnitType.City,
        UnitType.Port,
        UnitType.Factory,
        UnitType.ResearchFacility,
      ],
    );

    // Research Facilities are passive endpoints: register them before the
    // factory so only the factory's station creates their railroad.
    for (const { unit } of structures) {
      if (
        unit.type() === UnitType.ResearchFacility &&
        !unit.hasTrainStation()
      ) {
        this.game.addExecution(new TrainStationExecution(unit, false, true));
      }
    }

    this.game.addExecution(new TrainStationExecution(this.factory, true));
    for (const { unit } of structures) {
      if (
        unit.type() !== UnitType.ResearchFacility &&
        !unit.hasTrainStation()
      ) {
        this.game.addExecution(new TrainStationExecution(unit));
      }
    }
  }
}
