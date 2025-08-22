import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { TileRef } from "../game/GameMap";
import { TradeShipExecution } from "./TradeShipExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit | null = null;
  private random: PseudoRandom;
  private checkOffset: number;

  constructor(
    private player: Player,
    private readonly tile: TileRef,
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
    if (this.port === null) {
      const { tile } = this;
      const spawn = this.player.canBuild(UnitType.Port, tile);
      if (spawn === false) {
        console.warn(
          `player ${this.player.id()} cannot build port at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.port = this.player.buildUnit(UnitType.Port, spawn, {});
      this.createStation();
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.player.id() !== this.port.owner().id()) {
      this.player = this.port.owner();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnTradeShip()) {
      return;
    }

    const ports = this.player.tradingPorts(this.port);

    if (ports.length === 0) {
      return;
    }

    const port = this.random.randElement(ports);
    this.mg.addExecution(new TradeShipExecution(this.player, this.port, port));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  shouldSpawnTradeShip(): boolean {
    const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
    const numPlayerPorts = this.player.unitCount(UnitType.Port);
    const spawnRate = this.mg
      .config()
      .tradeShipSpawnRate(numTradeShips, numPlayerPorts);
    for (let i = 0; i < this.port!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        return true;
      }
    }
    return false;
  }

  createStation(): void {
    if (this.port !== null) {
      const nearbyFactory = this.mg.hasUnitNearby(
        this.port.tile(),
        this.mg.config().trainStationMaxRange(),
        UnitType.Factory,
        this.player.id(),
      );
      if (nearbyFactory) {
        this.mg.addExecution(new TrainStationExecution(this.port));
      }
    }
  }
}
