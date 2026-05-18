import { ClientEnv } from "src/client/ClientEnv";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GameEnv, parseGameEnv } from "../../../src/core/configuration/Config";

describe("parseGameEnv", () => {
  test("maps 'dev' to GameEnv.Dev", () => {
    expect(parseGameEnv("dev")).toBe(GameEnv.Dev);
  });
  test("maps 'staging' to GameEnv.Preprod", () => {
    expect(parseGameEnv("staging")).toBe(GameEnv.Preprod);
  });
  test("maps 'prod' to GameEnv.Prod", () => {
    expect(parseGameEnv("prod")).toBe(GameEnv.Prod);
  });
  test("throws on undefined", () => {
    expect(() => parseGameEnv(undefined)).toThrow(/unsupported game env/);
  });
  test("throws on unknown value", () => {
    expect(() => parseGameEnv("production")).toThrow(/unsupported game env/);
  });
});

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
      gitCommit: "abc123",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(ClientEnv.env()).toBe(GameEnv.Preprod);
    expect(ClientEnv.numWorkers()).toBe(4);
    expect(ClientEnv.turnstileSiteKey()).toBe("test-key");
    expect(ClientEnv.jwtAudience()).toBe("openfront.dev");
    expect(ClientEnv.instanceId()).toBe("TEST_ID");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("throws when BOOTSTRAP_CONFIG is undefined", () => {
    expect(() => ClientEnv.env()).toThrow(/Missing BOOTSTRAP_CONFIG/);
  });

  test("throws when a required field is missing", () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "k",
      jwtAudience: "localhost",
      // instanceId missing
    };
    expect(() => ClientEnv.instanceId()).toThrow(/Missing BOOTSTRAP_CONFIG/);
  });

  test("jwtIssuer maps 'localhost' to http://localhost:8787", () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "k",
      jwtAudience: "localhost",
      instanceId: "x",
      gitCommit: "DEV",
    };
    expect(ClientEnv.jwtIssuer()).toBe("http://localhost:8787");
  });

  test("jwtIssuer derives api.<audience> for non-localhost", () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "k",
      jwtAudience: "openfront.io",
      instanceId: "x",
      gitCommit: "abc123",
    };
    expect(ClientEnv.jwtIssuer()).toBe("https://api.openfront.io");
  });
});
