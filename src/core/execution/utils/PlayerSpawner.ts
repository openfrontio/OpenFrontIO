import { Game } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PlayerType } from "../../game/GameUpdates";
import { PseudoRandom } from "../../PseudoRandom";
import { GameID } from "../../Schemas";
import { simpleHash } from "../../Util";
import { SpawnExecution } from "../SpawnExecution";

export class PlayerSpawner {
  private random: PseudoRandom;
  private players: SpawnExecution[] = [];
  private static readonly MAX_SPAWN_TRIES = 10_000;
  private static readonly MIN_SPAWN_DISTANCE = 30;

  constructor(
    private gm: Game,
    gameID: GameID,
  ) {
    this.random = new PseudoRandom(simpleHash(gameID));
  }

  private randTile(): TileRef {
    const x = this.random.nextInt(0, this.gm.width());
    const y = this.random.nextInt(0, this.gm.height());

    return this.gm.ref(x, y);
  }

  private randomSpawnLand(): TileRef | null {
    let tries = 0;

    while (tries < PlayerSpawner.MAX_SPAWN_TRIES) {
      tries++;

      const tile = this.randTile();

      if (
        !this.gm.isLand(tile) ||
        this.gm.hasOwner(tile) ||
        this.gm.isBorder(tile)
      ) {
        continue;
      }

      let tooCloseToOtherPlayer = false;
      for (const spawn of this.players) {
        if (
          this.gm.manhattanDist(spawn.tile, tile) <
          PlayerSpawner.MIN_SPAWN_DISTANCE
        ) {
          tooCloseToOtherPlayer = true;
          break;
        }
      }

      if (tooCloseToOtherPlayer) {
        continue;
      }

      return tile;
    }

    return null;
  }

  spawnPlayers(): SpawnExecution[] {
    for (const player of this.gm.allPlayers()) {
      if (player.type() !== PlayerType.Human) {
        continue;
      }

      const spawnLand = this.randomSpawnLand();

      if (spawnLand === null) {
        // TODO: this should normally not happen, additional logic may be needed, if this occurs
        continue;
      }

      this.players.push(new SpawnExecution(player.info(), spawnLand));
    }

    return this.players;
  }
}
