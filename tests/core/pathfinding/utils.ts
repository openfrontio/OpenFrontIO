import { Game } from "../../../src/core/game/Game";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { createGame } from "../../../src/core/game/GameImpl";
import { TestConfig } from "../../util/TestConfig";
import { TestServerConfig } from "../../util/TestServerConfig";
import { UserSettings } from "../../../src/core/game/UserSettings";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../src/core/game/Game";

const LAND_BIT = 7;
const OCEAN_BIT = 5;

/**
 * Creates a Game from inline map strings.
 * Each char = 1 tile: W=water (ocean), L=land
 * miniMap automatically generated (2x2→1, water if ANY tile water)
 *
 * Example:
 *   const game = await gameFromString([
 *     'WWWWW',
 *     'WLLLW',
 *     'WWWWW'
 *   ]);
 */
export async function gameFromString(mapRows: string[]): Promise<Game> {
  const height = mapRows.length;
  const width = mapRows[0].length;

  for (const row of mapRows) {
    if (row.length !== width) {
      throw new Error(`All rows must have same width. Expected ${width}, got ${row.length}`);
    }
  }

  const terrainData = new Uint8Array(width * height);
  let numLandTiles = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const char = mapRows[y][x];

      if (char === 'L') {
        terrainData[idx] = 1 << LAND_BIT; // Set land bit
        numLandTiles++;
      } else if (char === 'W') {
        terrainData[idx] = 1 << OCEAN_BIT; // Set ocean bit (water)
      } else {
        throw new Error(`Unknown char '${char}' at (${x},${y}). Use W=water, L=land`);
      }
    }
  }

  const gameMap = new GameMapImpl(width, height, terrainData, numLandTiles);

  // Create miniMap (2x2→1, water if ANY tile water)
  const miniWidth = Math.ceil(width / 2);
  const miniHeight = Math.ceil(height / 2);
  const miniTerrainData = new Uint8Array(miniWidth * miniHeight);
  let miniNumLandTiles = 0;

  for (let miniY = 0; miniY < miniHeight; miniY++) {
    for (let miniX = 0; miniX < miniWidth; miniX++) {
      const miniIdx = miniY * miniWidth + miniX;

      // Check 2x2 chunk: if ANY tile is water, miniMap tile is water
      let water = false;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = miniX * 2 + dx;
          const y = miniY * 2 + dy;

          if (x < width && y < height) {
            const idx = y * width + x;
            if (!(terrainData[idx] & (1 << LAND_BIT))) {
              water = true;
            }
          }
        }
      }

      // Water if ANY tile is water
      if (water) {
        miniTerrainData[miniIdx] = 1 << OCEAN_BIT; // ocean
      } else {
        miniTerrainData[miniIdx] = 1 << LAND_BIT; // land
        miniNumLandTiles++;
      }
    }
  }

  const miniGameMap = new GameMapImpl(miniWidth, miniHeight, miniTerrainData, miniNumLandTiles);

  // Create game config
  const serverConfig = new TestServerConfig();
  const gameConfig = {
    gameMap: GameMapType.Asia,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Medium,
    disableNations: false,
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    disableNavMesh: false,
    randomSpawn: false,
  };
  const config = new TestConfig(serverConfig, gameConfig, new UserSettings(), false);

  return createGame([], [], gameMap, miniGameMap, config);
}
