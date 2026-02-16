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
  mapCategories,
} from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, PublicGameType, TeamCountConfig } from "../core/Schemas";
import { logger } from "./Logger";
import { getMapLandTiles } from "./MapLandTiles";
import { isSpecialModifiers } from "./SpecialModifiers";

const log = logger.child({});
const ARCADE_MAPS = new Set(mapCategories.arcade);

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
  Yenisei: 6,
  TradersDream: 4,
  Hawaii: 4,
};

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
const TEAM_TOTAL_WEIGHT = TEAM_WEIGHTS.reduce(
  (sum, { weight }) => sum + weight,
  0,
);

const MODIFIER_RATES = {
  normal: {
    isRandomSpawn: 0.1,
    isCompact: 0.05,
    isCrowded: 0.05,
    startingGold: 0.05,
  },
  special: {
    isRandomSpawn: 0.2,
    isCompact: 0.3,
    isCrowded: 0.2,
    startingGold: 0.2,
  },
} as const;

const GROUPED_TEAM_SIZES: Record<string, number> = {
  [Duos]: 2,
  [Trios]: 3,
  [Quads]: 4,
};

type MapPlayerCounts = [number, number, number];

export class MapPlaylist {
  private playlists: Record<PublicGameType, GameMapType[]> = {
    ffa: [],
    special: [],
    team: [],
  };
  private readonly mapPlayerCountsCache = new Map<
    GameMapType,
    MapPlayerCounts
  >();

  public async gameConfig(type: PublicGameType): Promise<GameConfig> {
    if (type === "special") return this.getSpecialConfig();

    const mode = type === "ffa" ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap(type);
    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    const rolled = this.rollModifiers("normal");
    const { modifiers, crowdedMaxPlayers } = await this.applyConstraints(
      rolled,
      map,
      mode,
      playerTeams,
    );
    const maxPlayers =
      crowdedMaxPlayers ??
      (await this.lobbyMaxPlayers(map, mode, playerTeams, modifiers.isCompact));

    return this.buildGameConfig({
      mode,
      map,
      maxPlayers,
      modifiers,
      playerTeams,
    });
  }

  private async getSpecialConfig(): Promise<GameConfig> {
    const mode = Math.random() < 0.5 ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap("special");
    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    // Keep rerolling until a special modifier survives rule constraints.
    let modifiers!: PublicGameModifiers;
    let crowdedMaxPlayers: number | undefined;
    let found = false;
    for (let i = 0; i < 10; i++) {
      const rolled = this.rollModifiers("special", true);
      ({ modifiers, crowdedMaxPlayers } = await this.applyConstraints(
        rolled,
        map,
        mode,
        playerTeams,
      ));
      if (isSpecialModifiers(modifiers)) {
        found = true;
        break;
      }
    }
    if (!found) modifiers.startingGold = 5_000_000;

    const maxPlayers = Math.max(
      2,
      crowdedMaxPlayers ??
        (await this.lobbyMaxPlayers(
          map,
          mode,
          playerTeams,
          modifiers.isCompact,
        )),
    );

    return this.buildGameConfig({
      mode,
      map,
      maxPlayers,
      modifiers,
      playerTeams,
    });
  }

  private buildGameConfig({
    mode,
    map,
    maxPlayers,
    modifiers,
    playerTeams,
  }: {
    mode: GameMode;
    map: GameMapType;
    maxPlayers: number;
    modifiers: PublicGameModifiers;
    playerTeams?: TeamCountConfig;
  }): GameConfig {
    const { isCompact, isRandomSpawn, startingGold } = modifiers;
    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers,
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: modifiers,
      startingGold,
      difficulty: Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn,
      disableNations: mode === GameMode.Team && playerTeams !== HumansVsNations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: startingGold ? 30 * 10 : 5 * 10,
      disabledUnits: [],
    } satisfies GameConfig;
  }

  public get1v1Config(): GameConfig {
    const maps = [
      GameMapType.Australia, // 40%
      GameMapType.Australia,
      GameMapType.Iceland, // 20%
      GameMapType.Asia, // 20%
      GameMapType.EuropeClassic, // 20%
    ];
    const isCompact = Math.random() < 0.5;
    return {
      donateGold: false,
      donateTroops: false,
      gameMap: maps[Math.floor(Math.random() * maps.length)],
      maxPlayers: 2,
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      difficulty: Difficulty.Medium,
      rankedType: RankedType.OneVOne,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: isCompact ? 10 : 15,
      instantBuild: false,
      randomSpawn: false,
      disableNations: true,
      gameMode: GameMode.FFA,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: 30 * 10,
      disabledUnits: [],
    } satisfies GameConfig;
  }

  // --- Modifier logic ---

  private rollModifiers(
    rateKey: keyof typeof MODIFIER_RATES,
    ensureSpecial = false,
  ): PublicGameModifiers {
    const rates = MODIFIER_RATES[rateKey];
    const roll = (): PublicGameModifiers => ({
      isRandomSpawn: Math.random() < rates.isRandomSpawn,
      isCompact: Math.random() < rates.isCompact,
      isCrowded: Math.random() < rates.isCrowded,
      startingGold: Math.random() < rates.startingGold ? 5_000_000 : undefined,
    });

    let modifiers = roll();
    while (ensureSpecial && !isSpecialModifiers(modifiers)) {
      modifiers = roll();
    }
    return modifiers;
  }

  private async applyConstraints(
    modifiers: PublicGameModifiers,
    map: GameMapType,
    mode: GameMode,
    playerTeams: TeamCountConfig | undefined,
  ): Promise<{ modifiers: PublicGameModifiers; crowdedMaxPlayers?: number }> {
    let { isCompact, isRandomSpawn, isCrowded } = modifiers;
    const { startingGold } = modifiers;

    // Duos/Trios/Quads should not get random spawn (defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      isRandomSpawn = false;
    }

    const [largest, , smallest] = await this.getMapPlayerCounts(map);

    // Small maps don't support compact in team games (not enough players after 75% reduction)
    if (mode === GameMode.Team && isCompact && smallest < 50) {
      isCompact = false;
    }

    // Crowded: only applies to small maps (largest player count <= 60)
    let crowdedMaxPlayers: number | undefined;
    if (isCrowded) {
      if (largest <= 60) {
        crowdedMaxPlayers = this.adjustForTeams(
          isCompact ? 60 : 125,
          playerTeams,
        );
      } else {
        isCrowded = false;
      }
    }

    return {
      modifiers: { isCompact, isRandomSpawn, isCrowded, startingGold },
      crowdedMaxPlayers,
    };
  }

  // --- Map selection ---

  private getNextMap(type: PublicGameType): GameMapType {
    const playlist = this.playlists[type];
    if (playlist.length === 0) {
      playlist.push(...this.generateNewPlaylist(type));
    }
    return playlist.shift()!;
  }

  private generateNewPlaylist(type: PublicGameType): GameMapType[] {
    const maps = this.buildMapsList(type);
    const rand = new PseudoRandom(Date.now());
    const shuffledSource = rand.shuffleArray([...maps]);
    const playlist: GameMapType[] = [];

    const numAttempts = 10000;
    for (let attempt = 0; attempt < numAttempts; attempt++) {
      playlist.length = 0;
      const source = [...shuffledSource];

      let success = true;
      while (source.length > 0) {
        if (!this.addNextMapNonConsecutive(playlist, source)) {
          success = false;
          break;
        }
      }

      if (success) {
        log.info(`Generated map playlist in ${attempt} attempts`);
        return playlist;
      }
    }

    log.warn(
      `Failed to generate non-consecutive playlist after ${numAttempts} attempts, falling back to shuffle`,
    );
    return rand.shuffleArray([...maps]);
  }

  private addNextMapNonConsecutive(
    playlist: GameMapType[],
    source: GameMapType[],
  ): boolean {
    const lastMaps = playlist.slice(-5);
    for (let i = 0; i < source.length; i++) {
      if (!lastMaps.includes(source[i])) {
        playlist.push(source.splice(i, 1)[0]);
        return true;
      }
    }
    return false;
  }

  private buildMapsList(type: PublicGameType): GameMapType[] {
    return (Object.keys(GameMapType) as GameMapName[]).flatMap((key) => {
      const map = GameMapType[key];
      if (type !== "special" && ARCADE_MAPS.has(map)) return [];
      return Array(frequency[key] ?? 0).fill(map) as GameMapType[];
    });
  }

  // --- Team helpers ---

  private getTeamCount(): TeamCountConfig {
    const roll = Math.random() * TEAM_TOTAL_WEIGHT;
    let cumulative = 0;
    for (const { config, weight } of TEAM_WEIGHTS) {
      cumulative += weight;
      if (roll < cumulative) return config;
    }
    return TEAM_WEIGHTS[0].config;
  }

  private adjustForTeams(
    p: number,
    teams: TeamCountConfig | undefined,
  ): number {
    if (teams === undefined) return p;
    if (teams === HumansVsNations) return Math.floor(p / 2);
    const divisor =
      typeof teams === "number" ? teams : GROUPED_TEAM_SIZES[teams];
    return p - (p % divisor);
  }

  // --- Map player counts ---

  private async lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    playerTeams: TeamCountConfig | undefined,
    isCompact?: boolean,
  ): Promise<number> {
    const [l, m, s] = await this.getMapPlayerCounts(map);
    const r = Math.random();
    const base = r < 0.3 ? l : r < 0.6 ? m : s;
    let p = Math.min(mode === GameMode.Team ? Math.ceil(base * 1.5) : base, l);
    if (isCompact) {
      p = Math.max(3, Math.floor(p * 0.25));
    }
    return this.adjustForTeams(p, playerTeams);
  }

  /**
   * Calculate player counts from land tiles.
   * 50 players per 1M land tiles, capped at 125.
   * Returns [100%, 75%, 50%], each rounded to nearest 5.
   */
  private calculateMapPlayerCounts(landTiles: number): MapPlayerCounts {
    const round5 = (n: number) => Math.round(n / 5) * 5;
    const base = Math.min(
      Math.max(round5((landTiles / 1_000_000) * 50), 5),
      125,
    );
    return [base, round5(base * 0.75), round5(base * 0.5)];
  }

  private async getMapPlayerCounts(map: GameMapType): Promise<MapPlayerCounts> {
    const cached = this.mapPlayerCountsCache.get(map);
    if (cached) return cached;

    const landTiles = await getMapLandTiles(map);
    const counts = this.calculateMapPlayerCounts(landTiles);
    this.mapPlayerCountsCache.set(map, counts);
    return counts;
  }
}
