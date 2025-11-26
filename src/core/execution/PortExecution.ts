import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";
import { TrainStationExecution } from "./TrainStationExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;
  private checkOffset: number;

  constructor(port: Unit) {
    this.port = port;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this.port.isUnderConstruction()) {
      return;
    }

    if (!this.port.hasTrainStation()) {
      this.createStation();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    if (!this.shouldSpawnTradeShip()) {
      return;
    }

    const ports = this.tradingPorts();

    if (ports.length === 0) {
      return;
    }

    const port = this.random.randElement(ports);
    this.mg.addExecution(
      new TradeShipExecution(this.port.owner(), this.port, port),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  shouldSpawnTradeShip(): boolean {
    const numTradeShips = this.mg.unitCount(UnitType.TradeShip);
    const numPlayerPorts = this.port!.owner().unitCount(UnitType.Port);
    const numPlayerTradeShips = this.port!.owner().unitCount(
      UnitType.TradeShip,
    );
    const spawnRate = this.mg
      .config()
      .tradeShipSpawnRate(numTradeShips, numPlayerPorts, numPlayerTradeShips);
    for (let i = 0; i < this.port!.level(); i++) {
      if (this.random.chance(spawnRate)) {
        return true;
      }
    }
    return false;
  }

  createStation(): void {
    const nearbyFactory = this.mg.hasUnitNearby(
      this.port.tile()!,
      this.mg.config().trainStationMaxRange(),
      UnitType.Factory,
    );
    if (nearbyFactory) {
      this.mg.addExecution(new TrainStationExecution(this.port));
    }
  }

  // It's a probability list, so if an element appears twice it's because it's
  // twice more likely to be picked later.
  tradingPorts(): Unit[] {
    const ports = this.mg
      .players()
      .filter((p) => p !== this.port!.owner() && p.canTrade(this.port!.owner()))
      .flatMap((p) => p.units(UnitType.Port))
      .sort((p1, p2) => {
        return (
          this.mg.manhattanDist(this.port!.tile(), p1.tile()) -
          this.mg.manhattanDist(this.port!.tile(), p2.tile())
        );
      });

    const weightedPorts: Unit[] = [];

    for (const [i, otherPort] of ports.entries()) {
      const expanded = new Array(otherPort.level()).fill(otherPort);
      weightedPorts.push(...expanded);
      const tooClose =
        this.mg.manhattanDist(this.port!.tile(), otherPort.tile()) <
        this.mg.config().tradeShipShortRangeDebuff();
      const closeBonus =
        i < this.mg.config().proximityBonusPortsNb(ports.length);
      if (!tooClose && closeBonus) {
        // If the port is close, but not too close, add it again
        // to increase the chances of trading with it.
        weightedPorts.push(...expanded);
      }
      if (!tooClose && this.port!.owner().isFriendly(otherPort.owner())) {
        weightedPorts.push(...expanded);
      }
    }
    return weightedPorts;
  }
}
