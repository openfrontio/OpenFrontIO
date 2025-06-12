import { Execution, Game, Player } from "../../game/Game";

export class AllianceWinVoteReplyExecution implements Execution {
  active: boolean = true;
  game: Game;

  constructor(
    private voter: Player,
    private accept: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.voter.id())) {
      console.warn(
        `AllianceWinVoteReplyExecution: recipient ${this.voter.id()} not found`,
      );
      this.active = false;
      return;
    }
    this.game = mg;
  }

  tick(ticks: number): void {
    if (this.game === null || this.voter === null) {
      throw new Error("Not initialized");
    }

    if (this.game.runningVote() === null) {
      console.warn("cant vote on a vote that does not exist.");
    } else {
      this.game.castVote(this.voter, this.accept);
    }
    this.active = false;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
