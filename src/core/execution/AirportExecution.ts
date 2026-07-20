import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { PlaneExecution } from "./PlaneExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export class AirportExecution implements Execution {
  private active = true;
  private game: Game;
  private airport: Unit;
  private random: PseudoRandom;
  private checkOffset: number;
  private planeSpawnRejections = 0;

  constructor(airport: Unit) {
    this.airport = airport;
  }

  init(game: Game, ticks: number): void {
    this.game = game;
    this.random = new PseudoRandom(game.ticks());
    this.checkOffset = game.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.game === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }

    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }

    if (this.airport.isUnderConstruction()) {
      return;
    }

    if (!this.airport.hasTrainStation()) {
      this.createStation();
    }

    // Only check every 10 ticks for performance.
    if ((this.game.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnPlane()) {
      return;
    }

    const airports = this.tradingAirports();

    if (airports.length === 0) {
      return;
    }

    const dstAirport = this.random.randElement(airports);
    this.game.addExecution(
      new PlaneExecution(this.airport.owner(), this.airport, dstAirport),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  private shouldSpawnPlane(): boolean {
    const numPlanes = this.game.unitCount(UnitType.Plane);
    const spawnRate = this.game
      .config()
      .tradeShipSpawnRate(this.planeSpawnRejections, numPlanes);
    for (let i = 0; i < this.airport.level(); i++) {
      if (this.random.chance(spawnRate)) {
        this.planeSpawnRejections = 0;
        return true;
      }
      this.planeSpawnRejections++;
    }
    return false;
  }

  private createStation(): void {
    const nearbyFactory = this.game.hasUnitNearby(
      this.airport.tile(),
      this.game.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.game.addExecution(new TrainStationExecution(this.airport));
    }
  }

  // It's a probability list, so if an element appears twice it's because it's
  // twice more likely to be picked later.
  tradingAirports(): Unit[] {
    const airports = this.game
      .players()
      .filter((p) => p !== this.airport.owner() && p.canTrade(this.airport.owner()))
      .flatMap((p) => p.units(UnitType.Airport))
      .sort((a, b) => {
        return (
          this.game.manhattanDist(this.airport.tile(), a.tile()) -
          this.game.manhattanDist(this.airport.tile(), b.tile())
        );
      });

    const weightedAirports: Unit[] = [];

    for (const [i, otherAirport] of airports.entries()) {
      const expanded = new Array(otherAirport.level()).fill(otherAirport);
      weightedAirports.push(...expanded);

      const tooClose =
        this.game.manhattanDist(this.airport.tile(), otherAirport.tile()) <
        this.game.config().tradeShipShortRangeDebuff();
      const closeBonus = i < this.game.config().proximityBonusPortsNb(airports.length);

      if (!tooClose && closeBonus) {
        weightedAirports.push(...expanded);
      }

      if (!tooClose && this.airport.owner().isFriendly(otherAirport.owner())) {
        weightedAirports.push(...expanded);
      }
    }

    return weightedAirports;
  }
}
