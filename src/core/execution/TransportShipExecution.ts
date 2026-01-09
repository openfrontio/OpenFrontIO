import { renderTroops } from "../../client/Utils";
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
import { PathFinder, PathFinders, PathStatus } from "../pathfinding/PathFinder";
import { AttackExecution } from "./AttackExecution";

const malusForRetreat = 25;
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

  private originalOwner: Player;

  constructor(
    private attacker: Player,
    private targetID: PlayerID | null,
    private ref: TileRef,
    private startTroops: number,
    private src: TileRef | null,
  ) {
    this.originalOwner = this.attacker;
  }

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
    this.pathFinder = PathFinders.Water(mg);

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
    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
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

    // Team mate can conquer disconnected player and get their ships
    // captureUnit has changed the owner of the unit, now update attacker
    const boatOwner = this.boat.owner();
    if (
      this.originalOwner.isDisconnected() &&
      boatOwner !== this.originalOwner &&
      boatOwner.isOnSameTeam(this.originalOwner)
    ) {
      this.attacker = boatOwner;
      this.originalOwner = boatOwner; // for when this owner disconnects too
    }

    if (this.boat.retreating()) {
      // Ensure retreat source is still valid for (new) owner
      if (this.mg.owner(this.src!) !== this.attacker) {
        // Use bestTransportShipSpawn, not canBuild because of its max boats check etc
        const newSrc = this.attacker.bestTransportShipSpawn(this.dst);
        if (newSrc === false) {
          this.src = null;
        } else {
          this.src = newSrc;
        }
      }

      if (this.src === null) {
        console.warn(
          `TransportShipExecution: retreating but no src found for new attacker`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.src;

        if (this.boat.targetTile() !== this.dst) {
          this.boat.setTargetTile(this.dst);
        }
      }
    }

    const result = this.pathFinder.next(this.boat.tile(), this.dst);
    switch (result.status) {
      case PathStatus.COMPLETE:
        if (this.mg.owner(this.dst) === this.attacker) {
          const deaths = this.boat.troops() * (malusForRetreat / 100);
          const survivors = this.boat.troops() - deaths;
          this.attacker.addTroops(survivors);
          this.boat.delete(false);
          this.active = false;

          // Record stats
          this.mg
            .stats()
            .boatArriveTroops(this.attacker, this.target, survivors);
          if (deaths) {
            this.mg.displayMessage(
              `Attack cancelled, ${renderTroops(deaths)} soldiers killed during retreat.`,
              MessageType.ATTACK_CANCELLED,
              this.attacker.id(),
            );
          }
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
      case PathStatus.NEXT:
        this.boat.move(result.node);
        break;
      case PathStatus.PENDING:
        break;
      case PathStatus.NOT_FOUND:
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
