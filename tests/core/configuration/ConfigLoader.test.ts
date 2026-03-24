import { beforeEach, describe, expect, test, vi } from "vitest";
import { GameEnv } from "../../../src/core/configuration/Config";
import {
  clearCachedServerConfig,
  getServerConfigFromClient,
} from "../../../src/core/configuration/ConfigLoader";

describe("ConfigLoader", () => {
  const originalGameEnv = process.env.GAME_ENV;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.BOOTSTRAP_CONFIG = undefined;
    process.env.GAME_ENV = originalGameEnv;
    clearCachedServerConfig();
  });

  test("uses bootstrap config without fetching /api/env", async () => {
    window.BOOTSTRAP_CONFIG = { gameEnv: "prod" };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const config = await getServerConfigFromClient();

    expect(config.env()).toBe(GameEnv.Prod);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("falls back to bundled env when bootstrap config is unavailable", async () => {
    process.env.GAME_ENV = "prod";

    const config = await getServerConfigFromClient();

    expect(config.env()).toBe(GameEnv.Prod);
  });
});
