import { consolex } from "../Consolex";
import { Execution, Game, Player, PlayerID } from "../game/Game";

export class StopEmbargoExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private targetID: PlayerID,
  ) {}

  init(mg: Game, _: number): void {
    if (!mg.hasPlayer(this.player.id())) {
      console.warn(
        `StopEmbargoExecution: sender ${this.player.id()} not found`,
      );
      this.active = false;
      return;
    }
    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`StopEmbargoExecution recipient ${this.targetID} not found`);
      this.active = false;
      return;
    }
  }

  tick(_: number): void {
    this.player.stopEmbargo(this.targetID);
    this.active = false;
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
