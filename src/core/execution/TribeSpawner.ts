import { Game, GameMapSize, PlayerInfo, PlayerType } from "../game/Game";
import { type CustomTribe } from "../game/Maps.gen";
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
    const { customTribes } = this.tribeNameData;

    // Spawn positioned custom tribes first (those with coordinates).
    if (customTribes !== undefined) {
      const positioned = customTribes.filter((ct) => ct.coordinates);
      for (const ct of positioned) {
        if (tribes.length >= numTribes) break;
        const exec = this.spawnPositionedTribe(ct);
        if (exec !== undefined) {
          tribes.push(exec);
          this.usedCustomTribes.add(ct.name);
        }
      }
    }

    // Fill remaining slots with random-spawn tribes.
    while (tribes.length < numTribes) {
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

  /**
   * Spawn a custom tribe at its exact coordinates.
   * Returns undefined if the tile is not valid (water, impassable, or already owned).
   */
  private spawnPositionedTribe(ct: CustomTribe): SpawnExecution | undefined {
    const coords = ct.coordinates!;
    const isCompact =
      this.gs.config().gameConfig().gameMapSize === GameMapSize.Compact;
    const x = isCompact ? Math.floor(coords[0] / 2) : coords[0];
    const y = isCompact ? Math.floor(coords[1] / 2) : coords[1];

    if (!this.gs.isValidCoord(x, y)) {
      console.warn(
        `[TribeSpawner] Tribe "${ct.name}" coordinates [${x},${y}] out of bounds`,
      );
      return undefined;
    }
    const tile = this.gs.ref(x, y);
    if (
      !this.gs.isLand(tile) ||
      this.gs.hasOwner(tile) ||
      this.gs.isImpassable(tile)
    ) {
      console.warn(
        `[TribeSpawner] Tribe "${ct.name}" spawn tile [${x},${y}] is not available`,
      );
      return undefined;
    }
    return new SpawnExecution(
      this.gameID,
      new PlayerInfo(ct.name, PlayerType.Bot, null, this.random.nextID()),
      tile,
    );
  }

  private randomTribeName(): string {
    const { customTribes, prefixes, suffixes } = this.tribeNameData;

    // Use custom tribes first (random selection, no duplicates until exhausted).
    if (customTribes !== undefined) {
      const available = customTribes.filter(
        (ct) => !this.usedCustomTribes.has(ct.name),
      );
      if (available.length > 0) {
        const index = this.random.nextInt(0, available.length);
        const chosen = available[index];
        this.usedCustomTribes.add(chosen.name);
        return chosen.name;
      }
    }

    // Fall back to theme-based prefix + suffix names.
    const prefixIndex = this.random.nextInt(0, prefixes.length);
    const suffixIndex = this.random.nextInt(0, suffixes.length);
    return `${prefixes[prefixIndex]} ${suffixes[suffixIndex]}`;
  }
}
