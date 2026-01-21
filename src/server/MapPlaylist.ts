import {
  Difficulty,
  Duos,
  GameMapName,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  PublicGameModifiers,
  Quads,
  RankedType,
  Trios,
} from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, TeamCountConfig } from "../core/Schemas";
import { logger } from "./Logger";
import { getMapLandTiles } from "./MapLandTiles";

const log = logger.child({});

// How many times each map should appear in the playlist.
// Note: The Partial should eventually be removed for better type safety.
const frequency: Partial<Record<GameMapName, number>> = {
  Africa: 7,
  Asia: 6,
  Australia: 4,
  Achiran: 5,
  Baikal: 5,
  BetweenTwoSeas: 5,
  BlackSea: 6,
  Britannia: 5,
  BritanniaClassic: 4,
  DeglaciatedAntarctica: 4,
  EastAsia: 5,
  Europe: 3,
  EuropeClassic: 3,
  FalklandIslands: 4,
  FaroeIslands: 4,
  FourIslands: 4,
  GatewayToTheAtlantic: 5,
  GulfOfStLawrence: 4,
  Halkidiki: 4,
  Iceland: 4,
  Italia: 6,
  Japan: 6,
  Lisbon: 4,
  Manicouagan: 4,
  Mars: 3,
  Mena: 6,
  Montreal: 6,
  NewYorkCity: 3,
  NorthAmerica: 5,
  Pangaea: 5,
  Pluto: 6,
  SouthAmerica: 5,
  StraitOfGibraltar: 5,
  Svalmel: 8,
  World: 8,
  Lemnos: 3,
  TwoLakes: 6,
  StraitOfHormuz: 4,
  Surrounded: 4,
  DidierFrance: 1,
  AmazonRiver: 3,
  Sierpinski: 10,
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
  HumansVsNations,
] as const satisfies TeamCountConfig[];

export class MapPlaylist {
  private mapsPlaylist: MapWithMode[] = [];

  constructor(private disableTeams: boolean = false) {}

  public async gameConfig(): Promise<GameConfig> {
    const { map, mode } = this.getNextMap();

    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    const modifiers = this.getRandomPublicGameModifiers();
    const { startingGold } = modifiers;
    let { isCompact, isRandomSpawn, isCrowded } = modifiers;

    // Duos, Trios, and Quads should not get random spawn (as it defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      isRandomSpawn = false;
    }

    // Maps with smallest player count (third number of calculateMapPlayerCounts) < 50 don't support compact map in team games
    // (not enough players after 75% player reduction for compact maps)
    if (
      mode === GameMode.Team &&
      !(await this.supportsCompactMapForTeams(map))
    ) {
      isCompact = false;
    }

    // Crowded modifier: if the map's biggest player count (first number of calculateMapPlayerCounts) is 60 or lower (small maps),
    // set player count to 125 (or 60 if compact map is also enabled)
    let crowdedMaxPlayers: number | undefined;
    if (isCrowded) {
      crowdedMaxPlayers = await this.getCrowdedMaxPlayers(map, isCompact);
      if (crowdedMaxPlayers === undefined) {
        isCrowded = false;
      } else {
        crowdedMaxPlayers = this.adjustForTeams(crowdedMaxPlayers, playerTeams);
      }
    }

    // Create the default public game config (from your GameManager)
    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers:
        crowdedMaxPlayers ??
        (await this.lobbyMaxPlayers(map, mode, playerTeams, isCompact)),
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: {
        isCompact,
        isRandomSpawn,
        isCrowded,
        startingGold,
      },
      startingGold,
      difficulty:
        playerTeams === HumansVsNations ? Difficulty.Hard : Difficulty.Easy,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn,
      disableNations: mode === GameMode.Team && playerTeams !== HumansVsNations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: 5 * 10,
      disabledUnits: [],
    } satisfies GameConfig;
  }

  public get1v1Config(): GameConfig {
    const maps = [
      GameMapType.Iceland,
      GameMapType.Australia,
      GameMapType.Australia,
      GameMapType.Australia,
      GameMapType.Pangaea,
      GameMapType.Italia,
      GameMapType.FalklandIslands,
      GameMapType.Sierpinski,
    ];
    return {
      donateGold: false,
      donateTroops: false,
      gameMap: maps[Math.floor(Math.random() * maps.length)],
      maxPlayers: 2,
      gameType: GameType.Public,
      gameMapSize: GameMapSize.Compact,
      difficulty: Difficulty.Easy,
      rankedType: RankedType.OneVOne,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: 10, // 10 minutes
      instantBuild: false,
      randomSpawn: false,
      disableNations: true,
      gameMode: GameMode.FFA,
      bots: 100,
      spawnImmunityDuration: 5 * 10,
      disabledUnits: [],
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

  private getTeamCount(): TeamCountConfig {
    return TEAM_COUNTS[Math.floor(Math.random() * TEAM_COUNTS.length)];
  }

  private getRandomPublicGameModifiers(): PublicGameModifiers {
    return {
      isRandomSpawn: Math.random() < 0.1, // 10% chance
      isCompact: Math.random() < 0.05, // 5% chance
      isCrowded: Math.random() < 0.05, // 5% chance
      startingGold: Math.random() < 0.05 ? 5_000_000 : undefined, // 5% chance
    };
  }

  // Maps with smallest player count (third number of calculateMapPlayerCounts) < 50 don't support compact map in team games
  // (not enough players after 75% player reduction for compact maps)
  private async supportsCompactMapForTeams(map: GameMapType): Promise<boolean> {
    const landTiles = await getMapLandTiles(map);
    const [, , smallest] = this.calculateMapPlayerCounts(landTiles);
    return smallest >= 50;
  }

  private async getCrowdedMaxPlayers(
    map: GameMapType,
    isCompact: boolean,
  ): Promise<number | undefined> {
    const landTiles = await getMapLandTiles(map);
    const [firstPlayerCount] = this.calculateMapPlayerCounts(landTiles);
    if (firstPlayerCount <= 60) {
      return isCompact ? 60 : 125;
    }
    return undefined;
  }

  private async lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    numPlayerTeams: TeamCountConfig | undefined,
    isCompactMap?: boolean,
  ): Promise<number> {
    const landTiles = await getMapLandTiles(map);
    const [l, m, s] = this.calculateMapPlayerCounts(landTiles);
    const r = Math.random();
    const base = r < 0.3 ? l : r < 0.6 ? m : s;
    let p = Math.min(mode === GameMode.Team ? Math.ceil(base * 1.5) : base, l);
    // Apply compact map 75% player reduction
    if (isCompactMap) {
      p = Math.max(3, Math.floor(p * 0.25));
    }
    return this.adjustForTeams(p, numPlayerTeams);
  }

  private adjustForTeams(
    playerCount: number,
    numPlayerTeams: TeamCountConfig | undefined,
  ): number {
    if (numPlayerTeams === undefined) return playerCount;
    let p = playerCount;
    switch (numPlayerTeams) {
      case Duos:
        p -= p % 2;
        break;
      case Trios:
        p -= p % 3;
        break;
      case Quads:
        p -= p % 4;
        break;
      case HumansVsNations:
        // Half the slots are for humans, the other half will get filled with nations
        p = Math.floor(p / 2);
        break;
      default:
        p -= p % numPlayerTeams;
        break;
    }
    return p;
  }

  /**
   * Calculate player counts from land tiles
   * For every 1,000,000 land tiles, take 50 players
   * Limit to max 125 players for performance
   * Second value is 75% of calculated value, third is 50%
   * All values are rounded to the nearest 5
   */
  private calculateMapPlayerCounts(
    landTiles: number,
  ): [number, number, number] {
    const roundToNearest5 = (n: number) => Math.round(n / 5) * 5;

    const base = roundToNearest5((landTiles / 1_000_000) * 50);
    const limitedBase = Math.min(Math.max(base, 5), 125);
    return [
      limitedBase,
      roundToNearest5(limitedBase * 0.75),
      roundToNearest5(limitedBase * 0.5),
    ];
  }

  private shuffleMapsPlaylist(): boolean {
    const maps: GameMapType[] = [];
    (Object.keys(GameMapType) as GameMapName[]).forEach((key) => {
      for (let i = 0; i < (frequency[key] ?? 0); i++) {
        maps.push(GameMapType[key]);
      }
    });

    const rand = new PseudoRandom(Date.now());

    const ffa1: GameMapType[] = rand.shuffleArray([...maps]);
    const team1: GameMapType[] = rand.shuffleArray([...maps]);
    const ffa2: GameMapType[] = rand.shuffleArray([...maps]);

    this.mapsPlaylist = [];
    for (let i = 0; i < maps.length; i++) {
      if (!this.addNextMap(this.mapsPlaylist, ffa1, GameMode.FFA)) {
        return false;
      }
      if (!this.disableTeams) {
        if (!this.addNextMap(this.mapsPlaylist, team1, GameMode.Team)) {
          return false;
        }
      }
      if (!this.addNextMap(this.mapsPlaylist, ffa2, GameMode.FFA)) {
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
