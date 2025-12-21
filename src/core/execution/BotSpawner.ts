import { Game, PlayerInfo, PlayerType } from "../game/Game";
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
    private gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  spawnBots(numBots: number): SpawnExecution[] {
    for (let i = 0; i < numBots; i++) {
      const candidate = this.nextCandidateName();
      const spawn = this.spawnBot(candidate.name);

      if (candidate.source === "list") {
        this.nameIndex++;
      }
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
}
