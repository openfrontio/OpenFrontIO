import { SAM_CONSTRUCTION_TICKS } from "../core/configuration/DefaultConfig";
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
  UnitType,
  mapCategories,
} from "../core/game/Game";
import { PseudoRandom } from "../core/PseudoRandom";
import { GameConfig, PublicGameType, TeamCountConfig } from "../core/Schemas";
import { logger } from "./Logger";
import { getMapLandTiles } from "./MapLandTiles";

const log = logger.child({});
const ARCADE_MAPS = new Set(mapCategories.arcade);

// Hard cap on player count for performance. Applied after compact-map reduction.
const MAX_PLAYER_COUNT = 125;

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
  World: 20,
  Lemnos: 3,
  Passage: 4,
  TwoLakes: 6,
  StraitOfHormuz: 4,
  Surrounded: 4,
  DidierFrance: 1,
  Didier: 1,
  AmazonRiver: 3,
  BosphorusStraits: 3,
  BeringStrait: 4,
  Sierpinski: 10,
  TheBox: 3,
  Yenisei: 6,
  TradersDream: 4,
  Hawaii: 4,
  Alps: 4,
  NileDelta: 4,
  Arctic: 6,
  SanFrancisco: 3,
  Aegean: 6,
  MilkyWay: 8,
  Mediterranean: 6,
  Dyslexdria: 8,
  GreatLakes: 6,
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

type ModifierKey =
  | "isRandomSpawn"
  | "isCompact"
  | "isCrowded"
  | "isHardNations"
  | "startingGold1M"
  | "startingGold5M"
  | "startingGold25M"
  | "goldMultiplier"
  | "isAlliancesDisabled"
  | "isPortsDisabled"
  | "isNukesDisabled"
  | "isSAMsDisabled"
  | "isPeaceTime";

// Each entry represents one "ticket" in the pool. More tickets = higher chance of selection.
const SPECIAL_MODIFIER_POOL: ModifierKey[] = [
  ...Array<ModifierKey>(2).fill("isRandomSpawn"),
  ...Array<ModifierKey>(5).fill("isCompact"),
  ...Array<ModifierKey>(2).fill("isCrowded"),
  ...Array<ModifierKey>(1).fill("isHardNations"),
  ...Array<ModifierKey>(3).fill("startingGold1M"),
  ...Array<ModifierKey>(5).fill("startingGold5M"),
  ...Array<ModifierKey>(1).fill("startingGold25M"),
  ...Array<ModifierKey>(4).fill("goldMultiplier"),
  ...Array<ModifierKey>(1).fill("isAlliancesDisabled"),
  ...Array<ModifierKey>(1).fill("isPortsDisabled"),
  ...Array<ModifierKey>(1).fill("isNukesDisabled"),
  ...Array<ModifierKey>(1).fill("isSAMsDisabled"),
  ...Array<ModifierKey>(1).fill("isPeaceTime"),
];

// Modifiers that cannot be active at the same time.
const MUTUALLY_EXCLUSIVE_MODIFIERS: [ModifierKey, ModifierKey][] = [
  ["startingGold5M", "startingGold25M"],
  ["startingGold5M", "startingGold1M"],
  ["startingGold25M", "startingGold1M"],
  ["isHardNations", "startingGold25M"],
  ["isNukesDisabled", "isSAMsDisabled"],
];

export class MapPlaylist {
  private playlists: Record<PublicGameType, GameMapType[]> = {
    ffa: [],
    special: [],
    team: [],
  };

  public async gameConfig(type: PublicGameType): Promise<GameConfig> {
    if (type === "special") {
      return this.getSpecialConfig();
    }

    const mode = type === "ffa" ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap(type);

    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount(map) : undefined;

    let isCompact: boolean | undefined =
      this.playlists[type].length % 3 === 0 || undefined;
    if (
      isCompact &&
      mode === GameMode.Team &&
      !(await this.supportsCompactMapForTeams(map, playerTeams!))
    ) {
      isCompact = undefined;
    }

    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers: await this.lobbyMaxPlayers(map, mode, playerTeams, isCompact),
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: {
        isCompact,
      },
      difficulty:
        playerTeams === HumansVsNations ? Difficulty.Hard : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: false,
      nations:
        mode === GameMode.Team && playerTeams !== HumansVsNations
          ? "disabled"
          : "default",
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(playerTeams),
      disabledUnits: [],
    } satisfies GameConfig;
  }

  private async getSpecialConfig(): Promise<GameConfig> {
    const mode = Math.random() < 0.5 ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap("special");
    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount(map) : undefined;

    const excludedModifiers: ModifierKey[] = [];

    // Check if compact map would leave every team with at least 2 players
    const supportsCompact =
      mode !== GameMode.Team ||
      (await this.supportsCompactMapForTeams(map, playerTeams!));
    if (!supportsCompact) {
      excludedModifiers.push("isCompact");
    }

    // Duos, Trios, and Quads should not get random spawn (as it defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      excludedModifiers.push("isRandomSpawn");
    }

    // No extreme modifiers on FourIslands - Causes 3h long stalemates
    if (map === GameMapType.FourIslands) {
      excludedModifiers.push("goldMultiplier");
      excludedModifiers.push("startingGold25M");
    }

    // Hard nations modifier only applies when nations are present (not HvN, which is always hard)
    if (mode === GameMode.Team) {
      excludedModifiers.push("isHardNations");
    }
    if (playerTeams === HumansVsNations) {
      excludedModifiers.push("startingGold25M"); // Nations are disabled if that modifier is active (Because of PVP immunity)
      excludedModifiers.push("isPeaceTime"); // Nations don't have PVP immunity
    }

    const poolResult = this.getRandomSpecialGameModifiers(excludedModifiers);
    let {
      isCrowded,
      startingGold,
      isCompact,
      isRandomSpawn,
      goldMultiplier,
      isAlliancesDisabled,
      isHardNations,
      isPortsDisabled,
      isNukesDisabled,
      isSAMsDisabled,
      isPeaceTime,
    } = poolResult;

    // Crowded modifier: if the map's biggest player count (first number of calculateMapPlayerCounts) is 60 or lower (small maps),
    // set player count to MAX_PLAYER_COUNT (or 60 if compact map is also enabled)
    let crowdedMaxPlayers: number | undefined;
    if (isCrowded) {
      crowdedMaxPlayers = await this.getCrowdedMaxPlayers(map, !!isCompact);
      if (crowdedMaxPlayers !== undefined) {
        crowdedMaxPlayers = this.adjustForTeams(crowdedMaxPlayers, playerTeams);
      } else {
        // Map doesn't support crowded. Drop it and pick one replacement only
        // if it was the sole modifier, so the lobby always has at least one.
        isCrowded = undefined;
        if (
          !isRandomSpawn &&
          !isCompact &&
          !isHardNations &&
          startingGold === undefined &&
          goldMultiplier === undefined &&
          !isAlliancesDisabled &&
          !isPortsDisabled &&
          !isNukesDisabled &&
          !isSAMsDisabled &&
          !isPeaceTime
        ) {
          excludedModifiers.push("isCrowded");
          const fallback = this.getRandomSpecialGameModifiers(
            excludedModifiers,
            1,
          );
          ({
            isRandomSpawn,
            isCompact,
            startingGold,
            goldMultiplier,
            isAlliancesDisabled,
            isPortsDisabled,
            isNukesDisabled,
            isSAMsDisabled,
            isPeaceTime,
          } = fallback);
          ({ isHardNations } = fallback);
        }
      }
    }

    const maxPlayers = Math.max(
      2,
      crowdedMaxPlayers ??
        (await this.lobbyMaxPlayers(map, mode, playerTeams, isCompact)),
    );

    const nations: GameConfig["nations"] =
      (mode === GameMode.Team && playerTeams !== HumansVsNations) ||
      // Nations don't have PVP immunity, so 25M starting gold wouldn't work well with them
      (startingGold !== undefined && startingGold >= 25_000_000)
        ? "disabled"
        : "default";

    // Build disabledUnits from modifiers
    const disabledUnits: UnitType[] = [];
    if (isPortsDisabled) {
      disabledUnits.push(UnitType.Port);
    }
    if (isNukesDisabled) {
      disabledUnits.push(
        UnitType.MissileSilo,
        UnitType.AtomBomb,
        UnitType.HydrogenBomb,
        UnitType.MIRV,
        UnitType.SAMLauncher,
      );
    }
    if (isSAMsDisabled) {
      disabledUnits.push(UnitType.SAMLauncher);
    }

    // 4min peace = 240s = 2400 ticks
    const peaceTimeDuration = isPeaceTime ? 240 * 10 : undefined;

    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers,
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: {
        isCompact,
        isRandomSpawn,
        isCrowded,
        isHardNations,
        startingGold,
        goldMultiplier,
        isAlliancesDisabled,
        isPortsDisabled,
        isNukesDisabled,
        isSAMsDisabled,
        isPeaceTime,
      },
      startingGold,
      goldMultiplier,
      disableAlliances: isAlliancesDisabled ? true : undefined,
      difficulty:
        isHardNations || playerTeams === HumansVsNations
          ? Difficulty.Hard
          : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn ? true : false,
      nations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration:
        peaceTimeDuration ??
        this.getSpawnImmunityDuration(playerTeams, startingGold),
      disabledUnits,
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
      difficulty: Difficulty.Medium, // Doesn't matter, nations are disabled
      rankedType: RankedType.OneVOne,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: isCompact ? 10 : 15,
      instantBuild: false,
      randomSpawn: false,
      nations: "disabled",
      gameMode: GameMode.FFA,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: 30 * 10,
      disabledUnits: [],
    } satisfies GameConfig;
  }

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
    const playlist: GameMapType[] = [];

    const numAttempts = 10000;
    for (let attempt = 0; attempt < numAttempts; attempt++) {
      playlist.length = 0;
      // Re-shuffle every attempt so retries can explore different orderings.
      const source = rand.shuffleArray([...maps]);

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
    const nonConsecutiveNum = 5;
    const lastMaps = playlist.slice(-nonConsecutiveNum);

    for (let i = 0; i < source.length; i++) {
      const map = source[i];
      if (!lastMaps.includes(map)) {
        source.splice(i, 1);
        playlist.push(map);
        return true;
      }
    }
    return false;
  }

  private buildMapsList(type: PublicGameType): GameMapType[] {
    const maps: GameMapType[] = [];
    (Object.keys(GameMapType) as GameMapName[]).forEach((key) => {
      const map = GameMapType[key];
      if (type !== "special" && ARCADE_MAPS.has(map)) {
        return;
      }
      let freq = frequency[key] ?? 0;
      // Double frequency for Baikal and FourIslands in team games
      if (type === "team" && (key === "Baikal" || key === "FourIslands")) {
        freq *= 2;
      }
      for (let i = 0; i < freq; i++) {
        maps.push(map);
      }
    });
    return maps;
  }

  private getTeamCount(map: GameMapType): TeamCountConfig {
    // Override team count for specific maps (75% chance)
    if (map === GameMapType.Baikal && Math.random() < 0.75) {
      return 2;
    }
    if (map === GameMapType.FourIslands && Math.random() < 0.75) {
      return 4;
    }

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

  private getRandomSpecialGameModifiers(
    excludedModifiers: ModifierKey[] = [],
    count?: number,
    countReduction: number = 0,
  ): PublicGameModifiers {
    // Roll how many modifiers to pick: 30% → 1, 50% → 2, 20% → 3
    const modifierCounts = [1, 1, 1, 2, 2, 2, 2, 2, 3, 3];
    const rolled =
      modifierCounts[Math.floor(Math.random() * modifierCounts.length)];
    const k = Math.max(0, (count ?? rolled) - countReduction);

    // Shuffle the pool, then pick the first k unique modifier keys.
    const pool = SPECIAL_MODIFIER_POOL.filter(
      (key) => !excludedModifiers.includes(key),
    ).sort(() => Math.random() - 0.5);

    const selected = new Set<ModifierKey>();
    for (const key of pool) {
      if (selected.size >= k) break;
      // Skip if a mutually exclusive modifier is already selected
      const blocked = MUTUALLY_EXCLUSIVE_MODIFIERS.some(
        ([a, b]) =>
          (key === a && selected.has(b)) || (key === b && selected.has(a)),
      );
      if (!blocked) selected.add(key);
    }

    return {
      isRandomSpawn: selected.has("isRandomSpawn") || undefined,
      isCompact: selected.has("isCompact") || undefined,
      isCrowded: selected.has("isCrowded") || undefined,
      isHardNations: selected.has("isHardNations") || undefined,
      startingGold: selected.has("startingGold25M")
        ? 25_000_000
        : selected.has("startingGold5M")
          ? 5_000_000
          : selected.has("startingGold1M")
            ? 1_000_000
            : undefined,
      goldMultiplier: selected.has("goldMultiplier") ? 2 : undefined,
      isAlliancesDisabled: selected.has("isAlliancesDisabled") || undefined,
      isPortsDisabled: selected.has("isPortsDisabled") || undefined,
      isNukesDisabled: selected.has("isNukesDisabled") || undefined,
      isSAMsDisabled: selected.has("isSAMsDisabled") || undefined,
      isPeaceTime: selected.has("isPeaceTime") || undefined,
    };
  }

  // Check whether a compact map still gives every team at least 2 players,
  // using the worst-case player tier (smallest) from lobbyMaxPlayers.
  private async supportsCompactMapForTeams(
    map: GameMapType,
    playerTeams: TeamCountConfig,
  ): Promise<boolean> {
    const landTiles = await getMapLandTiles(map);
    const [l, , s] = this.calculateMapPlayerCounts(landTiles);
    // Worst case: smallest tier with team mode 1.5x multiplier, capped at l
    let p = Math.min(Math.ceil(s * 1.5), l);
    // Apply compact 75% player reduction, then cap for performance
    p = Math.min(Math.max(3, Math.floor(p * 0.25)), MAX_PLAYER_COUNT);
    // Apply team adjustment
    p = this.adjustForTeams(p, playerTeams);
    // Check at least 2 players per team AND at least 2 teams
    return (
      this.playersPerTeam(p, playerTeams) >= 2 &&
      this.numberOfTeams(p, playerTeams) >= 2
    );
  }

  private playersPerTeam(
    adjustedPlayerCount: number,
    playerTeams: TeamCountConfig,
  ): number {
    switch (playerTeams) {
      case Duos:
        return Math.min(2, adjustedPlayerCount);
      case Trios:
        return Math.min(3, adjustedPlayerCount);
      case Quads:
        return Math.min(4, adjustedPlayerCount);
      case HumansVsNations:
        return adjustedPlayerCount; // adjustedPlayerCount is the human count
      default:
        return Math.floor(adjustedPlayerCount / playerTeams);
    }
  }

  private numberOfTeams(
    adjustedPlayerCount: number,
    playerTeams: TeamCountConfig,
  ): number {
    switch (playerTeams) {
      case Duos:
        return Math.floor(adjustedPlayerCount / 2);
      case Trios:
        return Math.floor(adjustedPlayerCount / 3);
      case Quads:
        return Math.floor(adjustedPlayerCount / 4);
      case HumansVsNations:
        return 2; // always 2 teams
      default:
        return playerTeams; // numeric value IS the team count
    }
  }

  /**
   * Centralised spawn-immunity duration logic.
   * - HumansVsNations: always 5s (nations can't benefit from longer PVP immunity)
   * - 25M starting gold: 2:30min (extra time to compensate for high gold)
   * - 5M starting gold: SAM build time + 15s (enough to build a SAM)
   * - Default: 5s
   */
  private getSpawnImmunityDuration(
    playerTeams?: TeamCountConfig,
    startingGold?: number,
  ): number {
    if (playerTeams === HumansVsNations) return 5 * 10;
    if (startingGold !== undefined && startingGold >= 25_000_000)
      return 150 * 10;
    if (startingGold) return SAM_CONSTRUCTION_TICKS + 15 * 10;
    return 5 * 10;
  }

  private async getCrowdedMaxPlayers(
    map: GameMapType,
    isCompact: boolean,
  ): Promise<number | undefined> {
    const landTiles = await getMapLandTiles(map);
    const [rawFirstPlayerCount] = this.calculateMapPlayerCounts(landTiles);
    const firstPlayerCount = Math.min(rawFirstPlayerCount, MAX_PLAYER_COUNT);
    if (firstPlayerCount <= 60) {
      return isCompact ? 60 : MAX_PLAYER_COUNT;
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
    // Cap for performance
    p = Math.min(p, MAX_PLAYER_COUNT);
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
   * Second value is 75% of calculated value, third is 50%
   * All values are rounded to the nearest 5
   */
  private calculateMapPlayerCounts(
    landTiles: number,
  ): [number, number, number] {
    const roundToNearest5 = (n: number) => Math.round(n / 5) * 5;

    const base = Math.max(roundToNearest5((landTiles / 1_000_000) * 50), 5);
    return [base, roundToNearest5(base * 0.75), roundToNearest5(base * 0.5)];
  }
}
