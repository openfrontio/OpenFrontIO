import { zInt, zRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { fighterQuota, fightersAt } from "./air/AirUtils";
import { FighterExecution } from "./air/FighterExecution";

/**
 * Keeps an air base's fighter wing up to strength: every fighterRespawnTicks,
 * if the base has fewer fighters than its quota (half its slots) and a slot
 * is free, it launches one more (paid for like any build). Shared by
 * airbases and aircraft carriers through maintainFighterWing.
 */
export function maintainFighterWing(
  mg: Game,
  base: Unit,
  state: { ticksUntilSpawn: number },
): void {
  if (base.isUnderConstruction()) return;
  if (--state.ticksUntilSpawn > 0) return;
  state.ticksUntilSpawn = mg.config().fighterRespawnTicks();
  const owner = base.owner();
  if (fightersAt(owner, base) >= fighterQuota(owner, base)) return;
  if (owner.aircraftAt(base) >= owner.airCapacity(base)) return;
  mg.addExecution(new FighterExecution(owner, base));
}

export class AirbaseExecution implements Execution {
  private active = true;
  private mg: Game;
  private wing = { ticksUntilSpawn: 1 };

  constructor(private airbase: Unit) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (!this.airbase.isActive()) {
      this.active = false;
      return;
    }
    maintainFighterWing(this.mg, this.airbase, this.wing);
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AirbaseExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      airbase: w.unit(this.airbase),
      ticksUntilSpawn: this.wing.ticksUntilSpawn,
    });
  }

  restoreSnapshot(s: AirbaseState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.airbase = r.unit(s.airbase);
    this.wing = { ticksUntilSpawn: s.ticksUntilSpawn };
  }
}

const AirbaseStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  airbase: zRef(),
  ticksUntilSpawn: zInt(),
});
type AirbaseState = z.infer<typeof AirbaseStateSchema>;

export const AirbaseExecutionSnapshot = execSnapshotType({
  name: "Airbase",
  version: 1,
  schema: AirbaseStateSchema,
  cls: () => AirbaseExecution,
});
