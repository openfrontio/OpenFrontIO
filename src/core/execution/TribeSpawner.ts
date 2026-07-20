import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { SpawnExecution } from "./SpawnExecution";
import { type TribeNameData, resolveTribeNameData } from "./utils/TribeNames";

export class TribeSpawner {
  private random: PseudoRandom;
  private tribeNameData: TribeNameData;
  private usedCustomTribes: Set<string> = new Set();

  constructor(
    private gs: Game,
    private gameID: GameID,
  ) {
    // Use a different seed than createGameRunner (which uses simpleHash(gameID))
    // to avoid tribe IDs colliding with nation/human IDs from the same PRNG sequence.
    this.random = new PseudoRandom(simpleHash(gameID) + 2);
    this.tribeNameData = resolveTribeNameData(gs.config().gameConfig().gameMap);
  }

  spawnTribes(numTribes: number): SpawnExecution[] {
    const tribes: SpawnExecution[] = [];
    for (let i = 0; i < numTribes; i++) {
      tribes.push(this.spawnTribe(this.randomTribeName()));
    }
    return tribes;
  }

  spawnTribe(tribeName: string): SpawnExecution {
    return new SpawnExecution(
      this.gameID,
      new PlayerInfo(tribeName, PlayerType.Bot, null, this.random.nextID()),
    );
  }

  private randomTribeName(): string {
    const { customTribes, prefixes, suffixes } = this.tribeNameData;

    // Use custom tribes first (random selection, no duplicates until exhausted).
    if (customTribes !== undefined) {
      const available = customTribes.filter(
        (name) => !this.usedCustomTribes.has(name),
      );
      if (available.length > 0) {
        const index = this.random.nextInt(0, available.length);
        const chosen = available[index];
        this.usedCustomTribes.add(chosen);
        return chosen;
      }
    }

    // Fall back to theme-based prefix + suffix names.
    const prefixIndex = this.random.nextInt(0, prefixes.length);
    const suffixIndex = this.random.nextInt(0, suffixes.length);
    return `${prefixes[prefixIndex]} ${suffixes[suffixIndex]}`;
  }
}
