import { consolex } from "../Consolex";
import {
  Execution,
  Game,
  MessageType,
  Player,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { targetTransportTile } from "../game/TransportShipUtils";
import { PathFindResultType } from "../pathfinding/AStar";
import { PathFinder } from "../pathfinding/PathFinding";
import { AttackExecution } from "./AttackExecution";

export class TransportShipExecution implements Execution {
  private lastMove: number;

  // TODO: make this configurable
  private ticksPerMove = 1;

  private active = true;

  private mg: Game;

  // TODO make private
  public path: TileRef[];
  private dst: TileRef | null;

  private boat: Unit;

  private pathFinder: PathFinder;

  constructor(
    private _owner: Player,
    private _target: Player | TerraNullius,
    private ref: TileRef,
    private troops: number,
    private src: TileRef | null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    this.lastMove = ticks;
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000, 10);

    if (
      this._owner.units(UnitType.TransportShip).length >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        `No boats available, max ${mg.config().boatMaxNumber()}`,
        MessageType.WARN,
        this._owner.id(),
      );
      this.active = false;
      this._owner.addTroops(this.troops);
      return;
    }

    if (this.troops === null) {
      this.troops = this.mg
        .config()
        .boatAttackAmount(this._owner, this._target);
    }

    this.troops = Math.min(this.troops, this._owner.troops());

    this.dst = targetTransportTile(this.mg, this.ref);
    if (this.dst === null) {
      consolex.warn(
        `${this._owner} cannot send ship to ${this._target}, cannot find attack tile`,
      );
      this.active = false;
      return;
    }

    const closestTileSrc = this._owner.canBuild(
      UnitType.TransportShip,
      this.dst,
    );
    if (closestTileSrc === false) {
      consolex.warn(`can't build transport ship`);
      this.active = false;
      return;
    }

    if (this.src === null) {
      // Only update the src if it's not already set
      // because we assume that the src is set to the best spawn tile
      this.src = closestTileSrc;
    } else {
      if (
        this.mg.owner(this.src) !== this._owner ||
        !this.mg.isShore(this.src)
      ) {
        console.warn(
          `src is not a shore tile or not owned by: ${this._owner.name()}`,
        );
        this.src = closestTileSrc;
      }
    }

    this.boat = this._owner.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
    });

    // Notify the target player about the incoming naval invasion
    if (this._target.id() !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        `Naval invasion incoming from ${this._owner.displayName()}`,
        MessageType.WARN,
        this._target.id(),
      );
    }

    // Record stats
    this.mg.stats().boatSendTroops(this._owner, this._target, this.troops);
  }

  tick(ticks: number) {
    if (this.dst === null) {
      this.active = false;
      return;
    }
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

    if (this.boat.retreating()) {
      this.dst = this.src!; // src is guaranteed to be set at this point
    }

    const result = this.pathFinder.nextTile(this.boat.tile(), this.dst);
    switch (result.type) {
      case PathFindResultType.Completed:
        if (this.mg.owner(this.dst) === this._owner) {
          this._owner.addTroops(this.boat.troops());
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this._owner, this._target, this.troops);
          return;
        }
        this._owner.conquer(this.dst);
        if (this._target.isPlayer() && this._owner.isFriendly(this._target)) {
          this._owner.addTroops(this.troops);
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.troops,
              this._owner,
              this._target,
              this.dst,
              false,
            ),
          );
        }
        this.boat.delete(false);
        this.active = false;

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this._owner, this._target, this.troops);
        return;
      case PathFindResultType.NextTile:
        this.boat.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        // TODO: add to poisoned port list
        consolex.warn(`path not found to dst`);
        this._owner.addTroops(this.troops);
        this.boat.delete(false);
        this.active = false;
        return;
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}
