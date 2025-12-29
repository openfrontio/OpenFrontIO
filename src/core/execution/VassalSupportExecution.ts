import { Execution } from "../game/Game";
import { Player } from "../game/Game";

export class VassalSupportExecution implements Execution {
  private active = true;
  constructor(private readonly player: Player, private readonly ratio: number) {}

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  init(): void {}

  tick(): void {
    const clamped = Math.max(0, Math.min(1, this.ratio));
    if (typeof (this.player as any).setVassalSupportRatio === "function") {
      (this.player as any).setVassalSupportRatio(clamped);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }
}
