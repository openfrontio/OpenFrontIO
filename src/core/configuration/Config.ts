import {
  Difficulty,
  Game,
  GameType,
  Gold,
  Player,
  PlayerID,
  PlayerInfo,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "../game/Game";
import { Colord, colord } from "colord";
import { preprodConfig } from "./PreprodConfig";
import { prodConfig } from "./ProdConfig";
import { consolex } from "../Consolex";
import { GameConfig, GameID } from "../Schemas";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";

let cachedSC: ServerConfig = null;

export enum GameEnv {
  Dev,
  Preprod,
  Prod,
}

export async function getConfig(
  gameConfig: GameConfig,
  userSettings: UserSettings | null = null,
): Promise<Config> {
  const sc = await getServerConfigFromClient();
  switch (sc.env()) {
    case GameEnv.Dev:
      return new DevConfig(sc, gameConfig, userSettings);
    case GameEnv.Preprod:
    case GameEnv.Prod:
      consolex.log("using prod config");
      return new DefaultConfig(sc, gameConfig, userSettings);
    default:
      throw Error(`unsupported server configuration: ${process.env.GAME_ENV}`);
  }
}

export async function getServerConfigFromClient(): Promise<ServerConfig> {
  if (cachedSC) {
    return cachedSC;
  }
  const response = await fetch("/api/env");

  if (!response.ok) {
    throw new Error(
      `Failed to fetch server config: ${response.status} ${response.statusText}`,
    );
  }
  const config = await response.json();
  // Log the retrieved configuration
  console.log("Server config loaded:", config);

  cachedSC = getServerConfig(config.game_env);
  return cachedSC;
}

export function getServerConfigFromServer(): ServerConfig {
  const gameEnv = process.env.GAME_ENV;
  return getServerConfig(gameEnv);
}

function getServerConfig(gameEnv: string) {
  switch (gameEnv) {
    case "dev":
      consolex.log("using dev server config");
      return new DevServerConfig();
    case "staging":
      consolex.log("using preprod server config");
      return preprodConfig;
    case "prod":
      consolex.log("using prod server config");
      return prodConfig;
    default:
      throw Error(`unsupported server configuration: ${gameEnv}`);
  }
}

export interface ServerConfig {
  turnIntervalMs(): number;
  gameCreationRate(highTraffic: boolean): number;
  lobbyLifetime(highTraffic): number;
  discordRedirectURI(): string;
  numWorkers(): number;
  workerIndex(gameID: GameID): number;
  workerPath(gameID: GameID): string;
  workerPort(gameID: GameID): number;
  workerPortByIndex(workerID: number): number;
  env(): GameEnv;
  adminToken(): string;
  adminHeader(): string;
}

export interface Config {
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  numBots(): number;
  spawnNPCs(): boolean;
  bots(): number;
  infiniteGold(): boolean;
  infiniteTroops(): boolean;
  instantBuild(): boolean;
  numSpawnPhaseTurns(): number;
  userSettings(): UserSettings;

  startManpower(playerInfo: PlayerInfo): number;
  populationIncreaseRate(player: Player | PlayerView): number;
  goldAdditionRate(player: Player | PlayerView): number;
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
  maxPopulation(player: Player | PlayerView): number;
  cityPopulationIncrease(): number;
  boatAttackAmount(attacker: Player, defender: Player | TerraNullius): number;
  boatMaxNumber(): number;
  allianceDuration(): Tick;
  allianceRequestCooldown(): Tick;
  targetDuration(): Tick;
  targetCooldown(): Tick;
  emojiMessageCooldown(): Tick;
  emojiMessageDuration(): Tick;
  donateCooldown(): Tick;
  defaultDonationAmount(sender: Player): number;
  unitInfo(type: UnitType): UnitInfo;
  tradeShipGold(dist: number): Gold;
  tradeShipSpawnRate(): number;
  defensePostRange(): number;
  defensePostDefenseBonus(): number;
  falloutDefenseModifier(): number;
  difficultyModifier(difficulty: Difficulty): number;
  // 0-1
  traitorDefenseDebuff(): number;
}

export interface Theme {
  territoryColor(playerInfo: PlayerInfo): Colord;
  borderColor(playerInfo: PlayerInfo): Colord;
  defendedBorderColor(playerInfo: PlayerInfo): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  textColor(playerInfo: PlayerInfo): string;
  // unit color for alternate view
  selfColor(): Colord;
  allyColor(): Colord;
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
}
