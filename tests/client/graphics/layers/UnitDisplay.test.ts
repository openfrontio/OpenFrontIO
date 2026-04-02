import { describe, expect, test } from "vitest";
import { UnitDisplay } from "../../../../src/client/graphics/layers/UnitDisplay";
import { UnitType } from "../../../../src/core/game/Game";

describe("UnitDisplay hoverStructureTypes", () => {
  const unitDisplay = new UnitDisplay() as any;

  test("shows port and naval AA context when hovering warships", () => {
    expect(unitDisplay.hoverStructureTypes(UnitType.Warship)).toEqual([
      UnitType.Port,
      UnitType.Warship,
    ]);
  });

  test("shows silo and SAM context when hovering standard nukes", () => {
    expect(unitDisplay.hoverStructureTypes(UnitType.AtomBomb)).toEqual([
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
    ]);
    expect(unitDisplay.hoverStructureTypes(UnitType.HydrogenBomb)).toEqual([
      UnitType.MissileSilo,
      UnitType.SAMLauncher,
    ]);
  });
});
