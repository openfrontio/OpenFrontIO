import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { UnitType } from "../src/core/game/Game";
import { GameConfig } from "../src/core/Schemas";

const cfg = new Config({} as unknown as GameConfig, null, false);

describe("nukeSpeed", () => {
  it("maps each nuke type to its speed", () => {
    expect(cfg.nukeSpeed(UnitType.AtomBomb)).toBe(10);
    expect(cfg.nukeSpeed(UnitType.HydrogenBomb)).toBe(10);
    expect(cfg.nukeSpeed(UnitType.MIRV)).toBe(15);
    expect(cfg.nukeSpeed(UnitType.MIRVWarhead)).toBe(22);
  });

  it("throws for non-nuke unit types", () => {
    expect(() => cfg.nukeSpeed(UnitType.Warship)).toThrow();
  });
});
