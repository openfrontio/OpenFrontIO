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
  BosphorusStraits: 3,
  BeringStrait: 4,
  Sierpinski: 10,
  TheBox: 3,
  Yenisei: 6,
  TradersDream: 4,
  Hawaii: 4,
  Alps: 4,
  NileDelta: 4,
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
  | "startingGold"
  | "startingGoldHigh";

// Each entry represents one "ticket" in the pool. More tickets = higher chance of selection.
const SPECIAL_MODIFIER_POOL: ModifierKey[] = [
  ...Array<ModifierKey>(4).fill("isRandomSpawn"),
  ...Array<ModifierKey>(8).fill("isCompact"),
  ...Array<ModifierKey>(1).fill("isCrowded"),
  ...Array<ModifierKey>(1).fill("isHardNations"),
  ...Array<ModifierKey>(8).fill("startingGold"),
  ...Array<ModifierKey>(1).fill("startingGoldHigh"),
];

// Modifiers that cannot be active at the same time.
const MUTUALLY_EXCLUSIVE_MODIFIERS: [ModifierKey, ModifierKey][] = [
  ["startingGold", "startingGoldHigh"],
  ["isHardNations", "startingGoldHigh"],
];

// Probability of hard nations modifier in HumansVsNations games.
const HARD_NATIONS_HVN_PROBABILITY = 0.2; // 20%

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
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    const modifiers = this.getRandomPublicGameModifiers(playerTeams);
    const { startingGold } = modifiers;
    let { isCompact, isRandomSpawn, isCrowded, isHardNations } = modifiers;

    // Duos, Trios, and Quads should not get random spawn (as it defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      isRandomSpawn = false;
    }

    // Hard nations modifier only applies when nations are present
    if (mode === GameMode.Team && playerTeams !== HumansVsNations) {
      isHardNations = false;
    }

    // Check if compact map would leave every team with at least 2 players
    if (
      isCompact &&
      mode === GameMode.Team &&
      !(await this.supportsCompactMapForTeams(map, playerTeams!))
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
        isHardNations,
        startingGold,
      },
      startingGold,
      difficulty: isHardNations ? Difficulty.Hard : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn,
      disableNations: mode === GameMode.Team && playerTeams !== HumansVsNations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(
        playerTeams,
        startingGold,
      ),
      disabledUnits: [],
    } satisfies GameConfig;
  }

  private async getSpecialConfig(): Promise<GameConfig> {
    const mode = Math.random() < 0.5 ? GameMode.FFA : GameMode.Team;
    const map = this.getNextMap("special");
    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    const excludedModifiers: ModifierKey[] = [];

    const supportsCompact =
      mode !== GameMode.Team ||
      (await this.supportsCompactMapForTeams(map, playerTeams!));
    if (!supportsCompact) {
      excludedModifiers.push("isCompact");
    }

    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      excludedModifiers.push("isRandomSpawn");
    }

    // Hard nations: excluded for non-HvN team modes (no nations present).
    // For HumansVsNations: rolled independently (not via pool).
    // For FFA: stays in the pool for normal ticket-based selection.
    let hardNationsFromIndependentRoll: boolean | undefined;
    let poolCountReduction = 0;
    if (mode === GameMode.Team && playerTeams !== HumansVsNations) {
      excludedModifiers.push("isHardNations");
    } else if (playerTeams === HumansVsNations) {
      excludedModifiers.push("isHardNations");
      excludedModifiers.push("startingGoldHigh"); // Nations are disabled if that modifier is active
      hardNationsFromIndependentRoll =
        Math.random() < HARD_NATIONS_HVN_PROBABILITY;
      poolCountReduction = hardNationsFromIndependentRoll ? 1 : 0;
    }

    const poolResult = this.getRandomSpecialGameModifiers(
      excludedModifiers,
      undefined,
      poolCountReduction,
    );
    let { isCrowded, startingGold, isCompact, isRandomSpawn } = poolResult;
    let isHardNations =
      hardNationsFromIndependentRoll ?? poolResult.isHardNations;

    let crowdedMaxPlayers: number | undefined;
    if (isCrowded) {
      crowdedMaxPlayers = await this.getCrowdedMaxPlayers(map, isCompact);
      if (crowdedMaxPlayers !== undefined) {
        crowdedMaxPlayers = this.adjustForTeams(crowdedMaxPlayers, playerTeams);
      } else {
        // Map doesn't support crowded. Drop it and pick one replacement only
        // if it was the sole modifier, so the lobby always has at least one.
        isCrowded = false;
        if (
          !isRandomSpawn &&
          !isCompact &&
          !isHardNations &&
          startingGold === undefined
        ) {
          excludedModifiers.push("isCrowded");
          const fallback = this.getRandomSpecialGameModifiers(
            excludedModifiers,
            1,
            poolCountReduction,
          );
          ({ isRandomSpawn, isCompact, startingGold } = fallback);
          isHardNations =
            hardNationsFromIndependentRoll ?? fallback.isHardNations;
        }
      }
    }

    const maxPlayers = Math.max(
      2,
      crowdedMaxPlayers ??
        (await this.lobbyMaxPlayers(map, mode, playerTeams, isCompact)),
    );

    const disableNations =
      (mode === GameMode.Team && playerTeams !== HumansVsNations) ||
      // Nations don't have PVP immunity, so 25M starting gold wouldn't work well with them
      (startingGold !== undefined && startingGold >= 25_000_000);

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
      },
      startingGold,
      difficulty: isHardNations ? Difficulty.Hard : Difficulty.Medium,
      infiniteGold: false,
      infiniteTroops: false,
      maxTimerValue: undefined,
      instantBuild: false,
      randomSpawn: isRandomSpawn,
      disableNations,
      gameMode: mode,
      playerTeams,
      bots: isCompact ? 100 : 400,
      spawnImmunityDuration: this.getSpawnImmunityDuration(
        playerTeams,
        startingGold,
      ),
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
      difficulty: Difficulty.Medium, // Doesn't matter, nations are disabled
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
      for (let i = 0; i < (frequency[key] ?? 0); i++) {
        maps.push(map);
      }
    });
    return maps;
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

  private getRandomPublicGameModifiers(
    playerTeams?: TeamCountConfig,
  ): PublicGameModifiers {
    return {
      isRandomSpawn: Math.random() < 0.05, // 5% chance
      isCompact: Math.random() < 0.05, // 5% chance
      isCrowded: Math.random() < 0.05, // 5% chance
      startingGold: Math.random() < 0.05 ? 5_000_000 : undefined, // 5% chance
      isHardNations:
        playerTeams === HumansVsNations
          ? Math.random() < HARD_NATIONS_HVN_PROBABILITY
          : Math.random() < 0.025, // 2.5% chance
    };
  }

  private getRandomSpecialGameModifiers(
    excludedModifiers: ModifierKey[] = [],
    count?: number,
    countReduction: number = 0,
  ): PublicGameModifiers {
    // Roll how many modifiers to pick: 30% → 1, 40% → 2, 20% → 3, 10% → 4
    const modifierCountRoll = Math.floor(Math.random() * 10) + 1;
    const k = Math.max(
      0,
      (count ??
        (modifierCountRoll <= 3
          ? 1
          : modifierCountRoll <= 7
            ? 2
            : modifierCountRoll <= 9
              ? 3
              : 4)) - countReduction,
    );

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
      isRandomSpawn: selected.has("isRandomSpawn"),
      isCompact: selected.has("isCompact"),
      isCrowded: selected.has("isCrowded"),
      isHardNations: selected.has("isHardNations"),
      startingGold: selected.has("startingGoldHigh")
        ? 25_000_000
        : selected.has("startingGold")
          ? 5_000_000
          : undefined,
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
    // Apply compact 75% player reduction
    p = Math.max(3, Math.floor(p * 0.25));
    // Apply team adjustment
    p = this.adjustForTeams(p, playerTeams);
    // Check at least 2 players per team
    return this.playersPerTeam(p, playerTeams) >= 2;
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

  /**
   * Centralised spawn-immunity duration logic.
   * - HumansVsNations: always 5s (nations can't benefit from longer PVP immunity)
   * - 25M starting gold: 2:30 (extra time to compensate for high gold)
   * - 5M starting gold: 30s
   * - Default: 5s
   */
  private getSpawnImmunityDuration(
    playerTeams?: TeamCountConfig,
    startingGold?: number,
  ): number {
    if (playerTeams === HumansVsNations) return 5 * 10;
    if (startingGold !== undefined && startingGold >= 25_000_000)
      return 150 * 10;
    if (startingGold) return 30 * 10;
    return 5 * 10;
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
}
