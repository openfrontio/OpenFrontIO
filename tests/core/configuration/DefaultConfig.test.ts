import { GameEnv, ServerConfig } from "../../../src/core/configuration/Config";
import { DefaultConfig } from "../../../src/core/configuration/DefaultConfig";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { GameConfig } from "../../../src/core/Schemas";

type PlayerStubOptions = {
  type?: PlayerType;
  unitsOwned?: number;
};

const stubServerConfig = {
  env: () => GameEnv.Prod,
} as unknown as ServerConfig;

const baseGameConfig: GameConfig = {
  gameMap: GameMapType.Asia,
  difficulty: Difficulty.Medium,
  donateGold: false,
  donateTroops: false,
  gameType: GameType.Singleplayer,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  disableNPCs: false,
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

const createConfig = (overrides: Partial<GameConfig> = {}) =>
  new DefaultConfig(
    stubServerConfig,
    { ...baseGameConfig, ...overrides },
    null,
    false,
  );

const createPlayer = ({
  type = PlayerType.Human,
  unitsOwned = 0,
}: PlayerStubOptions = {}): Player =>
  ({
    type: () => type,
    unitsOwned: () => unitsOwned,
  }) as unknown as Player;

describe("DefaultConfig SAM economics", () => {
  test("first SAM costs 1.5M and subsequent SAMs cost 3M", () => {
    const config = createConfig();

    const firstSamPlayer = createPlayer({ unitsOwned: 0 });
    expect(config.samBuildCost(firstSamPlayer)).toBe(1_500_000n);
    expect(config.unitInfo(UnitType.SAMLauncher).cost(firstSamPlayer)).toBe(
      1_500_000n,
    );

    const stackedSamPlayer = createPlayer({ unitsOwned: 1 });
    expect(config.samBuildCost(stackedSamPlayer)).toBe(3_000_000n);
    expect(config.unitInfo(UnitType.SAMLauncher).cost(stackedSamPlayer)).toBe(
      3_000_000n,
    );
  });

  test("SAM build and upgrade costs are zero for humans with infinite gold", () => {
    const config = createConfig({ infiniteGold: true });
    const richHuman = createPlayer({ unitsOwned: 5 });

    expect(config.unitInfo(UnitType.SAMLauncher).cost(richHuman)).toBe(0n);
    expect(config.samUpgradeCost(richHuman, 1)).toBe(0n);
    expect(config.samUpgradeCost(richHuman, 2)).toBe(0n);
  });

  test("SAM upgrade cost tiers escalate to level 3 then stop", () => {
    const config = createConfig();
    const defender = createPlayer();

    expect(config.samUpgradeCost(defender, 1)).toBe(3_000_000n);
    expect(config.samUpgradeCost(defender, 2)).toBe(6_000_000n);
    expect(config.samUpgradeCost(defender, 3)).toBe(0n);
  });
});

describe("DefaultConfig SAM range progression", () => {
  test("range scales with level and clamps to hydrogen range", () => {
    const config = createConfig();

    expect(config.samRange(0)).toBe(70);
    expect(config.samRange(1)).toBe(70);
    expect(config.samRange(2)).toBe(85);
    expect(config.samRange(3)).toBe(100);
    expect(config.samRange(4)).toBe(100);
    expect(config.maxSamRange()).toBe(100);
    expect(config.samMaxLevel()).toBe(3);
  });
});
