import { describe, expect, it } from "vitest";
import { Config } from "../../../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
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
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: true,
    ...overrides,
  };
  return new Config(gameConfig, new UserSettings(), false);
}

describe("Config.percentageTilesOwnedToWin", () => {
  it("returns the override when set", () => {
    expect(
      makeConfig({ percentageTilesOwnedToWin: 99 }).percentageTilesOwnedToWin(),
    ).toBe(99);
  });

  it("returns the override even when it is 0 (falsy but valid)", () => {
    expect(
      makeConfig({ percentageTilesOwnedToWin: 0 }).percentageTilesOwnedToWin(),
    ).toBe(0);
  });

  it("falls back to 80 for FFA when override is undefined", () => {
    expect(
      makeConfig({ gameMode: GameMode.FFA }).percentageTilesOwnedToWin(),
    ).toBe(80);
  });

  it("falls back to 95 for Team when override is undefined", () => {
    expect(
      makeConfig({ gameMode: GameMode.Team }).percentageTilesOwnedToWin(),
    ).toBe(95);
  });
});
