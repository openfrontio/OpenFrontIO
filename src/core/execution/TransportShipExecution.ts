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
  private attacker: Player;
  private target: Player | TerraNullius;

  // TODO make private
  public path: TileRef[];
  private dst: TileRef | null;

  private boat: Unit;

  private pathFinder: PathFinder;

  constructor(
    private attackerID: PlayerID,
    private targetID: PlayerID | null,
    private ref: TileRef,
    private troops: number,
    private src: TileRef | null,
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
    if (this.targetID !== null && !mg.hasPlayer(this.targetID)) {
      console.warn(`TransportShipExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.pathFinder = PathFinder.Mini(mg, 10_000, 10);

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

    if (
      this.targetID === null ||
      this.targetID === this.mg.terraNullius().id()
    ) {
      this.target = mg.terraNullius();
    } else {
      this.target = mg.player(this.targetID);
    }

    if (this.troops === null) {
      this.troops = this.mg
        .config()
        .boatAttackAmount(this.attacker, this.target);
    }

    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.ref);
    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find attack tile`,
      );
      this.active = false;
      return;
    }

    const closestTileSrc = this.attacker.canBuild(
      UnitType.TransportShip,
      this.dst,
    );
    if (closestTileSrc === false) {
      console.warn(`can't build transport ship`);
      this.active = false;
      return;
    }

    if (this.src === null) {
      // Only update the src if it's not already set
      // because we assume that the src is set to the best spawn tile
      this.src = closestTileSrc;
    } else {
      if (
        this.mg.owner(this.src) !== this.attacker ||
        !this.mg.isShore(this.src)
      ) {
        console.warn(
          `src is not a shore tile or not owned by: ${this.attacker.name()}`,
        );
        this.src = closestTileSrc;
      }
    }

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
    });

    // Notify the target player about the incoming naval invasion
    if (this.targetID && this.targetID !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        `Naval invasion incoming from ${this.attacker.displayName()}`,
        MessageType.WARN,
        this.targetID,
      );
    }

    // Record stats
    this.mg.stats().boatSendTroops(this.attacker, this.target, this.troops);
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
        if (this.mg.owner(this.dst) === this.attacker) {
          this.attacker.addTroops(this.boat.troops());
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, this.troops);
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.troops);
        } else {
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

        // Record stats
        this.mg
          .stats()
          .boatArriveTroops(this.attacker, this.target, this.troops);
        return;
      case PathFindResultType.NextTile:
        this.boat.move(result.tile);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        // TODO: add to poisoned port list
        console.warn(`path not found to dst`);
        this.attacker.addTroops(this.troops);
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
