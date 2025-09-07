import {
  Execution,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { GameUpdateType } from "../game/GameUpdates";
import { MirvExecution } from "./MIRVExecution";
import { NukeExecution } from "./NukeExecution";

export class CancelBombExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private player: Player,
    private unitID: number,
  ) {}

  init(mg: Game, ticks: number): void {
    // Store game reference and immediately process via tick() so this completes this cycle.
    this.mg = mg;
    this.tick(ticks);
  }

  tick(ticks: number): void {
    if (!this.active) return;

    try {
      const bomb = this.findBombUnit();
      if (!bomb) {
        console.warn(`Bomb with ID ${this.unitID} not found`);
        return;
      }

      // Verify ownership
      if (bomb.owner() !== this.player) {
        console.warn(
          `Player ${this.player.id()} cannot cancel bomb owned by ${bomb.owner().id()}`,
        );
        return;
      }

      const execution = this.findBombExecution(bomb);

      // Check if bomb can be cancelled (policy handled here conservatively)
      if (!this.canCancelBomb(execution, bomb)) {
        console.warn(
          `Bomb ${this.unitID} cannot be cancelled - likely already too close to target`,
        );
        return;
      }

      // Cancel the bomb by deleting it and showing message
      this.cancelBomb(execution, bomb);
    } finally {
      // Mark this execution complete after attempting cancellation
      this.active = false;
    }
  }

  private findBombUnit(): Unit | null {
    const bombTypes = [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV];
    for (const bombType of bombTypes) {
      const bombs = this.mg.units(bombType);
      const bomb = bombs.find((b) => b.id() === this.unitID);
      if (bomb) {
        return bomb;
      }
    }
    return null;
  }

  private findBombExecution(bomb: Unit): NukeExecution | MirvExecution | null {
    const exec = this.mg.findExecutionForUnit(bomb);
    return exec instanceof NukeExecution || exec instanceof MirvExecution
      ? exec
      : null;
  }

  private canCancelBomb(
    execution: NukeExecution | MirvExecution | null,
    bomb: Unit,
  ): boolean {
    if (execution) {
      return execution.canCancel();
    }
    // Fallback if no execution found
    return bomb.isActive();
  }

  private cancelBomb(
    execution: NukeExecution | MirvExecution | null,
    bomb: Unit,
  ): void {
    if (execution) {
      const success = execution.cancel();
      if (!success) {
        return;
      }
    } else {
      this.createMidAirExplosion(bomb);
      bomb.delete(true, this.player);

      // Display cancellation message to everyone except the owner (handled client-side)
      const messageType =
        bomb.type() === UnitType.AtomBomb
          ? MessageType.NUKE_CANCELLED
          : bomb.type() === UnitType.HydrogenBomb
            ? MessageType.HYDROGEN_BOMB_CANCELLED
            : MessageType.MIRV_CANCELLED;

      const key =
        bomb.type() === UnitType.AtomBomb
          ? "events_display.nuke_cancelled"
          : bomb.type() === UnitType.HydrogenBomb
            ? "events_display.hydrogen_bomb_cancelled"
            : "events_display.mirv_cancelled";

      this.mg.displayMessage(key, messageType, null, undefined, {
        name: this.player.name(),
        ownerID: this.player.smallID(),
      });
    }
  }

  private createMidAirExplosion(bomb: Unit): void {
    const currentTile = bomb.tile();
    this.mg.addUpdate({
      type: GameUpdateType.MidAirExplosion,
      tile: currentTile,
      bombType: bomb.type(),
    });
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
}
