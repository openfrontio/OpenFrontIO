import fs from "fs";
import path from "path";
import { EventBus } from "../../src/core/EventBus";
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
import {
  genTerrainFromBin,
  MapManifest,
} from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import LocalStorage from "../../src/core/Storage";
import { MockMemoryStorage } from "../mock/MockStorage";
import { TestConfig } from "./TestConfig";
import { TestServerConfig } from "./TestServerConfig";

export async function setup(
  mapName: string,
  _gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
  currentDir: string = __dirname,
): Promise<Game> {
  // Suppress console.debug for tests.
  console.debug = () => {};

  // Simple binary file loading using fs.readFileSync()
  const mapBinPath = path.join(
    currentDir,
    `../testdata/maps/${mapName}/map.bin`,
  );
  const miniMapBinPath = path.join(
    currentDir,
    `../testdata/maps/${mapName}/mini_map.bin`,
  );
  const manifestPath = path.join(
    currentDir,
    `../testdata/maps/${mapName}/manifest.json`,
  );

  const mapBinBuffer = fs.readFileSync(mapBinPath);
  const miniMapBinBuffer = fs.readFileSync(miniMapBinPath);
  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) satisfies MapManifest;

  // Convert Buffer to string (binary encoding)
  const mapBinString = mapBinBuffer.toString("binary");
  const miniMapBinString = miniMapBinBuffer.toString("binary");

  const gameMap = await genTerrainFromBin(manifest.map, mapBinString);
  const miniGameMap = await genTerrainFromBin(
    manifest.mini_map,
    miniMapBinString,
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

  const eventBus = new EventBus();
  const storage: LocalStorage = new MockMemoryStorage();

  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(eventBus, storage),
    false,
  );

  return createGame(humans, [], gameMap, miniGameMap, config);
}

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo(name, type, null, name);
}
