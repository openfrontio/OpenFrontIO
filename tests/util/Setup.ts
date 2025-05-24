import fs from "fs/promises";
import path from "path";
import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { generateMap } from "../../src/scripts/TerrainMapGenerator";
import { TestConfig } from "./TestConfig";
import { TestServerConfig } from "./TestServerConfig";

export async function setup(
  mapName: string,
  _gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
): Promise<Game> {
  // Suppress console.debug for tests.
  console.debug = () => {};

  // Load the specified map
  const mapPath = path.join(__dirname, "..", "testdata", `${mapName}.png`);
  const imageBuffer = await fs.readFile(mapPath);
  const { map, miniMap } = await generateMap(imageBuffer, false);
  const gameMap = await genTerrainFromBin(String.fromCharCode.apply(null, map));
  const miniGameMap = await genTerrainFromBin(
    String.fromCharCode.apply(null, miniMap),
  );

  // Configure the game
  const serverConfig = new TestServerConfig();
  const gameConfig: GameConfig = {
    gameMap: GameMapType.Asia,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    disableNPCs: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    ..._gameConfig,
  };
  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(),
    false,
  );

  return createGame(humans, [], gameMap, miniGameMap, config);
}

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo("fr", name, type, null, name);
}
