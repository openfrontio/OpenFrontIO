import { Execution, Game, Player } from "../game/Game";
import { ResearchType } from "../game/Research";

export class PurchaseResearchExecution implements Execution {
  constructor(
    private readonly player: Player,
    private readonly researchType: ResearchType,
  ) {}

  init(_game: Game): void {
    this.player.research().purchase(this.researchType);
  }

  tick(): void {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
