import { Execution, Game, Unit, UnitType } from "../game/Game";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";

export class PortExecution implements Execution {
  private mg: Game;
  private random: PseudoRandom;
  private checkOffset: number;

  constructor(private port: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
  }

  tick(ticks: number): void {
    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 != 0) {
      return;
    }

    const totalNbOfPorts = this.mg.units(UnitType.Port).length;
    if (
      !this.random.chance(this.mg.config().tradeShipSpawnRate(totalNbOfPorts))
    ) {
      return;
    }

    const ports = this.port.owner().tradingPorts(this.port);

    if (ports.length == 0) {
      return;
    }

    const port = this.random.randElement(ports);
    const pf = PathFinder.Mini(this.mg, 2500);
    this.mg.addExecution(
      new TradeShipExecution(this.port.owner().id(), this.port, port, pf),
    );
  }

  isActive(): boolean {
    return this.port.isActive();
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
