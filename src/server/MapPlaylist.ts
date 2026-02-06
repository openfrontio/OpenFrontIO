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
  Didier: 1,
  AmazonRiver: 3,
  Sierpinski: 10,
  TheBox: 3,
};

interface MapWithMode {
  map: GameMapType;
  mode: GameMode;
}

const TEAM_WEIGHTS: { config: TeamCountConfig; weight: number }[] = [
  { config: 2, weight: 10 },
  { config: 3, weight: 10 },
  { config: 4, weight: 10 },
  { config: 5, weight: 10 },
  { config: 6, weight: 10 },
  { config: 7, weight: 10 },
  { config: Duos, weight: 5 },
  { config: Trios, weight: 7.5 },
  { config: Quads, weight: 7.5 },
  { config: HumansVsNations, weight: 20 },
];

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
        playerTeams === HumansVsNations ? Difficulty.Medium : Difficulty.Easy,
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
      spawnImmunityDuration: 30 * 10,
      disabledUnits: [],
    } satisfies GameConfig;
  }

  private getNextMap(): MapWithMode {
    if (this.mapsPlaylist.length === 0) {
      this.generatePlaylist();
    }
    // Even if it failed to perfect shuffle, playlist will be populated.
    return this.mapsPlaylist.shift()!;
  }

  private getTeamCount(): TeamCountConfig {
    const totalWeight = TEAM_WEIGHTS.reduce((sum, w) => sum + w.weight, 0);
    const roll = Math.random() * totalWeight;

    let cumulativeWeight = 0;
    for (const { config, weight } of TEAM_WEIGHTS) {
      cumulativeWeight += weight;
      if (roll < cumulativeWeight) {
        return config;
      }
    }
    return TEAM_WEIGHTS[0].config;
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

  private generatePlaylist() {
    log.info("Generating new map playlist");
    const maps: GameMapType[] = [];
    (Object.keys(GameMapType) as GameMapName[]).forEach((key) => {
      for (let i = 0; i < (frequency[key] ?? 0); i++) {
        maps.push(GameMapType[key]);
      }
    });

    const rand = new PseudoRandom(Date.now());

    // Create pools for each slot type
    const pools = [
      { mode: GameMode.FFA, maps: rand.shuffleArray([...maps]) },
      { mode: GameMode.Team, maps: rand.shuffleArray([...maps]) },
      { mode: GameMode.FFA, maps: rand.shuffleArray([...maps]) },
      { mode: GameMode.Team, maps: rand.shuffleArray([...maps]) },
      { mode: GameMode.FFA, maps: rand.shuffleArray([...maps]) },
    ];

    this.mapsPlaylist = [];

    // All pools have same length (maps.length)
    const totalRounds = maps.length;

    for (let i = 0; i < totalRounds; i++) {
      for (const pool of pools) {
        if (this.disableTeams && pool.mode === GameMode.Team) {
          continue;
        }
        this.addNextMapBestEffort(this.mapsPlaylist, pool.maps, pool.mode);
      }
    }
  }

  private addNextMapBestEffort(
    playlist: MapWithMode[],
    availableMaps: GameMapType[],
    mode: GameMode,
  ) {
    // Try to find a map that hasn't been played in the last N turns.
    // We start with strict constraint (5) and relax it if we can't find a match.
    const maxLookback = 5;

    let chosenIndex = -1;

    for (let lookback = maxLookback; lookback >= 0; lookback--) {
      // Get the maps to avoid
      const avoidMaps = new Set(
        playlist
          .slice(Math.max(0, playlist.length - lookback))
          .map((m) => m.map),
      );

      // Find first map in avail that is NOT in avoidMaps
      chosenIndex = availableMaps.findIndex((m) => !avoidMaps.has(m));

      if (chosenIndex !== -1) {
        break;
      }
    }

    // If still -1 (should essentially never happen if lookback goes to 0,
    // unless availableMaps is empty which shouldn't happen by logic),
    // default to 0.
    if (chosenIndex === -1 && availableMaps.length > 0) {
      chosenIndex = 0;
    }

    if (chosenIndex !== -1) {
      const map = availableMaps.splice(chosenIndex, 1)[0];
      playlist.push({ map, mode });
    } else {
      log.error("Failed to find map in pool during generation (pool empty?)");
    }
  }
}
