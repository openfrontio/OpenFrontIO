import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zRef } from "../snapshot/SnapshotType";
import { ShellExecution } from "./ShellExecution";

export class DefensePostExecution implements Execution {
  private mg: Game;
  private active: boolean = true;

  private target: Unit | null = null;
  private lastShellAttack = 0;

  private alreadySentShell = new Set<Unit>();

  constructor(private post: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  private shoot() {
    if (this.target === null) return;
    const shellAttackRate = this.mg.config().defensePostShellAttackRate();
    if (this.mg.ticks() - this.lastShellAttack > shellAttackRate) {
      this.lastShellAttack = this.mg.ticks();
      this.mg.addExecution(
        new ShellExecution(
          this.post.tile(),
          this.post.owner(),
          this.post,
          this.target,
        ),
      );
      if (!this.target.hasHealth()) {
        // Don't send multiple shells to target that can be oneshotted
        this.alreadySentShell.add(this.target);
        this.target = null;
        return;
      }
    }
  }

  tick(ticks: number): void {
    if (!this.post.isActive()) {
      this.active = false;
      return;
    }

    // Do nothing while the structure is under construction
    if (this.post.isUnderConstruction()) {
      return;
    }

    if (this.target !== null && !this.target.isActive()) {
      this.target = null;
    }

    // TODO: Reconsider how/if defense posts target ships.
    // const ships = this.mg
    //   .nearbyUnits(
    //     this.post.tile(),
    //     this.mg.config().defensePostTargettingRange(),
    //     [UnitType.TransportShip, UnitType.Warship],
    //   )
    //   .filter(
    //     ({ unit }) =>
    //       this.post !== null &&
    //       unit.owner() !== this.post.owner() &&
    //       !unit.owner().isFriendly(this.post.owner()) &&
    //       !this.alreadySentShell.has(unit),
    //   );
    //
    // this.target =
    //   ships.sort((a, b) => {
    //     const { unit: unitA, distSquared: distA } = a;
    //     const { unit: unitB, distSquared: distB } = b;
    //
    //     // Prioritize TransportShip
    //     if (
    //       unitA.type() === UnitType.TransportShip &&
    //       unitB.type() !== UnitType.TransportShip
    //     )
    //       return -1;
    //     if (
    //       unitA.type() !== UnitType.TransportShip &&
    //       unitB.type() === UnitType.TransportShip
    //     )
    //       return 1;
    //
    //     // If both are the same type, sort by distance (lower `distSquared` means closer)
    //     return distA - distB;
    //   })[0]?.unit ?? null;
    //
    // if (this.target === null || !this.target.isActive()) {
    //   this.target = null;
    //   return;
    // } else {
    //   this.shoot();
    //   return;
    // }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DefensePostExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      post: w.unit(this.post),
      target: w.unitOrNull(this.target),
      lastShellAttack: this.lastShellAttack,
      alreadySentShell: [...this.alreadySentShell].map((u) => w.unit(u)),
    });
  }

  restoreSnapshot(s: DefensePostState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.post = r.unit(s.post);
    this.target = r.unitOrNull(s.target);
    this.lastShellAttack = s.lastShellAttack;
    this.alreadySentShell = new Set(s.alreadySentShell.map((i) => r.unit(i)));
  }
}

const DefensePostStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  post: zRef(),
  target: zRef().nullable(),
  lastShellAttack: zInt(),
  alreadySentShell: z.array(zRef()),
});
type DefensePostState = z.infer<typeof DefensePostStateSchema>;

export const DefensePostExecutionSnapshot = execSnapshotType({
  name: "DefensePost",
  version: 1,
  schema: DefensePostStateSchema,
  cls: () => DefensePostExecution,
});
