import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { GameConfig } from "../src/core/Schemas";

const dummyGameConfig = {} as unknown as GameConfig;

describe("Config.isIntentionalSpectator", () => {
  it("defaults to false when constructor arg is omitted", () => {
    const cfg = new Config(dummyGameConfig, null, false);
    expect(cfg.isIntentionalSpectator()).toBe(false);
  });

  it("returns false when explicitly set to false", () => {
    const cfg = new Config(dummyGameConfig, null, false, false, false);
    expect(cfg.isIntentionalSpectator()).toBe(false);
  });

  it("returns true when explicitly set to true", () => {
    const cfg = new Config(dummyGameConfig, null, false, false, true);
    expect(cfg.isIntentionalSpectator()).toBe(true);
  });
});
