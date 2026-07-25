import {
  Execution,
  Game,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  SpawnArea,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { RegionMap } from "../game/RegionMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { simpleHash } from "../Util";
import { PlayerExecution } from "./PlayerExecution";
import { TribeExecution } from "./TribeExecution";
import { getSpawnTiles } from "./Util";
import { conquerCountry } from "./utils/CountrySpawn";

type Spawn = { center: TileRef; tiles: TileRef[] };

export class SpawnExecution implements Execution {
  private random: PseudoRandom;
  active: boolean = true;
  private mg: Game;
  private static readonly MAX_SPAWN_TRIES = 1_000;

  constructor(
    gameID: GameID,
    private playerInfo: PlayerInfo,
    public tile?: TileRef,
  ) {
    this.random = new PseudoRandom(
      simpleHash(playerInfo.id) + simpleHash(gameID),
    );
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    this.active = false;

    let player: Player | null = null;
    if (this.mg.hasPlayer(this.playerInfo.id)) {
      player = this.mg.player(this.playerInfo.id);
    } else {
      player = this.mg.addPlayer(this.playerInfo);
    }

    // Security: a spawn intent may only place or relocate a player's starting
    // territory during the spawn phase. Once the game is underway, an
    // already-spawned player who sends a spawn intent is attempting to
    // teleport — relinquishing their territory and re-conquering it elsewhere.
    // Ignore it so the intent is a deterministic no-op on every client.
    if (!this.mg.inSpawnPhase() && player.hasSpawned()) {
      return;
    }

    // Security: If random spawn is enabled, prevent players from re-rolling their spawn location
    if (this.mg.config().isRandomSpawn() && player.hasSpawned()) {
      return;
    }

    // Country-start mode: a spawn claims an entire country instead of a
    // 4-radius blob.
    const rm = this.mg.regionMap();
    if (rm !== null && rm.hasCountries()) {
      this.countryTick(player, rm);
      return;
    }

    player.tiles().forEach((t) => player.relinquish(t));
    const spawn = this.getSpawn(
      this.mg.config().isRandomSpawn() ? undefined : this.tile,
    );

    if (!spawn) {
      console.warn(`SpawnExecution: cannot spawn ${this.playerInfo.name}`);
      return;
    }

    spawn.tiles.forEach((t) => {
      player.conquer(t);
    });

    if (!player.hasSpawned()) {
      this.mg.addExecution(new PlayerExecution(player));
      if (player.type() === PlayerType.Bot) {
        this.mg.addExecution(new TribeExecution(player));
      }
    }

    player.setSpawnTile(spawn.center);

    if (
      this.mg.config().gameConfig().gameType === GameType.Singleplayer &&
      this.playerInfo.playerType === PlayerType.Human
    ) {
      // In singleplayer, spawn ends when player selects
      // a spawn location.
      this.mg.endSpawnPhase();
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }

  /**
   * Country-start mode spawn: resolve a center tile (click or random), then
   * take the whole country it belongs to. Conflict rule: first click wins —
   * an intent targeting a tile owned by another human is a deterministic
   * no-op. Nation-owned and unowned countries are always claimable.
   * Relocation returns the player's current country to its nation first.
   */
  private countryTick(player: Player, rm: RegionMap): void {
    const center =
      this.mg.config().isRandomSpawn() || this.tile === undefined
        ? this.randomCountryCenter(player, rm)
        : this.tile;
    if (center === undefined) {
      console.warn(`SpawnExecution: cannot spawn ${this.playerInfo.name}`);
      return;
    }

    const countryId = rm.countryOfTile(center);
    if (countryId === 0) {
      // Water/impassable/unassigned tile — nothing to claim.
      return;
    }

    // Ownership is country-uniform during the spawn phase (every mutation is
    // whole-country), so a single tile check suffices.
    const owner = this.mg.owner(center);
    if (owner.isPlayer() && owner !== player) {
      if (owner.type() !== PlayerType.Nation) {
        // Held by another human: first click wins.
        return;
      }
    } else if (owner === player) {
      // Re-click inside the player's current country: nothing to change.
      return;
    }

    if (player.hasSpawned()) {
      this.returnCurrentCountry(player, rm);
    }
    conquerCountry(this.mg, player, countryId, center);

    if (
      this.mg.config().gameConfig().gameType === GameType.Singleplayer &&
      this.playerInfo.playerType === PlayerType.Human
    ) {
      // In singleplayer, spawn ends when player selects a spawn location.
      this.mg.endSpawnPhase();
    }
  }

  /**
   * Relocation: hand the player's current country back to its nation (which
   * repaints and gets fresh troops); fall back to a plain relinquish when
   * nations are disabled or the country has no nation player.
   */
  private returnCurrentCountry(player: Player, rm: RegionMap): void {
    const spawnTile = player.spawnTile();
    const oldCountryId =
      spawnTile !== undefined ? rm.countryOfTile(spawnTile) : 0;
    if (oldCountryId !== 0) {
      const nation = this.mg
        .nations()
        .find((n) => n.countryId === oldCountryId);
      if (nation !== undefined && this.mg.hasPlayer(nation.playerInfo.id)) {
        const nationPlayer = this.mg.player(nation.playerInfo.id);
        const canonical = rm.countryCanonicalTile(oldCountryId);
        if (canonical !== undefined) {
          conquerCountry(this.mg, nationPlayer, oldCountryId, canonical);
        }
      }
    }
    // Anything left (nations disabled, or tiles somehow outside the old
    // country) is relinquished.
    player.tiles().forEach((t) => player.relinquish(t));
  }

  /**
   * Random-spawn center in country mode: any ownable tile of a country not
   * held by another human (nation-owned and unowned centers are fine — the
   * claim takes the whole country). Keeps the min-distance spacing against
   * other humans' spawn tiles.
   */
  private randomCountryCenter(
    player: Player,
    rm: RegionMap,
  ): TileRef | undefined {
    const spawnArea = this.getTeamSpawnArea();
    let tries = 0;
    while (tries < SpawnExecution.MAX_SPAWN_TRIES) {
      tries++;
      const center = this.randTile(spawnArea);
      if (!this.mg.isLand(center) || this.mg.isImpassable(center)) {
        continue;
      }
      if (rm.countryOfTile(center) === 0) {
        continue;
      }
      const owner = this.mg.owner(center);
      if (
        owner.isPlayer() &&
        owner !== player &&
        owner.type() !== PlayerType.Nation
      ) {
        continue;
      }

      const isOtherHumanSpawnedNearby = this.mg
        .allPlayers()
        .filter(
          (p) => p.id() !== this.playerInfo.id && p.type() === PlayerType.Human,
        )
        .some((p) => {
          const spawnTile = p.spawnTile();
          if (spawnTile === undefined) {
            return false;
          }
          return (
            this.mg.manhattanDist(spawnTile, center) <
            this.mg.config().minDistanceBetweenPlayers()
          );
        });
      if (isOtherHumanSpawnedNearby) {
        continue;
      }

      return center;
    }
    return undefined;
  }

  private getSpawn(center?: TileRef): Spawn | undefined {
    if (center !== undefined) {
      const tiles = getSpawnTiles(this.mg, center, false);

      if (!tiles.length) {
        return;
      }

      return { center, tiles };
    }

    const spawnArea = this.getTeamSpawnArea();
    let tries = 0;

    while (tries < SpawnExecution.MAX_SPAWN_TRIES) {
      tries++;

      const center = this.randTile(spawnArea);

      if (
        !this.mg.isLand(center) ||
        this.mg.hasOwner(center) ||
        this.mg.isBorder(center)
      ) {
        continue;
      }

      const isOtherPlayerSpawnedNearby = this.mg
        .allPlayers()
        .filter((player) => player.id() !== this.playerInfo.id)
        .some((player) => {
          const spawnTile = player.spawnTile();

          if (spawnTile === undefined) {
            return false;
          }

          return (
            this.mg.manhattanDist(spawnTile, center) <
            this.mg.config().minDistanceBetweenPlayers()
          );
        });

      if (isOtherPlayerSpawnedNearby) {
        continue;
      }

      const tiles = getSpawnTiles(this.mg, center, true);
      if (!tiles) {
        // if some of the spawn tile is outside of the land, we want to find another spawn tile
        continue;
      }

      return { center, tiles };
    }

    return;
  }

  private randTile(area?: SpawnArea): TileRef {
    if (area) {
      const x = this.random.nextInt(area.x, area.x + area.width);
      const y = this.random.nextInt(area.y, area.y + area.height);
      return this.mg.ref(x, y);
    }
    const x = this.random.nextInt(0, this.mg.width());
    const y = this.random.nextInt(0, this.mg.height());
    return this.mg.ref(x, y);
  }

  private getTeamSpawnArea(): SpawnArea | undefined {
    const player = this.mg.player(this.playerInfo.id);
    const team = player.team();
    if (team === null) {
      return undefined;
    }
    return this.mg.teamSpawnArea(team);
  }
}
