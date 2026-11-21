import { TileRef } from "@openfront/engine-api/game/GameMap";
import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
} from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../game/Game";
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
import { maintainFighterWing } from "./AirbaseExecution";

/**
 * An aircraft carrier: a mobile air base. It sails from the nearest port to
 * its patrol tile (moved with the warship move command) and cruises around
 * it, keeping a fighter wing aloft and launching bombers and paratroopers
 * for its owner. It carries no guns of its own; warships and bombers sink it.
 */
export class CarrierExecution implements Execution {
  private active = true;
  private mg: Game;
  private carrier: Unit | null = null;
  private pathfinder: WaterPathFinder;
  private random: PseudoRandom;
  private wing = { ticksUntilSpawn: 1 };

  constructor(
    private player: Player,
    private patrolTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.pathfinder = new WaterPathFinder(mg);
    this.random = new PseudoRandom(ticks + 104_729);
    const spawn = this.player.canBuild(
      UnitType.AircraftCarrier,
      this.patrolTile,
    );
    if (spawn === false) {
      console.warn(`cannot build aircraft carrier at ${this.patrolTile}`);
      this.active = false;
      return;
    }
    this.carrier = this.player.buildUnit(UnitType.AircraftCarrier, spawn, {
      patrolTile: this.patrolTile,
    });
  }

  tick(ticks: number): void {
    const carrier = this.carrier;
    if (carrier === null) {
      this.active = false;
      return;
    }
    if (!carrier.isActive()) {
      this.active = false;
      return;
    }
    maintainFighterWing(this.mg, carrier, this.wing);
    this.cruise(carrier);
  }

  private cruise(carrier: Unit): void {
    if (carrier.targetTile() === undefined) {
      carrier.setTargetTile(this.randomPatrolTile(carrier));
      if (carrier.targetTile() === undefined) return;
    }
    const result = this.pathfinder.next(carrier.tile(), carrier.targetTile()!);
    switch (result.status) {
      case PathStatus.COMPLETE:
        carrier.setTargetTile(undefined);
        carrier.move(result.node);
        break;
      case PathStatus.NEXT:
        carrier.move(result.node);
        break;
      case PathStatus.NOT_FOUND:
        carrier.setTargetTile(undefined);
        break;
    }
  }

  /** A water tile in the carrier's water body near its patrol tile. */
  private randomPatrolTile(carrier: Unit): TileRef | undefined {
    const patrolTile = carrier.warshipState().patrolTile;
    if (patrolTile === undefined || !this.mg.isValidRef(patrolTile)) {
      return undefined;
    }
    const range = Math.max(4, Math.floor(this.mg.config().warshipPatrolRange() / 2));
    const component = this.mg.getWaterComponent(carrier.tile());
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = this.mg.x(patrolTile) + this.random.nextInt(-range, range + 1);
      const y = this.mg.y(patrolTile) + this.random.nextInt(-range, range + 1);
      if (!this.mg.isValidCoord(x, y)) continue;
      const t = this.mg.ref(x, y);
      if (!this.mg.isWater(t) || this.mg.isShoreline(t)) continue;
      if (component !== null && !this.mg.hasWaterComponent(t, component)) {
        continue;
      }
      return t;
    }
    return undefined;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return CarrierExecutionSnapshot.write({
      active: this.active,
      init:
        this.mg === undefined
          ? null
          : {
              random: w.random(this.random),
              pathfinder: waterPathFinderState(this.pathfinder),
            },
      player: w.player(this.player),
      patrolTile: this.patrolTile,
      carrier: w.unitOrNull(this.carrier),
      ticksUntilSpawn: this.wing.ticksUntilSpawn,
    });
  }

  restoreSnapshot(s: CarrierState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.init !== null) {
      this.mg = r.game;
      this.random = r.random(s.init.random);
      this.pathfinder = restoreWaterPathFinder(r.game, s.init.pathfinder);
    }
    this.player = r.player(s.player);
    this.patrolTile = s.patrolTile;
    this.carrier = r.unitOrNull(s.carrier);
    this.wing = { ticksUntilSpawn: s.ticksUntilSpawn };
  }
}

const CarrierStateSchema = z.object({
  active: z.boolean(),
  init: z
    .object({ random: zRandom(), pathfinder: WaterPathFinderSchema })
    .nullable(),
  player: zPlayerRef(),
  // Untrusted intent data, validated by canBuild in init.
  patrolTile: zInt(),
  carrier: zRef().nullable(),
  ticksUntilSpawn: zInt(),
});
type CarrierState = z.infer<typeof CarrierStateSchema>;

export const CarrierExecutionSnapshot = execSnapshotType({
  name: "Carrier",
  version: 1,
  schema: CarrierStateSchema,
  cls: () => CarrierExecution,
});
