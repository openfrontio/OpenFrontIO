import {
  Difficulty,
  Duos,
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
import {
  getPublicLobbyMapWeight,
  publicLobbyMaps,
} from "../core/game/PublicLobbyMaps";
import { GameConfig, TeamCountConfig } from "../core/Schemas";
import { getMapLandTiles } from "./MapLandTiles";

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
  private recentMaps: GameMapType[] = [];
  private modeSequenceIndex = 0;
  private readonly maxRecentMaps = 5;
  private readonly modeSequence: GameMode[];

  constructor(private disableTeams: boolean = false) {
    this.modeSequence = disableTeams
      ? [GameMode.FFA]
      : [GameMode.FFA, GameMode.Team, GameMode.FFA];
  }

  public async gameConfig(
    mapVotes?: Map<GameMapType, number>,
  ): Promise<GameConfig> {
    const { map, mode } = this.getNextMap(mapVotes);

    const playerTeams =
      mode === GameMode.Team ? this.getTeamCount() : undefined;

    const modifiers = this.getRandomPublicGameModifiers();
    const { startingGold } = modifiers;
    let { isCompact, isRandomSpawn } = modifiers;

    // Duos, Trios, and Quads should not get random spawn (as it defeats the purpose)
    if (
      playerTeams === Duos ||
      playerTeams === Trios ||
      playerTeams === Quads
    ) {
      isRandomSpawn = false;
    }

    // Maps with smallest player count < 50 don't support compact map in team games
    // The smallest player count is the 3rd number in the player counts array
    if (
      mode === GameMode.Team &&
      !(await this.supportsCompactMapForTeams(map))
    ) {
      isCompact = false;
    }

    // Create the default public game config (from your GameManager)
    return {
      donateGold: mode === GameMode.Team,
      donateTroops: mode === GameMode.Team,
      gameMap: map,
      maxPlayers: await this.lobbyMaxPlayers(map, mode, playerTeams, isCompact),
      gameType: GameType.Public,
      gameMapSize: isCompact ? GameMapSize.Compact : GameMapSize.Normal,
      publicGameModifiers: { isCompact, isRandomSpawn, startingGold },
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

  private getNextMap(mapVotes?: Map<GameMapType, number>): MapWithMode {
    const mode = this.getNextMode();
    const map = this.getWeightedMap(mapVotes);
    return { map, mode };
  }

  private getNextMode(): GameMode {
    const mode = this.modeSequence[this.modeSequenceIndex];
    this.modeSequenceIndex =
      (this.modeSequenceIndex + 1) % this.modeSequence.length;
    return mode;
  }

  private getWeightedMap(mapVotes?: Map<GameMapType, number>): GameMapType {
    const weightedMaps = publicLobbyMaps
      .map((map) => ({
        map,
        weight: getPublicLobbyMapWeight(map) + (mapVotes?.get(map) ?? 0),
      }))
      .filter(({ weight }) => weight > 0);

    if (weightedMaps.length === 0) {
      return publicLobbyMaps[0] ?? GameMapType.World;
    }

    const recentSet = new Set(this.recentMaps);
    const hasNonRecent = weightedMaps.some(({ map }) => !recentSet.has(map));
    const candidateMaps = hasNonRecent
      ? weightedMaps.filter(({ map }) => !recentSet.has(map))
      : weightedMaps;
    const selected = this.pickWeightedMap(candidateMaps);

    this.recentMaps.push(selected);
    if (this.recentMaps.length > this.maxRecentMaps) {
      this.recentMaps.shift();
    }

    return selected;
  }

  private pickWeightedMap(
    weightedMaps: Array<{ map: GameMapType; weight: number }>,
  ): GameMapType {
    const totalWeight = weightedMaps.reduce(
      (sum, { weight }) => sum + weight,
      0,
    );
    const roll = Math.random() * totalWeight;
    let cumulativeWeight = 0;
    for (const { map, weight } of weightedMaps) {
      cumulativeWeight += weight;
      if (roll < cumulativeWeight) {
        return map;
      }
    }
    return weightedMaps[0]?.map ?? GameMapType.World;
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
      startingGold: Math.random() < 0.05 ? 5_000_000 : undefined, // 5% chance
    };
  }

  private async supportsCompactMapForTeams(map: GameMapType): Promise<boolean> {
    // Maps with smallest player count < 50 don't support compact map in team games
    // The smallest player count is the 3rd number in the player counts array
    const landTiles = await getMapLandTiles(map);
    const [, , smallest] = this.calculateMapPlayerCounts(landTiles);
    return smallest >= 50;
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
    if (numPlayerTeams === undefined) return p;
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
