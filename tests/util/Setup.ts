import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { MapManifest } from "@openfront/engine-api/game/MapFiles";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { genTerrainFromBin } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Game } from "@openfront/engine/game/Game";
import { createGame } from "@openfront/engine/game/GameImpl";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TestConfig } from "./TestConfig";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function setup(
  mapName: string,
  _gameConfig: Partial<GameConfig> = {},
  humans: PlayerInfo[] = [],
  currentDir: string = __dirname,
  ConfigClass: typeof EngineConfig = TestConfig,
  autoEndSpawnPhase: boolean = true,
  nations: Nation[] = [],
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
    `../testdata/maps/${mapName}/map4x.bin`,
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

  const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
  const miniGameMap = await genTerrainFromBin(manifest.map4x, miniMapBinBuffer);

  const gameConfig: GameConfig = {
    gameMap: GameMapType.Asia,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    ..._gameConfig,
  };
  const config = new ConfigClass(gameConfig, false);

  const game = createGame(humans, nations, gameMap, miniGameMap, config);
  if (autoEndSpawnPhase) game.endSpawnPhase();
  return game;
}

export function playerInfo(name: string, type: PlayerType): PlayerInfo {
  return new PlayerInfo(name, type, null, name);
}
