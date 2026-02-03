import { GameConfig } from "../Schemas";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "./Game";

type BaseGameConfig = Omit<GameConfig, "gameType">;

const DEFAULT_BASE_GAME_CONFIG: BaseGameConfig = {
  donateGold: false,
  donateTroops: false,
  gameMap: GameMapType.World,
  gameMapSize: GameMapSize.Normal,
  difficulty: Difficulty.Easy,
  disableNations: false,
  infiniteGold: false,
  infiniteTroops: false,
  maxTimerValue: undefined,
  instantBuild: false,
  randomSpawn: false,
  gameMode: GameMode.FFA,
  bots: 400,
  disabledUnits: [],
};

function createDefaultGameConfig(gameType: GameType): GameConfig {
  return {
    ...DEFAULT_BASE_GAME_CONFIG,
    gameType,
    disabledUnits: [...(DEFAULT_BASE_GAME_CONFIG.disabledUnits ?? [])],
  };
}

export function createDefaultPrivateGameConfig(): GameConfig {
  return createDefaultGameConfig(GameType.Private);
}

export function createDefaultPublicGameConfig(): GameConfig {
  return createDefaultGameConfig(GameType.Public);
}

export function createDefaultSingleplayerGameConfig(): GameConfig {
  return createDefaultGameConfig(GameType.Singleplayer);
}
