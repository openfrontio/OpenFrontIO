import { ClientEnv } from "src/client/ClientEnv";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GameEnv } from "../../../src/core/configuration/Config";

describe("ClientEnv", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
  });

  test("reads from window.BOOTSTRAP_CONFIG without fetching", () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "staging",
      numWorkers: 4,
      turnstileSiteKey: "test-key",
      jwtAudience: "openfront.dev",
      instanceId: "TEST_ID",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(ClientEnv.env()).toBe(GameEnv.Preprod);
    expect(ClientEnv.numWorkers()).toBe(4);
    expect(ClientEnv.turnstileSiteKey()).toBe("test-key");
    expect(ClientEnv.jwtAudience()).toBe("openfront.dev");
    expect(ClientEnv.instanceId()).toBe("TEST_ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
