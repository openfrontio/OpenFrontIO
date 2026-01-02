import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { SpawnExecution } from "./SpawnExecution";
import { BOT_NAME_PREFIXES, BOT_NAME_SUFFIXES } from "./utils/BotNames";

export class BotSpawner {
  private random: PseudoRandom;
  private bots: SpawnExecution[] = [];

  constructor(
    private gs: Game,
    private gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  spawnBots(numBots: number): SpawnExecution[] {
    for (let i = 0; i < numBots; i++) {
      const name = this.randomBotName();
      const spawn = this.spawnBot(name);
      this.bots.push(spawn);
    }

    return this.bots;
  }

  spawnBot(botName: string): SpawnExecution {
    return new SpawnExecution(
      this.gameID,
      new PlayerInfo(botName, PlayerType.Bot, null, this.random.nextID()),
    );
  }

  private randomBotName(): string {
    const prefixIndex = this.random.nextInt(0, BOT_NAME_PREFIXES.length);
    const suffixIndex = this.random.nextInt(0, BOT_NAME_SUFFIXES.length);
    return `${BOT_NAME_PREFIXES[prefixIndex]} ${BOT_NAME_SUFFIXES[suffixIndex]}`;
  }
}
