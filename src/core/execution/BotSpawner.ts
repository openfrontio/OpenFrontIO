import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
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
    gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  spawnBots(numBots: number): SpawnExecution[] {
    let tries = 0;
    while (this.bots.length < numBots) {
      if (tries > 10000) {
        console.log("too many retries while spawning bots, giving up");
        return this.bots;
      }
      const botName = this.randomBotName();
      const spawn = this.spawnBot(botName);
      if (spawn !== null) {
        this.bots.push(spawn);
      } else {
        tries++;
      }
    }
    return this.bots;
  }

  spawnBot(botName: string): SpawnExecution | null {
    const tile = this.randTile();
    if (!this.gs.isLand(tile)) {
      return null;
    }
    for (const spawn of this.bots) {
      if (this.gs.manhattanDist(spawn.tile, tile) < 30) {
        return null;
      }
    }
    return new SpawnExecution(
      new PlayerInfo(
        undefined,
        "",
        botName,
        PlayerType.Bot,
        null,
        this.random.nextID(),
      ),
      tile,
    );
  }

  private randomBotName(): string {
    const prefixIndex = this.random.nextInt(0, BOT_NAME_PREFIXES.length);
    const suffixIndex = this.random.nextInt(0, BOT_NAME_SUFFIXES.length);
    return `${BOT_NAME_PREFIXES[prefixIndex]} ${BOT_NAME_SUFFIXES[suffixIndex]}`;
  }

  private randTile(): TileRef {
    return this.gs.ref(
      this.random.nextInt(0, this.gs.width()),
      this.random.nextInt(0, this.gs.height()),
    );
  }
}
