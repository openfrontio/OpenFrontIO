// Minimal test maps for pathfinding unit tests

import {
  Difficulty,
  Game,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../../src/core/game/Game";
import { createGame as createGameImpl } from "../../../src/core/game/GameImpl";
import { GameMapImpl } from "../../../src/core/game/GameMap";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { TestConfig } from "../../util/TestConfig";
import { TestServerConfig } from "../../util/TestServerConfig";

export const W = "W"; // Water
export const L = "L"; // Land

// Terrain encoding
const WATER_BIT = 0x20;
const LAND_BIT = 0x80;
const SHORELINE_BIT = 6;

export type TestMapData = {
  width: number;
  height: number;
  grid: string[];
};

// Compute shoreline bit for tiles adjacent to opposite terrain
function computeShoreline(
  terrain: Uint8Array,
  width: number,
  height: number,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const isLand = (terrain[idx] & LAND_BIT) !== 0;
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const neighborIsLand = (terrain[ny * width + nx] & LAND_BIT) !== 0;
        if (isLand !== neighborIsLand) {
          terrain[idx] |= 1 << SHORELINE_BIT;
          break;
        }
      }
    }
  }
}

// 5x5 simple island
export function createIslandMap(): TestMapData {
  // prettier-ignore
  const grid = [
    W, W, W, W, W,
    W, L, L, L, W,
    W, L, L, L, W,
    W, L, L, L, W,
    W, W, W, W, W,
  ];
  return { width: 5, height: 5, grid };
}

// Create Game from test map data (computes shoreline bits)
export function createGame(data: TestMapData): Game {
  const { width, height, grid } = data;

  // Convert string grid to terrain bytes
  const terrain = new Uint8Array(width * height);
  let numLand = 0;

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === L) {
      terrain[i] = LAND_BIT;
      numLand++;
    } else {
      terrain[i] = WATER_BIT;
    }
  }

  computeShoreline(terrain, width, height);

  const gameMap = new GameMapImpl(width, height, terrain, numLand);

  // Create miniMap (2x2→1, water if ANY water)
  const miniWidth = Math.ceil(width / 2);
  const miniHeight = Math.ceil(height / 2);
  const miniTerrain = new Uint8Array(miniWidth * miniHeight);
  let miniNumLand = 0;

  for (let my = 0; my < miniHeight; my++) {
    for (let mx = 0; mx < miniWidth; mx++) {
      const mIdx = my * miniWidth + mx;
      let hasWater = false;

      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = mx * 2 + dx;
          const y = my * 2 + dy;
          if (x < width && y < height && !(terrain[y * width + x] & LAND_BIT)) {
            hasWater = true;
          }
        }
      }

      if (hasWater) {
        miniTerrain[mIdx] = WATER_BIT;
      } else {
        miniTerrain[mIdx] = LAND_BIT;
        miniNumLand++;
      }
    }
  }

  computeShoreline(miniTerrain, miniWidth, miniHeight);

  const miniGameMap = new GameMapImpl(
    miniWidth,
    miniHeight,
    miniTerrain,
    miniNumLand,
  );

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
    lobbyStartDelayMs: 60000,
  };
  const config = new TestConfig(
    serverConfig,
    gameConfig,
    new UserSettings(),
    false,
  );

  return createGameImpl([], [], gameMap, miniGameMap, config);
}

// Create GameMapImpl from test map data (for map-only tests)
export function createGameMap(data: TestMapData): GameMapImpl {
  const { width, height, grid } = data;

  const terrain = new Uint8Array(width * height);
  let numLand = 0;

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === L) {
      terrain[i] = LAND_BIT;
      numLand++;
    } else {
      terrain[i] = WATER_BIT;
    }
  }

  computeShoreline(terrain, width, height);

  return new GameMapImpl(width, height, terrain, numLand);
}
