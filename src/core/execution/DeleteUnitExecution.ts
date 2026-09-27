import { z } from "zod";
import { Execution, Game, MessageType, Player, Unit } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zInt, zPlayerRef, zRef } from "../snapshot/SnapshotType";

export class DeleteUnitExecution implements Execution {
  private active: boolean = true;
  private mg: Game;
  private unit: Unit | null = null;

  constructor(
    private player: Player,
    private unitId: number,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;

    const unit = this.mg.unit(this.unitId);
    if (!unit || unit.owner() !== this.player) {
      console.warn(
        `SECURITY: unit ${this.unitId} not found or not owned by player ${this.player.displayName()}`,
      );
      this.active = false;
      return;
    }

    if (!unit.isActive()) {
      console.warn(`SECURITY: unit ${this.unitId} is not active`);
      this.active = false;
      return;
    }
    this.unit = unit;

    const tileOwner = mg.owner(unit.tile());
    if (!tileOwner.isPlayer() || tileOwner.id() !== this.player.id()) {
      console.warn(
        `SECURITY: unit ${this.unitId} is not on player's territory`,
      );
      this.active = false;
      return;
    }

    if (!mg.isLand(unit.tile())) {
      console.warn(`SECURITY: unit ${this.unitId} is not on land`);
      this.active = false;
      return;
    }

    if (mg.inSpawnPhase()) {
      console.warn(`SECURITY: cannot delete units during spawn phase`);
      this.active = false;
      return;
    }

    if (!this.player.canDeleteUnit()) {
      console.warn(`SECURITY: delete unit cooldown not expired`);
      this.active = false;
      return;
    }

    this.player.recordDeleteUnit();
    unit.markForDeletion();
  }

  tick(ticks: number) {
    if (!this.active || !this.unit) {
      return;
    }
    if (!this.unit.isActive()) {
      this.active = false;
      return;
    }
    if (this.unit.isOverdueDeletion()) {
      this.unit.delete(false);

      this.mg.displayMessage(
        `events_display.unit_voluntarily_deleted`,
        MessageType.UNIT_DESTROYED,
        this.player.id(),
      );
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return DeleteUnitExecutionSnapshot.write({
      active: this.active,
      initialized: this.mg !== undefined,
      unit: w.unitOrNull(this.unit),
      player: w.player(this.player),
      unitId: this.unitId,
    });
  }

  restoreSnapshot(s: DeleteUnitState, r: SnapshotReader): void {
    this.active = s.active;
    if (s.initialized) this.mg = r.game;
    this.unit = r.unitOrNull(s.unit);
    this.player = r.player(s.player);
    this.unitId = s.unitId;
  }
}

const DeleteUnitStateSchema = z.object({
  active: z.boolean(),
  initialized: z.boolean(),
  unit: zRef().nullable(),
  player: zPlayerRef(),
  unitId: zInt(),
});
type DeleteUnitState = z.infer<typeof DeleteUnitStateSchema>;

export const DeleteUnitExecutionSnapshot = execSnapshotType({
  name: "DeleteUnit",
  version: 1,
  schema: DeleteUnitStateSchema,
  cls: () => DeleteUnitExecution,
});
