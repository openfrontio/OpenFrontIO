import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { GameConfig } from "../src/core/Schemas";

// The "custom alliances" lobby control writes customAllianceDuration (minutes):
// 0 disables alliances, 1-15 sets the alliance duration, unset = default.
function cfg(over: Partial<GameConfig>): Config {
  return new Config(over as unknown as GameConfig, null, false);
}

describe("custom alliance duration", () => {
  it("0 minutes disables alliances", () => {
    expect(cfg({ customAllianceDuration: 0 }).disableAlliances()).toBe(true);
  });

  it("a positive value keeps alliances on, minutes converted to ticks", () => {
    const c = cfg({ customAllianceDuration: 5 });
    expect(c.disableAlliances()).toBe(false);
    expect(c.allianceDuration()).toBe(5 * 60 * 10);
  });

  it("15 minutes (the max) converts correctly", () => {
    expect(cfg({ customAllianceDuration: 15 }).allianceDuration()).toBe(
      15 * 60 * 10,
    );
  });

  it("unset falls back to the 5 minute default with alliances on", () => {
    const c = cfg({});
    expect(c.disableAlliances()).toBe(false);
    expect(c.allianceDuration()).toBe(300 * 10);
  });

  it("the legacy disableAlliances boolean still disables", () => {
    expect(cfg({ disableAlliances: true }).disableAlliances()).toBe(true);
  });
});
