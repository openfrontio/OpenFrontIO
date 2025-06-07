import { Colord } from "colord";
import { JWK } from "jose";
import { GameConfig, GameID } from "../Schemas";
import {
  Difficulty,
  Duos,
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
    numPlayerTeams: number | undefined,
  ): number;
  numWorkers(): number;
  workerIndex(gameID: GameID): number;
  workerPath(gameID: GameID): string;
  workerPort(gameID: GameID): number;
  workerPortByIndex(workerID: number): number;
  env(): GameEnv;
  region(): string;
  adminToken(): string;
  adminHeader(): string;
  // Only available on the server
  gitCommit(): string;
  r2Bucket(): string;
  r2Endpoint(): string;
  r2AccessKey(): string;
  r2SecretKey(): string;
  otelEndpoint(): string;
  otelUsername(): string;
  otelPassword(): string;
  otelEnabled(): boolean;
  jwtAudience(): string;
  jwtIssuer(): string;
  jwkPublicKey(): Promise<JWK>;
  domain(): string;
  subdomain(): string;
  cloudflareAccountId(): string;
  cloudflareApiToken(): string;
  cloudflareConfigDir(): string;
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
  infiniteTroops(): boolean;
  instantBuild(): boolean;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;
  playerTeams(): number | typeof Duos;

  startManpower(playerInfo: PlayerInfo): number;
  populationIncreaseRate(player: Player | PlayerView): number;
  goldAdditionRate(player: Player | PlayerView): Gold;
  troopAdjustmentRate(player: Player): number;
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
  maxPopulation(player: Player | PlayerView): number;
  cityPopulationIncrease(): number;
  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number;
  shellLifetime(): number;
  boatMaxNumber(): number;
  allianceDuration(): Tick;
  allianceRequestCooldown(): Tick;
  temporaryEmbargoDuration(): Tick;
  targetDuration(): Tick;
  targetCooldown(): Tick;
  emojiMessageCooldown(): Tick;
  emojiMessageDuration(): Tick;
  donateCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeShipGold(dist: number): Gold;
  tradeShipSpawnRate(numberOfPorts: number): number;
  safeFromPiratesCooldownMax(): number;
  defensePostRange(): number;
  SAMCooldown(): number;
  SiloCooldown(): number;
  defensePostDefenseBonus(): number;
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
  defaultNukeSpeed(): number;
  nukeDeathFactor(humans: number, tilesOwned: number): number;
  structureMinDist(): number;
  isReplay(): boolean;
}

export interface Theme {
  teamColor(team: Team): Colord;
  territoryColor(playerInfo: PlayerView): Colord;
  specialBuildingColor(playerInfo: PlayerView): Colord;
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
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
}
