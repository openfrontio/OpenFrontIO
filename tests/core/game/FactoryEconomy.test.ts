import { describe, expect, it } from "vitest";
import { Config } from "../../../src/core/configuration/Config";
import { FactoryExecution } from "../../../src/core/execution/FactoryExecution";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { GameConfig } from "../../../src/core/Schemas";
import { setup } from "../../util/Setup";

function config(goldMultiplier = 1): Config {
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
    disableNavMesh: false,
    randomSpawn: false,
    goldMultiplier,
  };
  return new Config(gameConfig, new UserSettings(), false);
}

function player(researchLevel = 0): Player {
  return {
    isLobbyCreator: () => false,
    researchLevel: () => researchLevel,
  } as unknown as Player;
}

describe("factory economy configuration", () => {
  it("adds deterministic base and direct-connection production", () => {
    const c = config();
    expect(c.factoryGold(1, 0, player())).toBe(1_200n);
    expect(c.factoryGold(1, 3, player())).toBe(5_250n);
  });

  it("uses the strong linear level curve", () => {
    const c = config();
    expect(c.factoryGold(2, 3, player())).toBe(13_125n);
    expect(c.factoryGold(3, 3, player())).toBe(21_000n);
    expect(c.factoryGold(4, 3, player())).toBe(28_875n);
  });

  it("scales the rail-connection bonus with factory level", () => {
    const c = config();
    expect(c.factoryGold(1, 1, player()) - c.factoryGold(1, 0, player())).toBe(
      1_350n,
    );
    expect(c.factoryGold(2, 1, player()) - c.factoryGold(2, 0, player())).toBe(
      3_375n,
    );
    expect(c.factoryGold(3, 1, player()) - c.factoryGold(3, 0, player())).toBe(
      5_400n,
    );
  });

  it("applies Economy research and the global gold multiplier", () => {
    expect(config(2).factoryGold(1, 3, player(1))).toBe(10_762n);
  });

  it("uses a fifteen-second train interval", () => {
    expect(config().trainSpawnIntervalTicks()).toBe(150);
  });

  it("credits live factory production to gold and rail-income totals", async () => {
    const game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("owner", PlayerType.Human, null, "owner_id"),
    ]);
    const owner = game.player("owner_id");
    const tile = game.ref(0, 10);
    owner.conquer(tile);
    const factory = owner.buildUnit(UnitType.Factory, tile, {});
    game.addExecution(new FactoryExecution(factory));

    for (let i = 0; i < 10; i++) game.executeNextTick();

    expect(owner.trainGold()).toBe(1_200n);
  });
});
