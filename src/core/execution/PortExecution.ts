import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { BuildExecution } from "./BuildExecution";

export class PortExecution implements Execution {
  private active = true;
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
    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

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

    const ports = this.player().tradingPorts(this.port);

    if (ports.length == 0) {
      return;
    }

    const port = this.random.randElement(ports);
    this.mg.addExecution(
      new BuildExecution(this.port.owner(), {
        type: UnitType.TradeShip,
        ownerUnit: this.port,
        targetUnit: port,
        targetTile: this.port.tile(),
      }),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  player(): Player {
    return this.port.owner();
  }
}
