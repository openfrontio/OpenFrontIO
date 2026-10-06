import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { describe, expect, it } from "vitest";

const cfg = new Config({} as unknown as GameConfig, false);

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
