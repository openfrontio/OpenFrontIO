import { z } from "zod";
import { renderTroops } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerType,
  TerraNullius,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { MotionPlanRecord } from "../game/MotionPlans";
import { targetTransportTile } from "../game/TransportShipUtils";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PathStatus } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  restoreWaterPathFinder,
  WaterPathFinderSchema,
  waterPathFinderState,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zNum, zPlayerRef, zRef, zTile } from "../snapshot/SnapshotType";
import { AttackExecution } from "./AttackExecution";

const malusForRetreat = 25;

export class TransportShipExecution implements Execution {
  private active = true;

  // TODO: make this configurable
  private ticksPerMove = 1;
  private lastMove: number;

  private mg: Game;
  private target: Player | TerraNullius;
  private pathFinder: WaterPathFinder;

  private dst: TileRef | null;
  private src: TileRef | null;
  private retreatDst: TileRef | false | null = null;
  private boat: Unit;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  private originalOwner: Player;

  constructor(
    private attacker: Player,
    private ref: TileRef,
    private troops: number,
  ) {
    this.originalOwner = this.attacker;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!mg.isValidRef(this.ref)) {
      console.warn(`TransportShipExecution: ref ${this.ref} not valid`);
      this.active = false;
      return;
    }

    this.lastMove = ticks;
    this.mg = mg;
    this.target = mg.owner(this.ref);
    const stagger = mg.nextShipStagger("transportShip");
    this.pathFinder = new WaterPathFinder(mg, stagger);

    if (
      this.attacker.unitCount(UnitType.TransportShip) >=
      mg.config().boatMaxNumber()
    ) {
      mg.displayMessage(
        "events_display.no_boats_available",
        MessageType.ATTACK_FAILED,
        this.attacker.id(),
        undefined,
        { max: mg.config().boatMaxNumber() },
      );
      this.active = false;
      return;
    }

    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this.attacker.type() !== PlayerType.Bot
      ) {
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target === this.attacker) {
      this.active = false;
      return;
    }

    if (this.target.isPlayer() && !this.attacker.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.troops ??= this.mg
      .config()
      .boatAttackAmount(this.attacker, this.target);
    this.troops = Math.min(this.troops, this.attacker.troops());

    this.dst = targetTransportTile(this.mg, this.attacker, this.ref);

    if (this.dst === null) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find target tile`,
      );
      this.active = false;
      return;
    }

    const src = this.attacker.canBuild(UnitType.TransportShip, this.dst);

    if (src === false) {
      console.warn(
        `${this.attacker} cannot send ship to ${this.target}, cannot find start tile`,
      );
      this.active = false;
      return;
    }

    this.src = src;

    this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.src, {
      troops: this.troops,
      targetTile: this.dst,
    });

    const fullPath = this.pathFinder.findPath(this.src, this.dst) ?? [this.src];
    if (fullPath.length === 0 || fullPath[0] !== this.src) {
      fullPath.unshift(this.src);
    }

    const motionPlan: MotionPlanRecord = {
      kind: "grid",
      unitId: this.boat.id(),
      planId: this.motionPlanId,
      startTick: ticks + this.ticksPerMove,
      ticksPerStep: this.ticksPerMove,
      path: fullPath,
    };
    this.mg.recordMotionPlan(motionPlan);
    this.motionPlanDst = this.dst;

    // Notify the target player about the incoming naval invasion
    if (this.target.id() !== mg.terraNullius().id()) {
      mg.displayIncomingUnit(
        this.boat.id(),
        // TODO TranslateText
        `Naval invasion incoming from ${this.attacker.displayName()} (${renderTroops(this.boat.troops())})`,
        MessageType.NAVAL_INVASION_INBOUND,
        this.target.id(),
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

    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    // Auto-retreat if destination was destroyed by nuke (turned to water)
    // Checked every tick (not just on graph rebuild) because graph rebuilds
    // are throttled and the tile may already be water before the version bumps.
    if (this.dst !== null && this.mg.isWater(this.dst)) {
      if (!this.boat.transportShipState().isRetreating) {
        this.boat.updateTransportShipState({ isRetreating: true });
      }
      // Reset cached retreat destination so it's recomputed from current position
      this.retreatDst = null;
    }

    if (this.boat.transportShipState().isRetreating) {
      // Resolve retreat destination once, based on current boat location when retreat begins.
      this.retreatDst ??= this.attacker.bestTransportShipSpawn(
        this.boat.tile(),
      );

      if (this.retreatDst === false) {
        console.warn(
          `TransportShipExecution: retreating but no retreat destination found`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      } else {
        this.dst = this.retreatDst;

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
              "events_display.attack_cancelled_retreat",
              MessageType.ATTACK_CANCELLED,
              this.attacker.id(),
              undefined,
              { troops: renderTroops(deaths) },
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
              this.target.id(),
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
      case PathStatus.NOT_FOUND: {
        // TODO: add to poisoned port list
        const map = this.mg.map();
        const boatTile = this.boat.tile();
        console.warn(
          `TransportShip path not found: boat@(${map.x(boatTile)},${map.y(boatTile)}) -> dst@(${map.x(this.dst)},${map.y(this.dst)}), attacker=${this.attacker.id()}, target=${this.target.id()}`,
        );
        this.attacker.addTroops(this.boat.troops());
        this.boat.delete(false);
        this.active = false;
        return;
      }
    }

    if (this.dst !== null && this.dst !== this.motionPlanDst) {
      this.motionPlanId++;
      const fullPath = this.pathFinder.findPath(this.boat.tile(), this.dst) ?? [
        this.boat.tile(),
      ];
      if (fullPath.length === 0 || fullPath[0] !== this.boat.tile()) {
        fullPath.unshift(this.boat.tile());
      }

      this.mg.recordMotionPlan({
        kind: "grid",
        unitId: this.boat.id(),
        planId: this.motionPlanId,
        startTick: ticks + this.ticksPerMove,
        ticksPerStep: this.ticksPerMove,
        path: fullPath,
      });
      this.motionPlanDst = this.dst;
    }
  }

  owner(): Player {
    return this.attacker;
  }

  isActive(): boolean {
    return this.active;
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this.attacker
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    // Fields init() leaves unset on an early return are stored as undefined.
    return TransportShipExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      ticksPerMove: this.ticksPerMove,
      lastMove: this.lastMove,
      target: this.target === undefined ? undefined : w.owner(this.target),
      pathFinder:
        this.pathFinder === undefined
          ? undefined
          : waterPathFinderState(this.pathFinder),
      dst: this.dst,
      src: this.src,
      retreatDst: this.retreatDst,
      boat: this.boat === undefined ? undefined : w.unit(this.boat),
      motionPlanId: this.motionPlanId,
      motionPlanDst: this.motionPlanDst,
      originalOwner: w.player(this.originalOwner),
      attacker: w.player(this.attacker),
      ref: this.ref,
      troops: this.troops,
    });
  }

  restoreSnapshot(s: TransportShipExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.ticksPerMove = s.ticksPerMove;
    if (s.lastMove !== undefined) this.lastMove = s.lastMove;
    if (s.target !== undefined) this.target = r.owner(s.target);
    if (s.pathFinder !== undefined) {
      this.pathFinder = restoreWaterPathFinder(r.game, s.pathFinder);
    }
    if (s.dst !== undefined) this.dst = s.dst;
    if (s.src !== undefined) this.src = s.src;
    this.retreatDst = s.retreatDst;
    if (s.boat !== undefined) this.boat = r.unit(s.boat);
    this.motionPlanId = s.motionPlanId;
    this.motionPlanDst = s.motionPlanDst;
    this.originalOwner = r.player(s.originalOwner);
    this.attacker = r.player(s.attacker);
    this.ref = s.ref;
    this.troops = s.troops;
  }
}

const TransportShipExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  ticksPerMove: zInt(),
  lastMove: zInt().optional(),
  target: zPlayerRef().optional(),
  pathFinder: WaterPathFinderSchema.optional(),
  dst: zTile().nullable().optional(),
  src: zTile().nullable().optional(),
  /** Unresolved (null), none found (false), or the retreat tile. */
  retreatDst: z.union([zTile(), z.literal(false)]).nullable(),
  boat: zRef().optional(),
  motionPlanId: zInt(),
  motionPlanDst: zTile().nullable(),
  originalOwner: zPlayerRef(),
  attacker: zPlayerRef(),
  // Unvalidated until init() checks it.
  ref: zInt(),
  troops: zNum(),
});
type TransportShipExecutionState = z.infer<
  typeof TransportShipExecutionStateSchema
>;

export const TransportShipExecutionSnapshot = execSnapshotType({
  name: "TransportShip",
  version: 1,
  schema: TransportShipExecutionStateSchema,
  cls: () => TransportShipExecution,
});
