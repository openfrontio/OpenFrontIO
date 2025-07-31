import { Execution, Game, PlayerType } from "../game/Game";
import { BotSpawner } from "./BotSpawner";

export class DelayedBotSpawnExecution implements Execution {
  private active = true;
  private mg: Game;
  private botsSpawned = false;
  private tickCount = 0;
  private readonly MAX_WAIT_TICKS = 6000;

  constructor(private gameID: string) {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    this.tickCount++;
    
    if (this.botsSpawned) {
      this.active = false;
      return;
    }

    if (this.tickCount >= this.MAX_WAIT_TICKS) {
      console.warn("DelayedBotSpawnExecution: No human spawned after timeout, spawning bots anyway");
      const botSpawner = new BotSpawner(this.mg, this.gameID);
      const botSpawns = botSpawner.spawnBots(this.mg.config().numBots());
      this.mg.addExecution(...botSpawns);
      this.botsSpawned = true;
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
