import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { targetTransportTile } from "../Util";
import { AttackExecution } from "./AttackExecution";

export class TransportShipExecution implements Execution {
  private lastMove: number;

  // TODO: make this configurable
  private ticksPerMove = 1;

  private active = true;

  private mg: Game;
  private attacker: Player;
  private target: Player | TerraNullius;

  // TODO make private
  public path: TileRef[];
  private src: TileRef | null;
  private dst: TileRef | null;

  private boat: Unit;

  private pathFinder: PathFinder;

  constructor(
    private attackerID: PlayerID,
    private targetID: PlayerID | null,
    private ref: TileRef,
    private troops: number | null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.hasPlayer(this.attackerID)) {
      console.warn(
        `TransportShipExecution: attacker ${this.attackerID} not found`,
      );
      this.active = false;
      return;
    }
    if (this.targetID != null && !mg.hasPlayer(this.targetID)) {
      console.warn(`TransportShipExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000, false, 2);

    this.attacker = mg.player(this.attackerID);

    if (
      this.attacker.units(UnitType.TransportShip).length >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        `No boats available, max ${mg.config().boatMaxNumber()}`,
        MessageType.WARN,
        this.attackerID,
      );
      this.active = false;
      this.attacker.addTroops(this.troops);
      return;
    }

    if (this.targetID == null || this.targetID == this.mg.terraNullius().id()) {
      this.target = mg.terraNullius();
    } else {
      this.target = mg.player(this.targetID);
    }

    if (this.troops == null) {
      this.troops = this.mg
        .config()
        .boatAttackAmount(this.attacker, this.target);
    }

    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.ref);
    if (this.dst == null) {
      consolex.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find attack tile`,
      );
      this.active = false;
      return;
    }
    const src = this.attacker.canBuild(UnitType.TransportShip, this.dst);
    if (src == false) {
      consolex.warn(`can't build transport ship`);
      this.active = false;
      return;
    }

    this.src = src;

    this.boat = this.attacker.buildUnit(
      UnitType.TransportShip,
      this.troops,
      this.src,
    );
  }

  tick(ticks: number) {
    if (!this.active) {
      return;
    }
    if (!this.boat.isActive()) {
      this.active = false;
      return;
    }
    if (ticks - this.lastMove < this.ticksPerMove) {
      return;
    }
    this.lastMove = ticks;

    const result = this.pathFinder.nextTile(this.boat.tile(), this.dst);
    switch (result.type) {
      case PathFindResultType.Completed:
        if (this.mg.owner(this.dst) == this.attacker) {
          this.attacker.addTroops(this.troops);
          this.boat.delete(false);
          this.active = false;
          return;
        }
        if (this.target.isPlayer() && this.attacker.isAlliedWith(this.target)) {
          this.target.addTroops(this.troops);
        } else {
          this.attacker.conquer(this.dst);
          this.mg.addExecution(
            new AttackExecution(
              this.troops,
              this.attacker.id(),
              this.targetID,
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;
        return;
      case PathFindResultType.NextTile:
        this.boat.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        // TODO: add to poisoned port list
        consolex.warn(`path not found tot dst`);
        this.boat.delete(false);
        this.active = false;
        return;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }
}
