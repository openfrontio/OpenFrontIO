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
import { PathFinder, PathFindResultType } from "../pathfinding/PathFinding";
import { AttackExecution } from "./AttackExecution";

export class TransportShipExecution implements Execution {
  private lastMove: number;

  // TODO: make this configurable
  private ticksPerMove = 1;

  private active = true;

  private mg: Game;
  private target: Player | TerraNullius;

  // TODO make private
  public path: TileRef[];
  private dst: TileRef | null;

  private boat: Unit;

  private pathFinder: PathFinder;

  constructor(
    private attacker: Player,
    private targetID: PlayerID | null,
    private ref: TileRef,
    private startTroops: number,
    private src: TileRef | null,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (this.targetID !== null && !mg.hasPlayer(this.targetID)) {
      console.warn(`TransportShipExecution: target ${this.targetID} not found`);
      this.active = false;
      return;
    }
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }
    if (this.src !== null && !mg.isValidRef(this.src)) {
      console.warn(`TransportShipExecution: src ${this.src} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.pathFinder = PathFinder.Wasm(mg);

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        `No boats available, max ${mg.config().boatMaxNumber()}`,
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
      );
      this.active = false;
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

    this.startTroops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);

    this.startTroops = Math.min(this.startTroops, this.attacker.troops());

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
      troops: this.startTroops,
    });

    if (this.dst !== null) {
      this.boat.setTargetTile(this.dst);
    } else {
      this.boat.setTargetTile(undefined);
    }

    // Notify the target player about the incoming naval invasion
    if (this.targetID && this.targetID !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        // TODO TranslateText
        `Naval invasion incoming from ${this.attacker.displayName()}`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.targetID,
      );
    }

    // Record stats
    this.mg
      .stats()
      .boatSendTroops(this.attacker, this.target, this.boat.troops());
  }

  async tick(ticks: number) {
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

      if (this.boat.targetTile() !== this.dst) {
        this.boat.setTargetTile(this.dst);
      }
    }

    const result = await this.pathFinder.nextTile(this.boat.tile(), this.dst);
    switch (result.type) {
      case PathFindResultType.Completed:
        if (this.mg.owner(this.dst) === this.attacker) {
          this.attacker.addTroops(this.boat.troops());
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, this.boat.troops());
          return;
        }
        this.attacker.conquer(this.dst);
        if (this.target.isPlayer() && this.attacker.isFriendly(this.target)) {
          this.attacker.addTroops(this.boat.troops());
        } else {
          this.mg.addExecution(
            new AttackExecution(
              this.boat.troops(),
              this.attacker,
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
          .boatArriveTroops(this.attacker, this.target, this.boat.troops());
        return;
      case PathFindResultType.NextTile:
        this.boat.move(result.node);
        break;
      case PathFindResultType.Pending:
        break;
      case PathFindResultType.PathNotFound:
        // TODO: add to poisoned port list
        console.warn(`path not found to dst`);
        this.attacker.addTroops(this.boat.troops());
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
