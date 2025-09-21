import fs from "fs";
import path from "path";
import {
  Difficulty,
  Game,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { createGame } from "../src/core/game/GameImpl";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";
import { UserSettings } from "../src/core/game/UserSettings";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { GameConfig } from "../src/core/Schemas";
import { simpleHash } from "../src/core/Util";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { TestServerConfig } from "./util/TestServerConfig";

describe("RandomGeneration", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains");
  });

  describe("createRandom", () => {
    it("should generate different seeds for different unique IDs", () => {
      const random1 = game.createRandom("test1");
      const random2 = game.createRandom("test2");

      const value1 = random1.next();
      const value2 = random2.next();

      expect(value1).not.toBe(value2);
    });

    it("should generate different seeds for same ID called multiple times", () => {
      const random1 = game.createRandom("test");
      const random2 = game.createRandom("test");

      const value1 = random1.next();
      const value2 = random2.next();

      expect(value1).not.toBe(value2);
    });

    it("should generate consistent random sequences for the same seed", () => {
      const seed = 12345;
      const random1 = new PseudoRandom(seed);
      const random2 = new PseudoRandom(seed);

      expect(random1.next()).toBe(random2.next());
      expect(random1.next()).toBe(random2.next());
      expect(random1.nextInt(0, 100)).toBe(random2.nextInt(0, 100));
    });

    it("should use location-based unique IDs effectively", () => {
      const portRandom1 = game.createRandom(`port_5_5`);
      const portRandom2 = game.createRandom(`port_7_8`);
      const warshipRandom = game.createRandom(`warship_3_4`);

      const val1 = portRandom1.next();
      const val2 = portRandom2.next();
      const val3 = warshipRandom.next();

      expect(val1).not.toBe(val2);
      expect(val2).not.toBe(val3);
      expect(val1).not.toBe(val3);
    });

    it("should handle many random generators without collisions", () => {
      const randoms: PseudoRandom[] = [];
      const values: Set<number> = new Set();

      for (let i = 0; i < 100; i++) {
        const random = game.createRandom(`test_${i}`);
        randoms.push(random);

        const value = random.next();
        values.add(value);
      }

      expect(values.size).toBeGreaterThan(90);
    });
  });

  describe("Execution integration", () => {
    it("should prevent synchronized patterns in same-tick creations", () => {
      const random1 = game.createRandom(`port_0_0`);
      const random2 = game.createRandom(`port_1_1`);
      const random3 = game.createRandom(`warship_2_2`);

      const val1 = random1.nextInt(0, 1000);
      const val2 = random2.nextInt(0, 1000);
      const val3 = random3.nextInt(0, 1000);

      const allSame = val1 === val2 && val2 === val3;
      expect(allSame).toBe(false);
    });
  });

  describe("Deterministic game creation", () => {
    it("should create identical random sequences with the same seed", async () => {
      const mapBinPath = path.join(__dirname, "testdata/maps/plains/map.bin");
      const miniMapBinPath = path.join(
        __dirname,
        "testdata/maps/plains/mini_map.bin",
      );
      const manifestPath = path.join(
        __dirname,
        "testdata/maps/plains/manifest.json",
      );

      const mapBinBuffer = fs.readFileSync(mapBinPath);
      const miniMapBinBuffer = fs.readFileSync(miniMapBinPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
      const miniGameMap = await genTerrainFromBin(
        manifest.mini_map,
        miniMapBinBuffer,
      );

      const serverConfig = new TestServerConfig();
      const gameConfig: GameConfig = {
        gameMap: GameMapType.Asia,
        gameMode: GameMode.FFA,
        gameType: GameType.Singleplayer,
        difficulty: Difficulty.Medium,
        disableNPCs: false,
        donateGold: false,
        donateTroops: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
      };
      const config = new TestConfig(
        serverConfig,
        gameConfig,
        new UserSettings(),
        false,
      );

      const humans = [
        new PlayerInfo("player1", PlayerType.Human, null, "player1"),
      ];

      const seed = simpleHash("test_game_123");

      const game1 = createGame(humans, [], gameMap, miniGameMap, config, seed);
      const game2 = createGame(humans, [], gameMap, miniGameMap, config, seed);

      const random1a = game1.createRandom("test");
      const random2a = game2.createRandom("test");

      expect(random1a.next()).toBe(random2a.next());
      expect(random1a.next()).toBe(random2a.next());

      const random1b = game1.createRandom("another");
      const random2b = game2.createRandom("another");

      expect(random1b.next()).toBe(random2b.next());
      expect(random1b.nextInt(0, 100)).toBe(random2b.nextInt(0, 100));
    });

    it("should create different random sequences with different seeds", async () => {
      const mapBinPath = path.join(__dirname, "testdata/maps/plains/map.bin");
      const miniMapBinPath = path.join(
        __dirname,
        "testdata/maps/plains/mini_map.bin",
      );
      const manifestPath = path.join(
        __dirname,
        "testdata/maps/plains/manifest.json",
      );

      const mapBinBuffer = fs.readFileSync(mapBinPath);
      const miniMapBinBuffer = fs.readFileSync(miniMapBinPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

      const gameMap = await genTerrainFromBin(manifest.map, mapBinBuffer);
      const miniGameMap = await genTerrainFromBin(
        manifest.mini_map,
        miniMapBinBuffer,
      );

      const serverConfig = new TestServerConfig();
      const gameConfig: GameConfig = {
        gameMap: GameMapType.Asia,
        gameMode: GameMode.FFA,
        gameType: GameType.Singleplayer,
        difficulty: Difficulty.Medium,
        disableNPCs: false,
        donateGold: false,
        donateTroops: false,
        bots: 0,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
      };
      const config = new TestConfig(
        serverConfig,
        gameConfig,
        new UserSettings(),
        false,
      );

      const humans = [
        new PlayerInfo("player1", PlayerType.Human, null, "player1"),
      ];

      const seed1 = simpleHash("test_game_123");
      const seed2 = simpleHash("test_game_456");

      const game1 = createGame(humans, [], gameMap, miniGameMap, config, seed1);
      const game2 = createGame(humans, [], gameMap, miniGameMap, config, seed2);

      const random1 = game1.createRandom("test");
      const random2 = game2.createRandom("test");

      expect(random1.next()).not.toBe(random2.next());
    });
  });
});
