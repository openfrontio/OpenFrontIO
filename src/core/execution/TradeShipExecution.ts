import { renderNumber } from "../../client/Utils";
import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { distSortUnit } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private origOwner: Player;
  private tradeShip: Unit;
  private index = 0;
  private wasCaptured = false;

  constructor(
    private _owner: PlayerID,
    private srcPort: Unit,
    private dstPort: Unit,
    private pathFinder: PathFinder,
    // don't modify
    private path: TileRef[],
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.origOwner = mg.player(this._owner);
  }

  tick(ticks: number): void {
    if (this.tradeShip == null) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn == false) {
        consolex.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, 0, spawn);
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    if (this.origOwner != this.tradeShip.owner()) {
      // Store as vairable in case ship is recaptured by previous owner
      this.wasCaptured = true;
    }

    if (
      !this.wasCaptured &&
      (!this.dstPort.isActive() ||
        !this.tradeShip.owner().isAlliedWith(this.dstPort.owner()))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (this.wasCaptured) {
      const ports = this.tradeShip
        .owner()
        .units(UnitType.Port)
        .sort(distSortUnit(this.mg, this.tradeShip));
      if (ports.length == 0) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      }
      const dstPort = ports[0];
      const result = this.pathFinder.nextTile(
        this.tradeShip.tile(),
        dstPort.tile(),
      );
      switch (result.type) {
        case PathFindResultType.Completed:
          const gold = this.mg
            .config()
            .tradeShipGold(
              this.mg.manhattanDist(this.srcPort.tile(), dstPort.tile()),
            );
          this.tradeShip.owner().addGold(gold);
          this.mg.displayMessage(
            `Received ${renderNumber(gold)} gold from ship captured from ${this.origOwner.displayName()}`,
            MessageType.SUCCESS,
            this.tradeShip.owner().id(),
          );
          this.tradeShip.delete(false);
          break;
        case PathFindResultType.Pending:
          // Fire unit event to rerender.
          this.tradeShip.move(this.tradeShip.tile());
          break;
        case PathFindResultType.NextTile:
          this.tradeShip.move(result.tile);
          break;
        case PathFindResultType.PathNotFound:
          consolex.warn("captured trade ship cannot find route");
          this.active = false;
          break;
      }
      return;
    }

    if (this.index >= this.path.length) {
      this.active = false;
      const gold = this.mg
        .config()
        .tradeShipGold(
          this.mg.manhattanDist(this.srcPort.tile(), this.dstPort.tile()),
        );
      this.srcPort.owner().addGold(gold);
      this.dstPort.owner().addGold(gold);
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.srcPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this.dstPort.owner().id(),
      );
      this.mg.displayMessage(
        `Received ${renderNumber(gold)} gold from trade with ${this.dstPort.owner().displayName()}`,
        MessageType.SUCCESS,
        this.srcPort.owner().id(),
      );
      this.tradeShip.delete(false);
      return;
    }
    this.tradeShip.move(this.path[this.index]);
    this.index++;
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
}
