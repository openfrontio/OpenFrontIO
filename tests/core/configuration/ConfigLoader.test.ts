import { beforeEach, describe, expect, test, vi } from "vitest";
import { GameEnv } from "../../../src/core/configuration/Config";
import {
  clearCachedRuntimeClientServerConfig,
  GameLogicEnv,
  getBuildTimeGameLogicEnv,
  getGameLogicConfig,
  getRuntimeClientServerConfig,
  getServerConfigForGameLogicEnv,
} from "../../../src/core/configuration/ConfigLoader";

describe("ConfigLoader", () => {
  const originalGameEnv = process.env.GAME_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.BOOTSTRAP_CONFIG = undefined;
    process.env.GAME_ENV = originalGameEnv;
    clearCachedRuntimeClientServerConfig();
  });

  test("uses runtime bootstrap config without fetching /api/env", async () => {
    window.BOOTSTRAP_CONFIG = { gameEnv: "staging" };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const config = await getRuntimeClientServerConfig();

    expect(config.env()).toBe(GameEnv.Preprod);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("maps staging builds to the default game logic config", async () => {
    process.env.GAME_ENV = "staging";

    expect(getBuildTimeGameLogicEnv()).toBe(GameLogicEnv.Default);
    expect(getServerConfigForGameLogicEnv(GameLogicEnv.Default).env()).toBe(
      GameEnv.Prod,
    );

    const config = await getGameLogicConfig({} as any, null);

    expect(config.serverConfig().env()).toBe(GameEnv.Prod);
  });
});
