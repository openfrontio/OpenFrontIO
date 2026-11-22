import { Aircraft } from "@openfront/engine-api/game/GameTypes";
import {
  AA_GUN_MAX_VOLLEY,
  AA_GUN_RANGE,
  AA_GUN_RELOAD_TICKS,
} from "@openfront/engine-lib/game/AirRules";
import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player, Unit } from "../../game/Game";
import { execSnapshotType } from "../../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import { ShellExecution } from "../ShellExecution";
import { isHostileTo, noAircraftInFlight } from "./AirCombat";

/**
 * AIR update: a short-range anti-aircraft gun.
 *
 * It aims with its own fire-control radar, so it needs no radar network and
 * engages helicopters and jets alike, but only within a short range. Each
 * level adds a barrel (one more flak shell per volley, capped). It cannot
 * engage missiles or nukes: that remains the SAM launcher's job.
 */
export class AAGunExecution implements Execution {
  private mg: Game;
  private active = true;
  private lastVolley = -1000;

  constructor(private gun: Unit) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.gun.isActive()) {
      this.active = false;
      return;
    }
    if (this.gun.isUnderConstruction()) return;
    if (ticks - this.lastVolley < AA_GUN_RELOAD_TICKS) return;
    // No aircraft anywhere: skip the spatial query.
    if (noAircraftInFlight(this.mg)) return;

    const owner = this.gun.owner() as Player;
    const targets = this.mg
      .nearbyUnits(this.gun.tile(), AA_GUN_RANGE, Aircraft.types)
      .filter(({ unit }) => unit.isActive() && isHostileTo(owner, unit))
      .sort(
        (a, b) => a.distSquared - b.distSquared || a.unit.id() - b.unit.id(),
      );
    if (targets.length === 0) return;

    this.lastVolley = ticks;
    const volley = Math.min(this.gun.level(), AA_GUN_MAX_VOLLEY);
    for (let i = 0; i < volley; i++) {
      const target = targets[i % targets.length].unit;
      this.mg.addExecution(
        new ShellExecution(this.gun.tile(), owner, this.gun, target),
      );
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AAGunExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      gun: w.unit(this.gun),
      lastVolley: this.lastVolley,
    });
  }

  restoreSnapshot(s: AAGunState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.gun = r.unit(s.gun);
    this.lastVolley = s.lastVolley;
  }
}

const AAGunStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  gun: zRef(),
  lastVolley: zInt(),
});
type AAGunState = z.infer<typeof AAGunStateSchema>;

export const AAGunExecutionSnapshot = execSnapshotType({
  name: "AAGun",
  version: 1,
  schema: AAGunStateSchema,
  cls: () => AAGunExecution,
});
