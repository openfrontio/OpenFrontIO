import { getServerConfigFromServer } from "../core/configuration/ConfigLoader";
import {
  Duos,
  GameMapType,
  GameMapTypeSchema,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, TeamCountConfig } from "../core/Schemas";
import { logger } from "./Logger";

const log = logger.child({});

const config = getServerConfigFromServer();

// How many times each map should appear in the playlist.
// Note: The Partial should eventually be removed for better type safety.
const frequency: Partial<Record<GameMapType, number>> = {
  Africa: 7,
  Asia: 6,
  Australia: 4,
  Achiran: 5,
  Baikal: 5,
  "Between Two Seas": 5,
  "Black Sea": 6,
  Britannia: 5,
  "Deglaciated Antarctica": 4,
  "East Asia": 5,
  Europe: 3,
  "Europe Classic": 3,
  "Falkland Islands": 4,
  "Faroe Islands": 4,
  "Gateway to the Atlantic": 5,
  "Gulf of St. Lawrence": 4,
  Halkidiki: 4,
  Iceland: 4,
  Italia: 6,
  Japan: 6,
  Lisbon: 4,
  Manicouagan: 4,
  Mars: 3,
  Mena: 6,
  Montreal: 6,
  "New York City": 3,
  "North America": 5,
  Pangaea: 5,
  Pluto: 6,
  "South America": 5,
  "Strait of Gibraltar": 5,
  Svalmel: 8,
  World: 8,
};

interface MapWithMode {
  map: GameMapType;
  mode: GameMode;
}

const TEAM_COUNTS = [
  2,
  3,
  4,
  5,
  6,
  7,
  Duos,
  Trios,
  Quads,
] as const satisfies TeamCountConfig[];

export class MapPlaylist {
  private mapsPlaylist: MapWithMode[] = [];

  constructor(private disableTeams: boolean = false) {}

  public gameConfig(): GameConfig {
    const { map, mode } = this.getNextMap();

    const playerTeams = mode === "Team" ? this.getTeamCount() : undefined;

    // Create the default public game config (from your GameManager)
    return {
      donateGold: mode === "Team",
      donateTroops: mode === "Team",
      gameMap: map,
      maxPlayers: config.lobbyMaxPlayers(map, mode, playerTeams),
      gameType: "Public",
      gameMapSize: "Normal",
      difficulty: "Easy",
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      disableNations: mode === "Team" && playerTeams !== HumansVsNations,
      gameMode: mode,
      playerTeams,
      bots: 400,
      disabledUnits: [],
    } satisfies GameConfig;
  }

  private getTeamCount(): TeamCountConfig {
    return TEAM_COUNTS[Math.floor(Math.random() * TEAM_COUNTS.length)];
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
    GameMapTypeSchema.options.forEach((option) => {
      for (let i = 0; i < (frequency[option] ?? 0); i++) {
        maps.push(option as GameMapType);
      }
    });

    const rand = new PseudoRandom(Date.now());

    const ffa1: GameMapType[] = rand.shuffleArray([...maps]);
    const team1: GameMapType[] = rand.shuffleArray([...maps]);
    const ffa2: GameMapType[] = rand.shuffleArray([...maps]);

    this.mapsPlaylist = [];
    for (let i = 0; i < maps.length; i++) {
      if (!this.addNextMap(this.mapsPlaylist, ffa1, "Free For All")) {
        return false;
      }
      if (!this.disableTeams) {
        if (!this.addNextMap(this.mapsPlaylist, team1, "Team")) {
          return false;
        }
      }
      if (!this.addNextMap(this.mapsPlaylist, ffa2, "Free For All")) {
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
