import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { CargoPlaneExecution } from "./CargoPlaneExecution";

export class AirportExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private airport: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }
    if (this.airport === null) {
      const tile = this.tile;
      const spawn = this.player.canBuild(UnitType.Airport, tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player.id()} cannot build airport at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.airport = this.player.buildUnit(UnitType.Airport, spawn, {});
    }

    if (!this.airport.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.airport.owner().id()) {
      this.player = this.airport.owner();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const totalNumberOfAirports = this.mg.units(UnitType.Airport).length;
    if (
      !this.random.chance(
        this.mg.config().cargoPlaneSpawnRate(totalNumberOfAirports),
      )
    ) {
      return;
    }

    const airports = this.player.airports(this.airport);

    if (airports.length === 0) {
      return;
    }

    const airport = this.random.randElement(airports);
    this.mg.addExecution(
      new CargoPlaneExecution(this.player, this.airport, airport),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
