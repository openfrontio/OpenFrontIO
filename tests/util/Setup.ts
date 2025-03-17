import { generateMap } from "../../src/scripts/TerrainMapGenerator";
import fs from "fs/promises";
import path from "path";
import { createGame } from "../../src/core/game/GameImpl";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";
import { TestConfig } from "./TestConfig";
import { TestServerConfig } from "./TestServerConfig";
import { UserSettings } from "../../src/core/game/UserSettings";
import { Difficulty, GameType } from "../../src/core/game/Game";

export async function setup(mapName: string) {
  // Load the specified map
  const mapPath = path.join(__dirname, "..", "testdata", `${mapName}.png`);
  const imageBuffer = await fs.readFile(mapPath);
  const { map, miniMap } = await generateMap(imageBuffer);
  const gameMap = await genTerrainFromBin(String.fromCharCode.apply(null, map));
  const miniGameMap = await genTerrainFromBin(
    String.fromCharCode.apply(null, miniMap),
  );
  const nationMap = { nations: [] };

  // Configure the game
  const serverConfig = new TestServerConfig();
  const gameConfig = {
    gameMap: null,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    disableNPCs: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
  };
  const config = new TestConfig(serverConfig, gameConfig, new UserSettings());

  // Create and return the game
  return createGame(gameMap, miniGameMap, nationMap, config);
}
