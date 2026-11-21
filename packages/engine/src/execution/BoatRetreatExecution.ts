import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { zInt, zPlayerRef } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

export class BoatRetreatExecution implements Execution {
  private active = true;
  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {}

  tick(ticks: number): void {
    const unit = this.player
      .units()
      .find(
        (unit) =>
          unit.id() === this.unitID &&
          (unit.type() === UnitType.TransportShip ||
            unit.type() === UnitType.TroopColumn),
      );

    // A troop column marching through allied land turns back at once: it
    // dissolves and its troops rejoin the army, less the retreat penalty.
    if (unit?.type() === UnitType.TroopColumn) {
      this.player.addTroops(Math.floor(unit.troops() * 0.75));
      unit.delete(false);
      this.active = false;
      return;
    }

    if (!unit) {
      console.warn(`Didn't find outgoing boat with id ${this.unitID}`);
      this.active = false;
      return;
    }

    unit.updateTransportShipState({ isRetreating: true });
    this.active = false;
  }

  owner(): Player {
    return this.player;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return BoatRetreatExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      unitID: this.unitID,
    });
  }

  restoreSnapshot(s: BoatRetreatState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.unitID = s.unitID;
  }
}

const BoatRetreatStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  unitID: zInt(),
});
type BoatRetreatState = z.infer<typeof BoatRetreatStateSchema>;

export const BoatRetreatExecutionSnapshot = execSnapshotType({
  name: "BoatRetreat",
  version: 1,
  schema: BoatRetreatStateSchema,
  cls: () => BoatRetreatExecution,
});
