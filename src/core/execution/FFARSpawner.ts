import { Game, PlayerInfo, PlayerType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { SpawnExecution } from "./SpawnExecution";

export class FFARSpawner {
  private random: PseudoRandom;
  private spawns: SpawnExecution[] = [];

  constructor(
    private gs: Game,
    gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  spawnFFARPlayers(humans: PlayerInfo[], numBots: number, nations: PlayerInfo[]): SpawnExecution[] {
    // Spawn human players with minimum distance of 20 tiles between them
    for (const human of humans) {
      const spawn = this.spawnHuman(human);
      if (spawn !== null) {
        this.spawns.push(spawn);
      }
    }

    // Spawn fake humans (nations) with the same logic as human players
    for (const nation of nations) {
      const spawn = this.spawnHuman(nation);
      if (spawn !== null) {
        this.spawns.push(spawn);
      }
    }

    // Spawn bots using the same logic as classic FFA mode
    let tries = 0;
    while (this.spawns.length < humans.length + nations.length + numBots) {
      if (tries > 10000) {
        console.log("too many retries while spawning bots, giving up");
        return this.spawns;
      }
      const botName = this.randomBotName();
      const spawn = this.spawnBot(botName);
      if (spawn !== null) {
        this.spawns.push(spawn);
      } else {
        tries++;
      }
    }
    return this.spawns;
  }

  private spawnHuman(human: PlayerInfo): SpawnExecution | null {
    let tries = 0;
    const maxTries = 10000;
    const minDistance = 20; // Minimum distance of 20 tiles between human players

    while (tries < maxTries) {
      const tile = this.randTile();
      if (!this.gs.isLand(tile)) {
        tries++;
        continue;
      }

      // Check distance to existing spawns
      let tooClose = false;
      for (const spawn of this.spawns) {
        if (this.gs.manhattanDist(spawn.tile, tile) < minDistance) {
          tooClose = true;
          break;
        }
      }

      if (!tooClose) {
        return new SpawnExecution(human, tile);
      }

      tries++;
    }

    console.warn(`Failed to spawn human player ${human.name} after ${maxTries} attempts`);
    return null;
  }

  private spawnBot(botName: string): SpawnExecution | null {
    const tile = this.randTile();
    if (!this.gs.isLand(tile)) {
      return null;
    }
    for (const spawn of this.spawns) {
      if (this.gs.manhattanDist(spawn.tile, tile) < 30) {
        return null;
      }
    }
    return new SpawnExecution(
      new PlayerInfo(botName, PlayerType.Bot, null, this.random.nextID()),
      tile,
    );
  }

  private randTile(): TileRef {
    const x = this.random.nextInt(0, this.gs.width() - 1);
    const y = this.random.nextInt(0, this.gs.height() - 1);
    return this.gs.ref(x, y);
  }

  private randomBotName(): string {
    const prefixes = [
      "Bot",
      "AI",
      "Computer",
      "Auto",
      "NPC",
      "Player",
      "Digital",
      "Virtual",
      "Cyber",
      "Tech",
    ];
    const suffixes = [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "0",
      "X",
      "Z",
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Omega",
      "Pro",
      "Max",
      "Ultra",
    ];

    const prefix = prefixes[this.random.nextInt(0, prefixes.length - 1)];
    const suffix = suffixes[this.random.nextInt(0, suffixes.length - 1)];
    return `${prefix}_${suffix}`;
  }
}