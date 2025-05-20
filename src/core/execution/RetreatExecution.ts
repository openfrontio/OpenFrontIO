import { Execution, Game, Player, PlayerID } from "../game/Game";

const cancelDelay = 20;

export class RetreatExecution implements Execution {
  private active = true;
  private retreatOrdered = false;
  private player: Player;
  private startTick: number;
  private mg: Game;
  constructor(
    private playerID: PlayerID,
    private attackID: string,
  ) {}

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.playerID)) {
      console.warn(`RetreatExecution: player ${this.playerID} not found`);
      return;
    }
    this.mg = mg;

    this.player = mg.player(this.playerID);
    this.startTick = mg.ticks();
  }

  tick(ticks: number): void {
    if (!this.retreatOrdered) {
      this.player.orderRetreat(this.attackID);
      this.retreatOrdered = true;
    }

    if (this.mg.ticks() >= this.startTick + cancelDelay) {
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
