import { GameConfig } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { describe, expect, it } from "vitest";

const dummyGameConfig = {} as unknown as GameConfig;

describe("Config.isIntentionalSpectator", () => {
  it("defaults to false when constructor arg is omitted", () => {
    const cfg = new Config(dummyGameConfig, false);
    expect(cfg.isIntentionalSpectator()).toBe(false);
  });

  it("returns false when explicitly set to false", () => {
    const cfg = new Config(dummyGameConfig, false, false, false);
    expect(cfg.isIntentionalSpectator()).toBe(false);
  });

  it("returns true when explicitly set to true", () => {
    const cfg = new Config(dummyGameConfig, false, false, true);
    expect(cfg.isIntentionalSpectator()).toBe(true);
  });
});
