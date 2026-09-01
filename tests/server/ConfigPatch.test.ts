import { describe, expect, it } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../../src/core/game/Game";
import { GameConfig } from "../../src/core/Schemas";
import {
  applyGameConfigPatch,
  hostCheatsEnabled,
} from "../../src/server/ConfigPatch";
import { testGameConfig } from "../util/Wire";

// One value per key the host may edit, each different from testGameConfig's
// default so a copy is observable.
const EDITABLE: { [K in keyof GameConfig]?: GameConfig[K] } = {
  gameMap: GameMapType.Europe,
  gameMapSize: GameMapSize.Compact,
  difficulty: Difficulty.Hard,
  nations: "disabled",
  bots: 42,
  infiniteGold: true,
  donateGold: false,
  infiniteTroops: true,
  donateTroops: false,
  instantBuild: true,
  randomSpawn: true,
  gameMode: GameMode.Team,
  disabledUnits: [UnitType.AtomBomb],
  playerTeams: 3,
  allowedPublicIds: ["pub-a"],
  trusted: true,
  doomsdayClock: { enabled: true, speed: "fast" },
  overtime: { enabled: true, startMinutes: 20 },
  anonymizeNames: true,
  nameReveals: ["c1000000"],
  nameRevealPublicIds: ["pub-b"],
};

// `.nullable().optional()` in the schema: null clears, undefined leaves alone.
const NULLABLE: { [K in keyof GameConfig]?: NonNullable<GameConfig[K]> } = {
  maxTimerValue: 30,
  startDelay: 10,
  spawnImmunityDuration: 50,
  goldMultiplier: 2,
  startingGold: 1000,
  disableAlliances: true,
  customAllianceDuration: 5,
  waterNukes: true,
};

describe("applyGameConfigPatch", () => {
  it.each(Object.entries(EDITABLE))(
    "copies %s when the patch carries it",
    (key, value) => {
      const target = testGameConfig();
      applyGameConfigPatch(target, { [key]: value });
      expect(target[key as keyof GameConfig]).toEqual(value);
    },
  );

  it("leaves every key alone when the patch omits it", () => {
    const target = testGameConfig({ ...EDITABLE, ...NULLABLE });
    const before = structuredClone(target);
    applyGameConfigPatch(target, {});
    expect(target).toEqual({ ...before, hostCheats: undefined });
  });

  it.each(Object.entries(NULLABLE))(
    "sets %s from a value and clears it to undefined from null",
    (key, value) => {
      const target = testGameConfig();
      applyGameConfigPatch(target, { [key]: value });
      expect(target[key as keyof GameConfig]).toEqual(value);

      applyGameConfigPatch(target, { [key]: null });
      expect(key in target).toBe(true);
      expect(target[key as keyof GameConfig]).toBeUndefined();
    },
  );

  it("replaces hostCheats unconditionally, so omitting it clears it", () => {
    // The host's full config carries hostCheats: undefined when the toggle
    // is off; that has to clear, not preserve.
    const target = testGameConfig({ hostCheats: { infiniteGold: true } });
    applyGameConfigPatch(target, { bots: 1 });
    expect(target.hostCheats).toBeUndefined();

    applyGameConfigPatch(target, { hostCheats: { startingGold: 5 } });
    expect(target.hostCheats).toEqual({ startingGold: 5 });
  });

  it("ignores gameType and maxPlayers, which have their own guarded paths", () => {
    const target = testGameConfig({
      gameType: GameType.Private,
      maxPlayers: 4,
    });
    applyGameConfigPatch(target, { gameType: GameType.Public, maxPlayers: 99 });
    expect(target.gameType).toBe(GameType.Private);
    expect(target.maxPlayers).toBe(4);
  });

  it("ignores keys that are not part of GameConfig at all", () => {
    // e.g. the listing flag, which lives on the GameServer, not the config.
    const target = testGameConfig();
    applyGameConfigPatch(target, { listed: true } as Partial<GameConfig>);
    expect("listed" in target).toBe(false);
  });
});

describe("hostCheatsEnabled", () => {
  it("is off without a block, or with a block that grants nothing", () => {
    expect(hostCheatsEnabled(undefined)).toBe(false);
    expect(hostCheatsEnabled({})).toBe(false);
    expect(
      hostCheatsEnabled({
        infiniteGold: false,
        infiniteTroops: false,
        goldMultiplier: null,
        startingGold: null,
      }),
    ).toBe(false);
  });

  it.each([
    { infiniteGold: true },
    { infiniteTroops: true },
    { goldMultiplier: 1 },
    { startingGold: 0 },
  ])("is on when %o grants something", (block) => {
    expect(hostCheatsEnabled(block)).toBe(true);
  });
});
