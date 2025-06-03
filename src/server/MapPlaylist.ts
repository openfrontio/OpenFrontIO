import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import { Difficulty, GameMapType, GameMode, GameType } from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig } from "../core/Schemas";
import { logger } from "./Logger";

const log = logger.child({});

const config = getServerConfigFromServer();

const frequency = {
  World: 3,
  Europe: 2,
  Africa: 2,
  Australia: 1,
  NorthAmerica: 1,
  Britannia: 1,
  GatewayToTheAtlantic: 1,
  Iceland: 1,
  SouthAmerica: 1,
  KnownWorld: 1,
  DeglaciatedAntarctica: 1,
  EuropeClassic: 1,
  Mena: 1,
  Pangaea: 1,
  Asia: 1,
  Mars: 1,
  BetweenTwoSeas: 1,
  Japan: 1,
  BlackSea: 1,
  FaroeIslands: 1,
  FalklandIslands: 1,
  Baikal: 1,
  Halkidiki: 1,
};

interface MapWithMode {
  map: GameMapType;
  mode: GameMode;
}

export class MapPlaylist {
  private mapsPlaylist: MapWithMode[] = [];

  public gameConfig(): GameConfig {
    const { map, mode } = this.getNextMap();

    const numPlayerTeams =
      mode === GameMode.Team ? 2 + Math.floor(Math.random() * 5) : undefined;

    // Create the default public game config (from your GameManager)
    return {
      gameMap: map,
      maxPlayers: config.lobbyMaxPlayers(map, mode, numPlayerTeams),
      gameType: GameType.Public,
      difficulty: Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      disableNPCs: mode === GameMode.Team,
      gameMode: mode,
      playerTeams: numPlayerTeams,
      bots: 400,
    } satisfies GameConfig;
  }

  private getNextMap(): MapWithMode {
    if (this.mapsPlaylist.length === 0) {
      const numAttempts = 10000;
      for (let i = 0; i < numAttempts; i++) {
        if (this.shuffleMapsPlaylist()) {
          log.info(`Generated map playlist in ${i} attempts`);
          return this.mapsPlaylist.shift()!;
        }
      }
      log.error("Failed to generate a valid map playlist");
    }
    // Even if it failed, playlist will be partially populated.
    return this.mapsPlaylist.shift()!;
  }

  private shuffleMapsPlaylist(): boolean {
    const maps: GameMapType[] = [];
    Object.keys(GameMapType).forEach((key) => {
      for (let i = 0; i < parseInt(frequency[key]); i++) {
        maps.push(GameMapType[key]);
      }
    });

    const rand = new PseudoRandom(Date.now());

    const ffa1: GameMapType[] = rand.shuffleArray([...maps]);
    const ffa2: GameMapType[] = rand.shuffleArray([...maps]);
    const ffa3: GameMapType[] = rand.shuffleArray([...maps]);
    const team: GameMapType[] = rand.shuffleArray([...maps]);

    this.mapsPlaylist = [];
    for (let i = 0; i < maps.length; i++) {
      if (!this.addNextMap(this.mapsPlaylist, ffa1, GameMode.FFA)) {
        return false;
      }
      if (!this.addNextMap(this.mapsPlaylist, ffa2, GameMode.FFA)) {
        return false;
      }
      if (!this.addNextMap(this.mapsPlaylist, ffa3, GameMode.FFA)) {
        return false;
      }
      if (!this.addNextMap(this.mapsPlaylist, team, GameMode.Team)) {
        return false;
      }
    }
    return true;
  }

  private addNextMap(
    playlist: MapWithMode[],
    nextEls: GameMapType[],
    mode: GameMode,
  ): boolean {
    const nonConsecutiveNum = 5;
    const lastEls = playlist
      .slice(playlist.length - nonConsecutiveNum)
      .map((m) => m.map);
    for (let i = 0; i < nextEls.length; i++) {
      const next = nextEls[i];
      if (lastEls.includes(next)) {
        continue;
      }
      nextEls.splice(i, 1);
      playlist.push({ map: next, mode: mode });
      return true;
    }
    return false;
  }
}
