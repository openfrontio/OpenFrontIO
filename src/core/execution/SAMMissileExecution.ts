import { z } from "zod";
import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PathFinding } from "../pathfinding/PathFinder";
import { PathStatus, SteppingPathFinder } from "../pathfinding/types";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  AirPathFinderSchema,
  airPathFinderState,
  restoreAirPathFinder,
} from "../snapshot/PathfinderSnapshots";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zNum, zPlayerRef, zRef, zTile } from "../snapshot/SnapshotType";
import { NukeType } from "../StatsSchemas";

const INTERCEPTED_UNIT_TRANSLATION_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.AtomBomb]: "unit_type.atom_bomb",
  [UnitType.HydrogenBomb]: "unit_type.hydrogen_bomb",
  [UnitType.MIRVWarhead]: "unit_type.mirv",
};

export class SAMMissileExecution implements Execution {
  private active = true;
  private pathFinder: SteppingPathFinder<TileRef>;
  private SAMMissile: Unit | undefined;
  private mg: Game;
  private speed: number = 0;

  constructor(
    private spawn: TileRef,
    private _owner: Player,
    private ownerUnit: Unit,
    private target: Unit,
    private targetTile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.pathFinder = PathFinding.Air(mg);
    this.mg = mg;
    this.speed = this.mg.config().defaultSamMissileSpeed();
    this.tick(ticks);
  }

  tick(ticks: number): void {
    this.SAMMissile ??= this._owner.buildUnit(UnitType.SAMMissile, this.spawn, {
      targetUnit: this.target,
    });
    if (!this.SAMMissile.isActive()) {
      this.active = false;
      return;
    }
    // The MIRV carrier itself can't be intercepted, only its warheads
    const nukesWhitelist = [
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRVWarhead,
    ];
    if (
      !this.target.isActive() ||
      !this.ownerUnit.isActive() ||
      this.target.owner() === this.SAMMissile.owner() ||
      !nukesWhitelist.includes(this.target.type())
    ) {
      // Clear the flag so other SAMs can re-target this nuke
      if (this.target.isActive()) {
        this.target.setTargetedBySAM(false);
      }
      this.SAMMissile.delete(false);
      this.active = false;
      return;
    }
    for (let i = 0; i < this.speed; i++) {
      const result = this.pathFinder.next(
        this.SAMMissile.tile(),
        this.targetTile,
      );
      if (result.status === PathStatus.COMPLETE) {
        this.mg.displayMessage(
          "events_display.missile_intercepted",
          MessageType.SAM_HIT,
          this._owner.id(),
          undefined,
          {
            unit:
              INTERCEPTED_UNIT_TRANSLATION_KEYS[this.target.type()] ??
              this.target.type(),
          },
        );
        this.active = false;
        this.target.delete(true, this._owner);
        this.SAMMissile.delete(false);

        // Record stats
        this.mg
          .stats()
          .bombIntercept(this._owner, this.target.type() as NukeType, 1);
        return;
      } else if (result.status === PathStatus.NEXT) {
        this.SAMMissile.move(result.node);
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return SAMMissileExecutionSnapshot.write({
      active: this.active,
      // mg and the pathfinder are both set by init.
      pathFinder:
        this.mg === undefined ? null : airPathFinderState(this.pathFinder),
      missile: this.SAMMissile === undefined ? null : w.unit(this.SAMMissile),
      speed: this.speed,
      spawn: this.spawn,
      owner: w.player(this._owner),
      ownerUnit: w.unit(this.ownerUnit),
      target: w.unit(this.target),
      targetTile: this.targetTile,
    });
  }

  restoreSnapshot(s: SAMMissileState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.pathFinder !== null) {
      this.mg = r.game;
      this.pathFinder = restoreAirPathFinder(r.game, s.pathFinder);
    }
    if (s.missile !== null) this.SAMMissile = r.unit(s.missile);
    this.speed = s.speed;
    this.spawn = s.spawn;
    this._owner = r.player(s.owner);
    this.ownerUnit = r.unit(s.ownerUnit);
    this.target = r.unit(s.target);
    this.targetTile = s.targetTile;
  }
}

const SAMMissileStateSchema = z.object({
  active: z.boolean(),
  pathFinder: AirPathFinderSchema.nullable(),
  missile: zRef().nullable(),
  speed: zNum(),
  spawn: zTile(),
  owner: zPlayerRef(),
  ownerUnit: zRef(),
  target: zRef(),
  targetTile: zTile(),
});
type SAMMissileState = z.infer<typeof SAMMissileStateSchema>;

export const SAMMissileExecutionSnapshot = execSnapshotType({
  name: "SAMMissile",
  version: 1,
  schema: SAMMissileStateSchema,
  cls: () => SAMMissileExecution,
});
