import { MessageType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { AIRPORT } from "@openfront/engine-lib/game/ModRules";
import {
  zInt,
  zPlayerRef,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { findClosestBy } from "@openfront/engine-lib/Util";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { stepAir } from "./ModMovement";

/**
 * A cargo plane flying from one airport to another. When it lands both airport
 * owners are paid. A fighter jet that catches it takes it over: from then on it
 * flies to the thief's nearest airport and pays the thief alone.
 */
export class CargoPlaneExecution implements Execution {
  private active = true;
  private mg: Game;
  private plane: Unit | undefined;
  private wasCaptured = false;
  private tilesTraveled = 0;

  constructor(
    private origOwner: Player,
    private srcAirport: Unit,
    private dstAirport: Unit,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.plane === undefined) {
      const spawn = this.origOwner.canBuild(
        UnitType.CargoPlane,
        this.srcAirport.tile(),
      );
      if (spawn === false) {
        console.warn("cannot build cargo plane");
        this.active = false;
        return;
      }
      this.plane = this.origOwner.buildUnit(UnitType.CargoPlane, spawn, {
        targetUnit: this.dstAirport,
      });
    }
    const plane = this.plane;
    if (!plane.isActive()) {
      this.active = false;
      return;
    }

    const planeOwner = plane.owner();
    if (!this.wasCaptured && planeOwner !== this.origOwner) {
      this.wasCaptured = true;
      this.mg.displayMessage(
        "events_display.cargo_plane_captured",
        MessageType.UNIT_DESTROYED,
        this.origOwner.id(),
        undefined,
        { name: planeOwner.displayName() },
        plane.id(),
        planeOwner.id(),
      );
    }

    const dstOwner = this.dstAirport.owner();
    if (!this.wasCaptured) {
      // Nobody trades with themselves, and an airport that vanished or went to
      // someone we cannot trade with cancels the flight.
      if (
        !this.dstAirport.isActive() ||
        dstOwner === this.srcAirport.owner() ||
        !planeOwner.canTrade(dstOwner)
      ) {
        plane.delete(false);
        this.active = false;
        return;
      }
    } else if (planeOwner !== dstOwner || !this.dstAirport.isActive()) {
      // A stolen plane heads for its new owner's nearest airport.
      const nearest = findClosestBy(
        planeOwner.units(UnitType.Airport),
        (a) => this.mg.manhattanDist(a.tile(), plane.tile()),
        (a) => a.isActive() && !a.isUnderConstruction(),
      );
      if (nearest === null) {
        plane.delete(false);
        this.active = false;
        return;
      }
      this.dstAirport = nearest;
      plane.setTargetUnit(nearest);
      plane.touch();
    }

    const dst = this.dstAirport.tile();
    let cur = plane.tile();
    for (let i = 0; i < AIRPORT.planeSpeed && cur !== dst; i++) {
      cur = stepAir(this.mg, cur, dst);
      plane.move(cur);
      this.tilesTraveled++;
    }
    if (cur === dst) {
      this.complete(plane);
    }
  }

  private complete(plane: Unit): void {
    this.active = false;
    const owner = plane.owner();
    plane.delete(false);
    const gold = this.mg.config().cargoPlaneGold(this.tilesTraveled, owner);
    const dstTile = this.dstAirport.tile();

    if (this.wasCaptured && owner === this.origOwner) {
      // Retaken by its original owner: paid, but nobody pirated it.
      this.origOwner.addGold(gold, dstTile);
    } else if (this.wasCaptured) {
      owner.addGold(gold, dstTile);
      owner.addPiracyGold(gold);
      this.mg.displayMessage(
        "events_display.received_gold_from_captured_plane",
        MessageType.CAPTURED_ENEMY_UNIT,
        owner.id(),
        gold,
        { gold: renderNumber(gold), name: this.origOwner.displayName() },
        undefined,
        this.origOwner.id(),
      );
    } else {
      this.srcAirport.owner().addGold(gold, this.srcAirport.tile());
      this.dstAirport.owner().addGold(gold, dstTile);
      this.srcAirport.owner().addTradeGold(gold);
      this.dstAirport.owner().addTradeGold(gold);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CargoPlaneExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      plane: this.plane === undefined ? null : w.unit(this.plane),
      wasCaptured: this.wasCaptured,
      tilesTraveled: this.tilesTraveled,
      origOwner: w.player(this.origOwner),
      srcAirport: w.unit(this.srcAirport),
      dstAirport: w.unit(this.dstAirport),
    });
  }

  restoreSnapshot(s: CargoPlaneState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.plane = s.plane === null ? undefined : r.unit(s.plane);
    this.wasCaptured = s.wasCaptured;
    this.tilesTraveled = s.tilesTraveled;
    this.origOwner = r.player(s.origOwner);
    this.srcAirport = r.unit(s.srcAirport);
    this.dstAirport = r.unit(s.dstAirport);
  }
}

const CargoPlaneStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  plane: zRef().nullable(),
  wasCaptured: z.boolean(),
  tilesTraveled: zInt(),
  origOwner: zPlayerRef(),
  srcAirport: zRef(),
  dstAirport: zRef(),
});
type CargoPlaneState = z.infer<typeof CargoPlaneStateSchema>;

export const CargoPlaneExecutionSnapshot = execSnapshotType({
  name: "CargoPlane",
  version: 1,
  schema: CargoPlaneStateSchema,
  cls: () => CargoPlaneExecution,
});
