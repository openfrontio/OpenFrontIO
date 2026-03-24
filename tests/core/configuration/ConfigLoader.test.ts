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
    process.env.GAME_ENV = originalGameEnv;
    clearCachedServerConfig();
  });

  test("uses bundled GAME_ENV without fetching /api/env", async () => {
    process.env.GAME_ENV = "prod";
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const config = await getServerConfigFromClient();

    expect(config.env()).toBe(GameEnv.Prod);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
