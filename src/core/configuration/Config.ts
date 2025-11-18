import { Colord } from "colord";
import { JWK } from "jose";
import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  Gold,
  Player,
  PlayerInfo,
  Team,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import { NukeType } from "../StatsSchemas";

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export interface ServerConfig {
  turnIntervalMs(): number;
  gameCreationRate(): number;
  lobbyMaxPlayers(
    map: GameMapType,
    mode: GameMode,
    numPlayerTeams: TeamCountConfig | undefined,
  ): number;
  numWorkers(): number;
  workerIndex(gameID: GameID): number;
  workerPath(gameID: GameID): string;
  workerPort(gameID: GameID): number;
  workerPortByIndex(workerID: number): number;
  env(): GameEnv;
  adminToken(): string;
  adminHeader(): string;
  // Only available on the server
  gitCommit(): string;
  r2Bucket(): string;
  r2Endpoint(): string;
  r2AccessKey(): string;
  r2SecretKey(): string;
  apiKey(): string;
  otelEndpoint(): string;
  otelAuthHeader(): string;
  otelEnabled(): boolean;
  jwtAudience(): string;
  jwtIssuer(): string;
  jwkPublicKey(): Promise<JWK>;
  domain(): string;
  subdomain(): string;
  cloudflareAccountId(): string;
  cloudflareApiToken(): string;
  cloudflareConfigPath(): string;
  cloudflareCredsPath(): string;
  stripePublishableKey(): string;
  allowedFlares(): string[] | undefined;
  enableMatchmaking(): boolean;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

export interface Config {
  samHittingChance(): number;
  samWarheadHittingChance(): number;
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  numBots(): number;
  spawnNPCs(): boolean;
  isUnitDisabled(unitType: UnitType): boolean;
  bots(): number;
  infiniteGold(): boolean;
  donateGold(): boolean;
  infiniteTroops(): boolean;
  donateTroops(): boolean;
  instantBuild(): boolean;
  isRandomSpawn(): boolean;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;
  playerTeams(): TeamCountConfig;

  startManpower(playerInfo: PlayerInfo): number;
  troopIncreaseRate(player: Player | PlayerView): number;
  goldAdditionRate(player: Player | PlayerView): Gold;
  attackTilesPerTick(
    attckTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    numAdjacentTilesWithEnemy: number,
  ): number;
  attackLogic(
    gm: Game,
    attackTroops: number,
    attacker: Player,
    defender: Player | TerraNullius,
    tileToConquer: TileRef,
  ): {
    attackerTroopLoss: number;
    defenderTroopLoss: number;
    tilesPerTickUsed: number;
  };
  attackAmount(attacker: Player, defender: Player | TerraNullius): number;
  /**
   * Controls the strength of directional attack bias (additive approach).
   * This value determines the fixed point offset added/subtracted based on alignment.
   * - Value of 2.5 creates a subtle 0-5 point swing (0 for aligned, 5 for opposite direction)
   * - Higher values make direction more influential (e.g., 6.0 creates 0-12 swing)
   * - Lower values make direction less noticeable
   *
   * With exponential time decay: 100% influence at start, fading to ~5% by 6 seconds (20 tick constant)
   */
  attackDirectionWeight(): number;
  /**
   * Time constant (in ticks) for exponential decay of directional influence.
   * Direction bias fades exponentially as: exp(-timeSinceStart / timeDecayConstant)
   * - 20 ticks (2s): Fast decay - noticeable in first 3s, gone by 6s (recommended)
   * - 15 ticks (1.5s): Faster decay - gone by 4-5s
   * - 25 ticks (2.5s): Slower decay - gentle falloff over 6-8s
   * - 999999: Effectively disabled - direction persists throughout attack
   *
   * Direction fades naturally: 100% at start → 22% at 3s → 5% at 6s
   */
  attackTimeDecay(): number;
  /**
   * Weight for magnitude-based proximity bonus (distance decay).
   * Tiles closer to the clicked point receive additional priority bonus.
   * Uses BFS (topological) distance when available, falls back to Euclidean.
   * - 0.0: Disabled - pure directional bias only
   * - 0.3: Subtle - minor locality preference
   * - 0.75: Subtle with time decay - gentle convergence that fades (recommended)
   * - 1.0: Balanced - moderate proximity bonus
   * - 2.0: Strong - creates noticeable convergence
   * - 5.0+: Very strong locality preference
   * This creates triangular convergence toward the clicked point.
   */
  attackMagnitudeWeight(): number;
  /**
   * Distance decay constant for proximity bonus (in tiles for BFS, coordinate units for Euclidean).
   * Controls how quickly the proximity bonus fades with distance from click point.
   *
   * For BFS distances (topological):
   * - 30 tiles: Bonus decays to ~37% at 30 tiles, ~5% at 90 tiles (recommended)
   * - 50 tiles: Slower decay - bonus persists longer
   * - 20 tiles: Faster decay - only very close tiles get significant bonus
   *
   * Lower values = faster fade, Higher values = proximity persists longer
   */
  attackDistanceDecayConstant(): number;
  /**
   * Maximum BFS radius for all directed attacks (in tiles).
   * Limits how far the BFS can traverse from the click point.
   * This prevents performance issues on large maps and large late-game empires.
   *
   * - 100 tiles: Very fast - minimal search area, sufficient for most cases
   * - 200 tiles: Balanced - optimal performance, proximity bonus negligible beyond this (current)
   * - 500 tiles: Large - handles extreme scenarios, may cause stuttering on large attacks
   *
   * Applies to all attacks (neutral and player). Beyond this radius, tiles fall back to
   * Euclidean distance for proximity calculations. Note: proximity bonus decays to ~0.03%
   * at 200 tiles (exp(-200/25)), making larger radii unnecessary.
   */
  attackBFSMaxRadius(): number;
  /**
   * Downsample factor for BFS distance calculations in directed attacks.
   * Only tiles at grid coordinates (multiples of this factor) are stored in the distance map.
   * - 10: Balanced - good performance with minimal accuracy loss (recommended)
   * - 5: Higher precision - more memory, slower BFS initialization
   * - 15-20: Lower precision - faster BFS, less memory, may reduce proximity bonus effectiveness
   */
  attackBFSDownsampleFactor(): number;
  /**
   * Enable debug logging for directed attack telemetry.
   * When enabled, logs BFS initialization and performance metrics to console.
   * - false: Production mode - no telemetry logs (recommended)
   * - true: Debug mode - log BFS performance and statistics
   */
  debugDirectedAttacks(): boolean;
  radiusPortSpawn(): number;
  // When computing likelihood of trading for any given port, the X closest port
  // are twice more likely to be selected. X is determined below.
  proximityBonusPortsNb(totalPorts: number): number;
  maxTroops(player: Player | PlayerView): number;
  cityTroopIncrease(): number;
  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number;
  shellLifetime(): number;
  boatMaxNumber(): number;
  allianceDuration(): Tick;
  allianceRequestDuration(): Tick;
  allianceRequestCooldown(): Tick;
  temporaryEmbargoDuration(): Tick;
  targetDuration(): Tick;
  targetCooldown(): Tick;
  emojiMessageCooldown(): Tick;
  emojiMessageDuration(): Tick;
  donateCooldown(): Tick;
  embargoAllCooldown(): Tick;
  deletionMarkDuration(): Tick;
  deleteUnitCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeShipShortRangeDebuff(): number;
  tradeShipGold(dist: number, numPorts: number): Gold;
  tradeShipSpawnRate(
    numTradeShips: number,
    numPlayerPorts: number,
    numPlayerTradeShips: number,
  ): number;
  trainGold(rel: "self" | "team" | "ally" | "other"): Gold;
  trainSpawnRate(numPlayerFactories: number): number;
  trainStationMinRange(): number;
  trainStationMaxRange(): number;
  railroadMaxSize(): number;
  safeFromPiratesCooldownMax(): number;
  defensePostRange(): number;
  SAMCooldown(): number;
  SiloCooldown(): number;
  defensePostDefenseBonus(): number;
  defensePostSpeedBonus(): number;
  falloutDefenseModifier(percentOfFallout: number): number;
  difficultyModifier(difficulty: Difficulty): number;
  warshipPatrolRange(): number;
  warshipShellAttackRate(): number;
  warshipTargettingRange(): number;
  defensePostShellAttackRate(): number;
  defensePostTargettingRange(): number;
  // 0-1
  traitorDefenseDebuff(): number;
  traitorDuration(): number;
  nukeMagnitudes(unitType: UnitType): NukeMagnitude;
  // Number of tiles destroyed to break an alliance
  nukeAllianceBreakThreshold(): number;
  defaultNukeSpeed(): number;
  defaultNukeTargetableRange(): number;
  defaultSamMissileSpeed(): number;
  defaultSamRange(): number;
  samRange(level: number): number;
  maxSamRange(): number;
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number;
  structureMinDist(): number;
  isReplay(): boolean;
  allianceExtensionPromptOffset(): number;
}

export interface Theme {
  teamColor(team: Team): Colord;
  // Don't call directly, use PlayerView
  territoryColor(playerInfo: PlayerView): Colord;
  // Don't call directly, use PlayerView
  structureColors(territoryColor: Colord): { light: Colord; dark: Colord };
  // Don't call directly, use PlayerView
  borderColor(territoryColor: Colord): Colord;
  // Don't call directly, use PlayerView
  defendedBorderColors(territoryColor: Colord): { light: Colord; dark: Colord };
  focusedBorderColor(): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  textColor(playerInfo: PlayerView): string;
  // unit color for alternate view
  selfColor(): Colord;
  allyColor(): Colord;
  neutralColor(): Colord;
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
  spawnHighlightSelfColor(): Colord;
  spawnHighlightTeamColor(): Colord;
  spawnHighlightEnemyColor(): Colord;
}
