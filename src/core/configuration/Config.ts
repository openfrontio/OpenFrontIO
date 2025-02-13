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
import { GameConfig } from "../Schemas";
import { DefaultConfig } from "./DefaultConfig";
import { DevConfig, DevServerConfig } from "./DevConfig";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { UserSettings } from "../game/UserSettings";

export enum GameEnv {
  Dev,
  Prod,
}
export function getConfig(
  gameConfig: GameConfig,
  userSettings: UserSettings,
): Config {
  const sc = getServerConfig();
  switch (process.env.GAME_ENV) {
    case "dev":
      return new DevConfig(sc, gameConfig, userSettings);
    case "preprod":
    case "prod":
      consolex.log("using prod config");
      return new DefaultConfig(sc, gameConfig, userSettings);
    default:
      throw Error(`unsupported server configuration: ${process.env.GAME_ENV}`);
  }
}

export function getServerConfig(): ServerConfig {
  switch (process.env.GAME_ENV) {
    case "dev":
      consolex.log("using dev config");
      return new DevServerConfig();
    case "preprod":
      consolex.log("using preprod config");
      return preprodConfig;
    case "prod":
    default:
      consolex.log("using prod config");
      return prodConfig;
    // default:
    // 	throw Error(`unsupported server configuration: ${process.env.GAME_ENV}`)
  }
}

export interface ServerConfig {
  turnIntervalMs(): number;
  gameCreationRate(): number;
  lobbyLifetime(): number;
}

export interface Config {
  spawnImmunityDuration(): Tick;
  serverConfig(): ServerConfig;
  gameConfig(): GameConfig;
  theme(): Theme;
  percentageTilesOwnedToWin(): number;
  numBots(): number;
  spawnNPCs(): boolean;
  spawnBots(): boolean;
  creativeMode(): boolean;
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
  boatMaxDistance(): number;
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
}

export interface Theme {
  territoryColor(playerInfo: PlayerInfo): Colord;
  borderColor(playerInfo: PlayerInfo): Colord;
  defendedBorderColor(playerInfo: PlayerInfo): Colord;
  terrainColor(gm: GameMap, tile: TileRef): Colord;
  backgroundColor(): Colord;
  falloutColor(): Colord;
  font(): string;
  // unit color for alternate view
  selfColor(): Colord;
  allyColor(): Colord;
  enemyColor(): Colord;
  spawnHighlightColor(): Colord;
}
