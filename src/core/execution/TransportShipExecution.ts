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
import {
  bestTransportShipRoute,
  boatPathFromTileToShore,
} from "../game/TransportShipUtils";
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
  public path: TileRef[] = [];
  private dst: TileRef | null;

  private boat: Unit;
  private forwardPath: TileRef[] = [];
  private pathIndex = 0;
  private usingReverseRetreatPath = false;

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

    const route = bestTransportShipRoute(
      this.mg,
      this.attacker,
      this.ref,
      this.src,
    );
    if (route === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, no route found`,
      );
      this.active = false;
      return;
    }

    // Basic affordability/availability checks (avoid relying on transport-ship spawn heuristics).
    const boatCost = this.mg.unitInfo(UnitType.TransportShip).cost(this.mg, this.attacker);
    if (!this.attacker.isAlive() || this.attacker.gold() < boatCost) {
      this.active = false;
      return;
    }

    this.src = route.src;
    this.dst = route.dst;
    this.forwardPath = route.path;
    this.path = route.path;
    this.pathIndex = 0;
    this.usingReverseRetreatPath = false;

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

        // Retreat is just the existing forward path in reverse (hot-path friendly).
        // Fallback to a recompute only if we can't safely reverse (e.g. path invalidated).
        if (!this.usingReverseRetreatPath) {
          const curr = this.boat.tile();
          const idx = curr === null ? -1 : this.forwardPath.indexOf(curr);
          if (idx >= 0) {
            this.path = this.forwardPath.slice(0, idx + 1).reverse();
            this.pathIndex = 0;
            this.usingReverseRetreatPath = true;
          } else {
            const retreatPath = boatPathFromTileToShore(
              this.mg,
              curr!,
              this.dst,
            );
            if (retreatPath !== null) {
              this.path = retreatPath;
              this.pathIndex = 0;
              this.usingReverseRetreatPath = true;
            }
          }
        }
      }
    } else {
      this.usingReverseRetreatPath = false;
    }

    if (this.path.length === 0 || this.pathIndex >= this.path.length - 1) {
      // Treat as arrived; should be rare (e.g. src==dst edge).
      this.finish();
      return;
    }

    const next = this.path[this.pathIndex + 1];
    if (next === undefined) {
      this.finish();
      return;
    }
    this.boat.move(next);
    this.pathIndex++;

    if (this.dst !== null && next === this.dst) {
      this.finish();
      return;
    }
  }

  private finish() {
    if (this.dst === null) {
      this.active = false;
      return;
    }

    if (this.mg.owner(this.dst) === this.attacker) {
      const deaths = this.boat.troops() * (malusForRetreat / 100);
      const survivors = this.boat.troops() - deaths;
      this.attacker.addTroops(survivors);
      this.boat.delete(false);
      this.active = false;

      this.mg.stats().boatArriveTroops(this.attacker, this.target, survivors);
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

    this.mg.stats().boatArriveTroops(this.attacker, this.target, this.boat.troops());
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }
}
