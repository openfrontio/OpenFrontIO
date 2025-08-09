import fs from "fs";
import path from "path";
import { z } from "zod";
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
  MapManifestSchema,
} from "../../src/core/game/TerrainMapLoader";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
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
  const str = fs.readFileSync(manifestPath, "utf8");
  const raw = JSON.parse(str);
  const parsed = MapManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const error = z.prettifyError(parsed.error);
    throw new Error(`Error parsing ${manifestPath}: ${error}`);
  }
  const manifest = parsed.data;

  const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
  const miniGameMap = await genTerrainFromBin(
    manifest.mini_map,
    miniMapBinBuffer,
  );

  // Configure the game
  const serverConfig = new TestServerConfig();
  const gameConfig: GameConfig = {
    bots: 0,
    difficulty: Difficulty.Medium,
    disableNPCs: false,
    donateGold: false,
    donateTroops: false,
    gameMap: GameMapType.Asia,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
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
  return new PlayerInfo(name, type, null, name);
}
