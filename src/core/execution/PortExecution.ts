import {
  AllPlayers,
  Cell,
  Execution,
  Game,
  Player,
  Unit,
  PlayerID,
  TerrainType,
  UnitType,
} from "../game/Game";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";
import { consolex } from "../Consolex";
import { manhattanDistFN, TileRef } from "../game/GameMap";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;

  constructor(
    private _owner: PlayerID,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this._owner)) {
      console.warn(`PortExecution: player ${this._owner} not found`);
      this.active = false;
      return;
    }
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());
  }

  tick(ticks: number): void {
    if (this.port == null) {
      // TODO: use canBuild
      const tile = this.tile;
      const player = this.mg.player(this._owner);
      if (!player.canBuild(UnitType.Port, tile)) {
        consolex.warn(`player ${player} cannot build port at ${this.tile}`);
        this.active = false;
        return;
      }
      const spawns = Array.from(this.mg.bfs(tile, manhattanDistFN(tile, 20)))
        .filter((t) => this.mg.isOceanShore(t) && this.mg.owner(t) == player)
        .sort(
          (a, b) =>
            this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
        );

      if (spawns.length == 0) {
        consolex.warn(`cannot find spawn for port`);
        this.active = false;
        return;
      }
      this.port = player.buildUnit(UnitType.Port, 0, spawns[0]);
    }

    if (!this.port.isActive()) {
      this.active = false;
      return;
    }

    const totalNbOfPorts = this.mg.units(UnitType.Port).length;
    if (
      !this.random.chance(this.mg.config().tradeShipSpawnRate(totalNbOfPorts))
    ) {
      return;
    }

    const ports = this.mg
      .players()
      .filter((p) => p != this.port.owner() && p.canTrade(this.port.owner()))
      .flatMap((p) => p.units(UnitType.Port));
    if (ports.length == 0) {
      return;
    }

    const port = this.random.randElement(ports);
    const pf = PathFinder.Mini(this.mg, 2500, false);
    this.mg.addExecution(
      new TradeShipExecution(this.player().id(), this.port, port, pf),
    );
  }

  owner(): Player {
    return null;
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
