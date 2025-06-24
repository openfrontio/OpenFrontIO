import { Execution, Game, Player } from "../../game/Game";
import { GameImpl } from "../../game/GameImpl";

export class AllianceWinVoteReplyExecution implements Execution {
  active: boolean = true;
  game: Game;

  constructor(
    private voter: Player,
    private accept: boolean,
  ) {}

  init(mg: Game, ticks: number): void {
    this.game = mg;
    const gameImpl = this.game as GameImpl;

    if (gameImpl.currentVote === null) {
      console.warn("cant vote on a vote that does not exist.");
    } else {
      gameImpl.castVote(this.voter, this.accept);
    }
    this.active = false;
  }

  tick(ticks: number): void {
    if (this.game === null || this.voter === null) {
      throw new Error("Not initialized");
    }
  }

  isActive(): boolean {
    //Since this is a one tick execution, we do not need to keep this execution active.
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
