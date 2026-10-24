import { PlayerInfo, PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  GameConfig,
  GameConfigSchema,
} from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { EngineConfig } from "@openfront/engine/configuration/EngineConfig";
import { Player } from "@openfront/engine/game/Game";
import { describe, expect, it } from "vitest";

// A Player stub with just what the cheat checks and cost wrappers touch.
function playerOf(
  clientID: string | null,
  isLobbyCreator = false,
): Player {
  return {
    clientID: () => clientID,
    type: () => PlayerType.Human,
    isLobbyCreator: () => isLobbyCreator,
    unitsOwned: () => 0,
    unitsConstructed: () => 0,
  } as unknown as Player;
}

const CHEAT_CID = "cheat000";

function cheatConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    cheatPlayerIds: [CHEAT_CID],
    ...overrides,
  } as unknown as GameConfig;
}

describe("EngineConfig - cheatPlayerIds (account-bound cheats)", () => {
  const engine = new EngineConfig(cheatConfig(), false);

  it("gives a listed non-creator 1,000,000 start manpower", () => {
    const info = new PlayerInfo(
      "Cheater",
      PlayerType.Human,
      CHEAT_CID,
      "pid-cheat",
      false,
    );
    expect(engine.startManpower(info)).toBe(1_000_000);
  });

  it("gives unlisted players the default 25,000 start manpower", () => {
    const info = new PlayerInfo(
      "Other",
      PlayerType.Human,
      "other000",
      "pid-other",
      false,
    );
    expect(engine.startManpower(info)).toBe(25_000);
  });

  it("gives a listed non-creator free unit costs", () => {
    const cost = engine.unitInfo(UnitType.City).cost(null as never, playerOf(CHEAT_CID));
    expect(cost).toBe(0n);
  });

  it("gives a listed player a free MIRV", () => {
    const game = { mirvsLaunched: () => 0 };
    const cost = engine
      .unitInfo(UnitType.MIRV)
      .cost(game as never, playerOf(CHEAT_CID));
    expect(cost).toBe(0n);
  });

  it("keeps normal unit costs for unlisted players", () => {
    const cost = engine.unitInfo(UnitType.City).cost(null as never, playerOf("other000"));
    expect(cost).toBe(125_000n);
  });

  it("ignores bots (null clientID)", () => {
    const info = new PlayerInfo(
      "Bot",
      PlayerType.Bot,
      null,
      "pid-bot",
      false,
    );
    expect(engine.startManpower(info)).toBe(10_000);
    const cost = engine.unitInfo(UnitType.City).cost(null as never, playerOf(null));
    expect(cost).toBe(125_000n);
  });

  it("still honours creator-bound host cheats alongside the list", () => {
    const hostEngine = new EngineConfig(
      cheatConfig({ hostCheats: { infiniteGold: true, infiniteTroops: true } }),
      false,
    );
    const creator = new PlayerInfo(
      "Host",
      PlayerType.Human,
      "host0000",
      "pid-host",
      true,
    );
    expect(hostEngine.startManpower(creator)).toBe(1_000_000);
    // A listed non-creator still gets the account-bound privileges.
    const listed = new PlayerInfo(
      "Cheater",
      PlayerType.Human,
      CHEAT_CID,
      "pid-cheat",
      false,
    );
    expect(hostEngine.startManpower(listed)).toBe(1_000_000);
  });

  it("roundtrips cheatPlayerIds through GameConfigSchema", () => {
    const parsed = GameConfigSchema.parse({
      gameMap: "World",
      gameMapSize: "Normal",
      difficulty: "Medium",
      gameType: "Public",
      gameMode: "Free For All",
      donateGold: true,
      donateTroops: true,
      nations: "default",
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
      cheatPlayerIds: ["abc12345", "def67890"],
    });
    expect(parsed.cheatPlayerIds).toEqual(["abc12345", "def67890"]);
  });

  it("makes cheatPlayerIds optional in GameConfigSchema", () => {
    const parsed = GameConfigSchema.parse({
      gameMap: "World",
      gameMapSize: "Normal",
      difficulty: "Medium",
      gameType: "Public",
      gameMode: "Free For All",
      donateGold: true,
      donateTroops: true,
      nations: "default",
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    });
    expect(parsed.cheatPlayerIds).toBeUndefined();
  });

  it("shares unit stats with the base Config when cheats are configured", () => {
    const shared = new Config(cheatConfig(), false);
    for (const type of Object.values(UnitType)) {
      const { cost, ...stats } = engine.unitInfo(type);
      expect(stats).toEqual(shared.unitInfo(type));
      expect(typeof cost).toBe("function");
    }
  });
});
