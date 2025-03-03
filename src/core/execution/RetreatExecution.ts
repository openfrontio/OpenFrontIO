import { Execution, Game, Player, PlayerID } from "../game/Game";

const cancelDelay = 2;

export class RetreatExecution implements Execution {
  private active = true;
  private retreatOrdered = false;
  private player: Player;
  private executionDateInSecs = new Date().getTime() / 1000 + cancelDelay;

  constructor(
    private playerID: PlayerID,
    private attackID: string,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(`RetreatExecution: player ${this.player.id()} not found`);
      return;
    }

    this.player = mg.player(this.playerID);
  }

  tick(ticks: number): void {
    const nowInSecs = new Date().getTime() / 1000;

    if (!this.retreatOrdered) {
      this.player.orderRetreat(this.attackID);
      this.retreatOrdered = true;
    }

    if (nowInSecs >= this.executionDateInSecs) {
      this.player.executeRetreat(this.attackID);
      this.active = false;
    }
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
