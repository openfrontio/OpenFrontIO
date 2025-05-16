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

/**
 * Asynchronously sets up and returns a new game instance using a specified map and configuration.
 *
 * Loads a PNG map file by name, generates terrain and minimap data, merges default and provided game configuration options, and initializes the game with the given human players.
 *
 * @param mapName - The name of the map file (without extension) to load from the test data directory.
 * @param _gameConfig - Optional partial game configuration to override defaults.
 * @param humans - Array of human player information to include in the game.
 * @returns A promise that resolves to the initialized {@link Game} instance.
 */
export async function setup(
  mapName: string,
  _gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
): Promise<Game> {
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
    allowMultiTabbing: false,
    ..._gameConfig,
  };
  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(),
    false,
  );

  // Create and return the game
  return createGame(humans, [], gameMap, miniGameMap, config);
}

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo("fr", name, type, null, name);
}
