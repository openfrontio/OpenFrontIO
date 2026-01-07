import { Colord } from "colord";
import { JWK } from "jose";
import {
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
  turnstileSiteKey(): string;
  turnstileSecretKey(): string;
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
  apiKey(): string;
  otelEndpoint(): string;
  otelAuthHeader(): string;
  otelEnabled(): boolean;
  jwtAudience(): string;
  jwtIssuer(): string;
  jwkPublicKey(): Promise<JWK>;
  domain(): string;
  subdomain(): string;
  stripePublishableKey(): string;
  allowedFlares(): string[] | undefined;
  enableMatchmaking(): boolean;
}

export interface NukeMagnitude {
  inner: number;
  outer: number;
}

export interface Config {
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  numBots(): number;
  spawnNations(): boolean;
  isUnitDisabled(unitType: UnitType): boolean;
  bots(): number;
  infiniteGold(): boolean;
  donateGold(): boolean;
  infiniteTroops(): boolean;
  donateTroops(): boolean;
  instantBuild(): boolean;
  disableNavMesh(): boolean;
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
  minDistanceBetweenPlayers(): number;
  defensePostDefenseBonus(): number;
  defensePostSpeedBonus(): number;
  falloutDefenseModifier(percentOfFallout: number): number;
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
