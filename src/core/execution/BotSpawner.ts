import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { SpawnExecution } from "./SpawnExecution";
import {
  COMMUNITY_FULL_ELF_NAMES,
  COMMUNITY_PREFIXES,
  SPECIAL_FULL_ELF_NAMES,
} from "./utils/BotNames";

export class BotSpawner {
  private random: PseudoRandom;
  private bots: SpawnExecution[] = [];
  private nameIndex = 0;

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
      const candidate = this.nextCandidateName();
      const spawn = this.spawnBot(candidate.name);
      if (spawn !== null) {
        // Only use candidate name once bot successfully spawned
        if (candidate.source === "list") {
          this.nameIndex++;
        }
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
      new PlayerInfo(botName, PlayerType.Bot, null, this.random.nextID()),
      tile,
    );
  }

  private nextCandidateName(): {
    name: string;
    source: "list" | "random";
  } {
    if (this.bots.length < 20) {
      //first few usually overwritten by Nation spawn
      return { name: this.getRandomElf(), source: "random" };
    }

    if (this.nameIndex < COMMUNITY_FULL_ELF_NAMES.length) {
      return {
        name: COMMUNITY_FULL_ELF_NAMES[this.nameIndex],
        source: "list",
      };
    }
    const specialOffset = COMMUNITY_FULL_ELF_NAMES.length;
    if (this.nameIndex < specialOffset + SPECIAL_FULL_ELF_NAMES.length) {
      return {
        name: SPECIAL_FULL_ELF_NAMES[this.nameIndex - specialOffset],
        source: "list",
      };
    }
    const prefixOffset = specialOffset + SPECIAL_FULL_ELF_NAMES.length;
    if (this.nameIndex < prefixOffset + COMMUNITY_PREFIXES.length) {
      return {
        name: `${COMMUNITY_PREFIXES[this.nameIndex - prefixOffset]} the Elf`,
        source: "list",
      };
    }

    return { name: this.getRandomElf(), source: "random" };
  }

  private getRandomElf(): string {
    const suffixNumber = this.random.nextInt(1, 10001);
    return `Elf ${suffixNumber}`;
  }

  private randTile(): TileRef {
    return this.gs.ref(
      this.random.nextInt(0, this.gs.width()),
      this.random.nextInt(0, this.gs.height()),
    );
  }
}
