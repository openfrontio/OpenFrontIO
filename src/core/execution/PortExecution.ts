import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { manhattanDistFN, TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { PseudoRandom } from "../PseudoRandom";
import { TradeShipExecution } from "./TradeShipExecution";

export class PortExecution implements Execution {
  private active = true;
  private mg: Game;
  private port: Unit;
  private random: PseudoRandom;
  private portPaths = new Map<Unit, TileRef[]>();
  private computingPaths = new Map<Unit, MiniAStar>();

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

    const alliedPorts = this.player()
      .alliances()
      .map((a) => a.other(this.player()))
      .flatMap((p) => p.units(UnitType.Port));
    const alliedPortsSet = new Set(alliedPorts);

    const allyConnections = new Set(
      Array.from(this.portPaths.keys()).map((p) => p.owner()),
    );
    allyConnections;

    for (const port of alliedPorts) {
      if (allyConnections.has(port.owner())) {
        continue;
      }
      allyConnections.add(port.owner());
      if (this.computingPaths.has(port)) {
        const aStar = this.computingPaths.get(port);
        switch (aStar.compute()) {
          case PathFindResultType.Completed:
            this.portPaths.set(port, aStar.reconstructPath());
            this.computingPaths.delete(port);
            break;
          case PathFindResultType.Pending:
            break;
          case PathFindResultType.PathNotFound:
            consolex.warn(`path not found to port`);
            break;
        }
        continue;
      }

      const pf = new MiniAStar(
        this.mg.map(),
        this.mg.miniMap(),
        this.port.tile(),
        port.tile(),
        (tr: TileRef) => this.mg.miniMap().isOcean(tr),
        10_000,
        25,
      );
      this.computingPaths.set(port, pf);
    }

    for (const port of this.portPaths.keys()) {
      if (!port.isActive() || !alliedPortsSet.has(port)) {
        this.portPaths.delete(port);
        this.computingPaths.delete(port);
      }
    }

    const portConnections = Array.from(this.portPaths.keys());

    if (
      portConnections.length > 0 &&
      this.random.chance(this.mg.config().tradeShipSpawnRate())
    ) {
      const port = this.random.randElement(portConnections);
      const path = this.portPaths.get(port);
      if (path != null) {
        const pf = PathFinder.Mini(this.mg, 10000, false);
        this.mg.addExecution(
          new TradeShipExecution(this.player().id(), this.port, port, pf, path),
        );
      }
    }
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
