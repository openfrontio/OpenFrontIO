import { Execution, Game, PlayerType } from "../game/Game";
import { BotSpawner } from "./BotSpawner";

export class DelayedBotSpawnExecution implements Execution {
  private active = true;
  private mg: Game;
  private botsSpawned = false;

  constructor(private gameID: string) {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (this.botsSpawned) {
      this.active = false;
      return;
    }

    const hasHumanSpawned = this.mg
      .players()
      .some(
        (player) => player.type() === PlayerType.Human && player.hasSpawned(),
      );

    if (hasHumanSpawned) {
      const botSpawner = new BotSpawner(this.mg, this.gameID);
      const botSpawns = botSpawner.spawnBots(this.mg.config().numBots());

      this.mg.addExecution(...botSpawns);

      this.botsSpawned = true;
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
