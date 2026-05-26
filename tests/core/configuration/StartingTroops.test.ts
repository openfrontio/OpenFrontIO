import { describe, expect, it } from "vitest";
import { Config } from "../../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";

function makeConfig(overrides: Partial<GameConfig> = {}): Config {
  const gameConfig: GameConfig = {
    gameMap: GameMapType.Iceland,
    gameMapSize: GameMapSize.Compact,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: Difficulty.Easy,
    nations: "disabled",
    donateGold: false,
    donateTroops: false,
    bots: 0,
    infiniteGold: true,
    infiniteTroops: true,
    instantBuild: false,
    randomSpawn: true,
    ...overrides,
  };
  return new Config(gameConfig, new UserSettings(), false);
}

const humanInfo = (): PlayerInfo =>
  new PlayerInfo("test", PlayerType.Human, "client1", "p1", false, null, []);

describe("Config.startManpower with startingTroops override", () => {
  it("uses startingTroops when set", () => {
    const config = makeConfig({ startingTroops: 10_000_000 });
    expect(config.startManpower(humanInfo())).toBe(10_000_000);
  });

  it("falls back to 1_000_000 for infinite-troops human when override is absent", () => {
    const config = makeConfig({ infiniteTroops: true });
    expect(config.startManpower(humanInfo())).toBe(1_000_000);
  });
});
