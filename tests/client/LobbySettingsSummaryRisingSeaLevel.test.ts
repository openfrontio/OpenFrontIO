import { describe, expect, it } from "vitest";
import { notableLobbySettings } from "../../src/client/utilities/LobbySettingsSummary";
import { GameConfig } from "../../src/core/Schemas";

// A joiner decides whether to take a lobby slot from this summary, so a mode as
// consequential as a rising sea must show up there with its preset.
//
// No locale is loaded here, so translateText() renders the bare key.
describe("rising sea level in the lobby settings summary", () => {
  function summary(c: Partial<GameConfig>): { label: string; value: string }[] {
    return notableLobbySettings(c as GameConfig, null);
  }

  function row(c: Partial<GameConfig>) {
    return summary(c).find((i) => i.label === "game_settings.rising_sea_level");
  }

  it("names the preset the host picked", () => {
    expect(row({ risingSeaLevel: { enabled: true, speed: "fast" } })).toEqual({
      label: "game_settings.rising_sea_level",
      value: "rising_sea_level_speed.fast",
    });
  });

  it("falls back to the preset the sim defaults to", () => {
    // Config.risingSeaLevelConfig() resolves a missing speed to "normal", so the
    // summary must not advertise a different one.
    expect(row({ risingSeaLevel: { enabled: true } })?.value).toBe(
      "rising_sea_level_speed.normal",
    );
  });

  it("says nothing when the mode is off", () => {
    // Both shapes the lobby can send: the explicit {enabled:false} it uses to
    // turn the mode off, and an absent key.
    expect(row({ risingSeaLevel: { enabled: false } })).toBeUndefined();
    expect(
      row({ risingSeaLevel: { enabled: false, speed: "fast" } }),
    ).toBeUndefined();
    expect(row({})).toBeUndefined();
  });
});
