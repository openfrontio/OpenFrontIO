import { consolex } from "../Consolex";
import { Execution, Game, Player, Unit, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private port: Unit | null = null;
  private random: PseudoRandom | null = null;
  private checkOffset: number | null = null;
  private currentOwner: Player;

  constructor(
    private _owner: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
    this.checkOffset = mg.ticks() % 10;
    this.currentOwner = this._owner;
  }

  tick(ticks: number): void {
    if (this.mg === null || this.random === null || this.checkOffset === null) {
      throw new Error("Not initialized");
    }
    if (this.port === null) {
      const tile = this.tile;
      const spawn = this._owner.canBuild(UnitType.Port, tile);
      if (spawn === false) {
        consolex.warn(
          `player ${this._owner.id()} cannot build port at ${this.tile}`,
        );
        this.active = false;
        return;
      }
      this.port = this._owner.buildUnit(UnitType.Port, spawn, {});
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    if (this._owner.id() !== this.port.owner().id()) {
      this.currentOwner = this.port.owner();
    }

    // Only check every 10 ticks for performance.
    if ((this.mg.ticks() + this.checkOffset) % 10 !== 0) {
      return;
    }

    const totalNbOfPorts = this.mg.units(UnitType.Port).length;
    if (
      !this.random.chance(this.mg.config().tradeShipSpawnRate(totalNbOfPorts))
    ) {
      return;
    }

    const ports = this.currentOwner.tradingPorts(this.port);

    if (ports.length === 0) {
      return;
    }

    const port = this.random.randElement(ports);
    this.mg.addExecution(
      new TradeShipExecution(this.currentOwner, this.port, port),
    );
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  player(): Player {
    if (this.port === null) {
      throw new Error("Not initialized");
    }
    return this.currentOwner;
  }
}
