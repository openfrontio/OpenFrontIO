import { z } from "zod";
import { renderNumber } from "../../client/Utils";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
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
import { zInt, zPlayerRef, zRef, zTile } from "../snapshot/SnapshotType";
import { findClosestBy } from "../Util";

export class TradeShipExecution implements Execution {
  private active = true;
  private mg: Game;
  private tradeShip: Unit | undefined;
  private wasCaptured = false;
  private pathFinder: WaterPathFinder;
  private tilesTraveled = 0;
  private motionPlanId = 1;
  private motionPlanDst: TileRef | null = null;

  constructor(
    private origOwner: Player,
    private srcPort: Unit,
    private _dstPort: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    const stagger = mg.nextShipStagger("tradeShip");
    this.pathFinder = new WaterPathFinder(mg, stagger, true); // memoized: port tile to port tile repeats
  }

  tick(ticks: number): void {
    if (this.pathFinder.rebuilt) {
      this.motionPlanDst = null; // Force motion plan re-recording
    }

    if (this.tradeShip === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.TradeShip,
        this.srcPort.tile(),
      );
      if (spawn === false) {
        console.warn(`cannot build trade ship`);
        this.active = false;
        return;
      }
      this.tradeShip = this.origOwner.buildUnit(UnitType.TradeShip, spawn, {
        targetUnit: this._dstPort,
        lastSetSafeFromPirates: ticks,
      });
      this.mg.stats().boatSendTrade(this.origOwner, this._dstPort.owner());
    }

    if (!this.tradeShip.isActive()) {
      this.active = false;
      return;
    }

    const tradeShipOwner = this.tradeShip.owner();
    const dstPortOwner = this._dstPort.owner();
    if (this.wasCaptured !== true && this.origOwner !== tradeShipOwner) {
      // Store as variable in case ship is recaptured by previous owner
      this.wasCaptured = true;
      this.mg.displayMessage(
        "events_display.trade_ship_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: tradeShipOwner.displayName() },
        this.tradeShip.id(),
        tradeShipOwner.id(),
      );
    }

    // If a player captures another player's port while trading we should delete
    // the ship.
    if (dstPortOwner.id() === this.srcPort.owner().id()) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    if (
      !this.wasCaptured &&
      (!this._dstPort.isActive() || !tradeShipOwner.canTrade(dstPortOwner))
    ) {
      this.tradeShip.delete(false);
      this.active = false;
      return;
    }

    const curTile = this.tradeShip.tile();

    if (
      this.wasCaptured &&
      (tradeShipOwner !== dstPortOwner || !this._dstPort.isActive())
    ) {
      const myComponent = this.mg.getWaterComponent(curTile);
      const nearestPort = findClosestBy(
        tradeShipOwner.units(UnitType.Port),
        (port) => this.mg.manhattanDist(port.tile(), curTile),
        (port) =>
          port.isActive() &&
          !port.isMarkedForDeletion() &&
          !port.isUnderConstruction() &&
          myComponent !== null &&
          this.mg.hasWaterComponent(port.tile(), myComponent),
      );
      if (nearestPort === null) {
        this.tradeShip.delete(false);
        this.active = false;
        return;
      } else {
        this._dstPort = nearestPort;
        this.tradeShip.setTargetUnit(this._dstPort);
        // Plan-driven units don't emit per-tick unit updates, so force a sync for the new target.
        this.tradeShip.touch();
      }
    }

    if (curTile === this.dstPort()) {
      this.complete();
      return;
    }

    const dst = this._dstPort.tile();
    const result = this.pathFinder.next(curTile, dst);

    switch (result.status) {
      case PathStatus.NEXT:
        if (dst !== this.motionPlanDst) {
          this.motionPlanId++;
          const from = result.node;
          const path = this.pathFinder.pathForTraversal(from, dst);

          this.mg.recordMotionPlan({
            kind: "grid",
            unitId: this.tradeShip.id(),
            planId: this.motionPlanId,
            startTick: ticks + 1,
            ticksPerStep: 1,
            path,
          });
          this.motionPlanDst = dst;
        }
        // Update safeFromPirates status
        if (this.mg.isWater(result.node) && this.mg.isShoreline(result.node)) {
          this.tradeShip.setSafeFromPirates();
        }
        this.tradeShip.move(result.node);
        this.tilesTraveled++;
        break;
      case PathStatus.COMPLETE:
        this.complete();
        return;
      case PathStatus.NOT_FOUND:
        console.warn("captured trade ship cannot find route");
        if (this.tradeShip.isActive()) {
          this.tradeShip.delete(false);
        }
        this.active = false;
        return;
    }
  }

  private complete() {
    this.active = false;
    this.tradeShip!.delete(false);
    const gold = this.mg
      .config()
      .tradeShipGold(this.tilesTraveled, this.tradeShip!.owner());

    if (this.wasCaptured && this.tradeShip!.owner() === this.origOwner) {
      // Retaken by its original owner: the payout stands, but nobody pirated it.
      this.origOwner.addGold(gold, this._dstPort.tile());
    } else if (this.wasCaptured) {
      this.tradeShip!.owner().addGold(gold, this._dstPort.tile());
      this.tradeShip!.owner().addPiracyGold(gold);
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_ship",
        MessageType.CAPTURED_ENEMY_UNIT,
        this.tradeShip!.owner().id(),
        gold,
        {
          gold: renderNumber(gold),
          name: this.origOwner.displayName(),
        },
        undefined,
        this.origOwner.id(),
      );
      // Record stats
      this.mg
        .stats()
        .boatCapturedTrade(this.tradeShip!.owner(), this.origOwner, gold);
    } else {
      this.srcPort.owner().addGold(gold, this.srcPort.tile());
      this._dstPort.owner().addGold(gold, this._dstPort.tile());
      this.srcPort.owner().addTradeGold(gold);
      this._dstPort.owner().addTradeGold(gold);
      // Record stats
      this.mg
        .stats()
        .boatArriveTrade(this.srcPort.owner(), this._dstPort.owner(), gold);
    }
    return;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  dstPort(): TileRef {
    return this._dstPort.tile();
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return TradeShipExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      tradeShip: this.tradeShip === undefined ? null : w.unit(this.tradeShip),
      wasCaptured: this.wasCaptured,
      pathFinder:
        this.pathFinder === undefined
          ? null
          : waterPathFinderState(this.pathFinder),
      tilesTraveled: this.tilesTraveled,
      motionPlanId: this.motionPlanId,
      motionPlanDst: this.motionPlanDst,
      origOwner: w.player(this.origOwner),
      srcPort: w.unit(this.srcPort),
      dstPort: w.unit(this._dstPort),
    });
  }

  restoreSnapshot(s: TradeShipExecutionState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.tradeShip = s.tradeShip === null ? undefined : r.unit(s.tradeShip);
    this.wasCaptured = s.wasCaptured;
    if (s.pathFinder !== null) {
      this.pathFinder = restoreWaterPathFinder(r.game, s.pathFinder);
    }
    this.tilesTraveled = s.tilesTraveled;
    this.motionPlanId = s.motionPlanId;
    this.motionPlanDst = s.motionPlanDst;
    this.origOwner = r.player(s.origOwner);
    this.srcPort = r.unit(s.srcPort);
    this._dstPort = r.unit(s.dstPort);
  }
}

const TradeShipExecutionStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  tradeShip: zRef().nullable(),
  wasCaptured: z.boolean(),
  /** Null before init(). */
  pathFinder: WaterPathFinderSchema.nullable(),
  tilesTraveled: zInt(),
  motionPlanId: zInt(),
  motionPlanDst: zTile().nullable(),
  origOwner: zPlayerRef(),
  srcPort: zRef(),
  dstPort: zRef(),
});
type TradeShipExecutionState = z.infer<typeof TradeShipExecutionStateSchema>;

export const TradeShipExecutionSnapshot = execSnapshotType({
  name: "TradeShip",
  version: 1,
  schema: TradeShipExecutionStateSchema,
  cls: () => TradeShipExecution,
});
