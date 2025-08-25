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
import { GameConfig, GameID, TeamCountConfig } from "../Schemas";
import { GameMap, TileRef } from "../game/GameMap";
import { Colord } from "colord";
import { JWK } from "jose";
import { NukeType } from "../StatsSchemas";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export type ServerConfig = {
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
  replayUrl(gameId: GameID): string;
};

export type NukeMagnitude = {
  inner: number;
  outer: number;
};

export type Config = {
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
  deleteUnitCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeShipGold(dist: number, numPorts: number): Gold;
  tradeShipSpawnRate(numberOfPorts: number): number;
  trainGold(isFriendly: boolean): Gold;
  trainSpawnRate(numberOfStations: number): number;
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
  nukeDeathFactor(
    nukeType: NukeType,
    humans: number,
    tilesOwned: number,
    maxTroops: number,
  ): number;
  structureMinDist(): number;
  isReplay(): boolean;
  allianceExtensionPromptOffset(): number;
};

export type Theme = {
  teamColor(team: Team): Colord;
  territoryColor(playerInfo: PlayerView): Colord;
  specialBuildingColor(playerInfo: PlayerView): Colord;
  railroadColor(playerInfo: PlayerView): Colord;
  borderColor(playerInfo: PlayerView): Colord;
  defendedBorderColors(playerInfo: PlayerView): { light: Colord; dark: Colord };
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
};
