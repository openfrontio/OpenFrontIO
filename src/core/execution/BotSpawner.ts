import { consolex } from "../Consolex";
import { Game, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID, SpawnIntent } from "../Schemas";
import { simpleHash } from "../Util";
import { BOT_NAME_PREFIXES, BOT_NAME_SUFFIXES } from "./utils/BotNames";

export class BotSpawner {
  private random: PseudoRandom;
  private bots: SpawnIntent[] = [];

  constructor(
    private gs: Game,
    gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  spawnBots(numBots: number): SpawnIntent[] {
    let tries = 0;
    while (this.bots.length < numBots) {
      if (tries > 10000) {
        consolex.log("too many retries while spawning bots, giving up");
        return this.bots;
      }
      const botName = this.randomBotName();
      const spawn = this.spawnBot(botName);
      if (spawn != null) {
        this.bots.push(spawn);
      } else {
        tries++;
      }
    }
    return this.bots;
  }

  spawnBot(botName: string): SpawnIntent | null {
    const tile = this.randTile();
    if (!this.gs.isLand(tile)) {
      return null;
    }
    for (const spawn of this.bots) {
      if (this.gs.manhattanDist(this.gs.ref(spawn.x, spawn.y), tile) < 30) {
        return null;
      }
    }
    return {
      type: "spawn",
      playerID: this.random.nextID(),
      name: botName,
      playerType: PlayerType.Bot,
      x: this.gs.x(tile),
      y: this.gs.y(tile),
    };
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
