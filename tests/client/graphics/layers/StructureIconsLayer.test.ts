import { describe, expect, test } from "vitest";
import {
  shouldClearNukeGhostInRenderWhenOutOfGold,
  shouldClearNukeGhostWhenOutOfGold,
  shouldPreserveGhostAfterBuild,
} from "../../../../src/client/graphics/layers/StructureIconsLayer";
import { BuildableUnit, UnitType } from "../../../../src/core/game/Game";

/**
 * Tests for StructureIconsLayer edge cases mentioned in comments:
 * - Locked nuke / AtomBomb / HydrogenBomb: when confirming placement (Enter or key),
 *   the ghost is preserved so the user can place multiple nukes or keep the nuke
 *   selected. Other structure types clear the ghost after placement.
 */
describe("StructureIconsLayer ghost preservation (locked nuke / Enter confirm)", () => {
  describe("shouldPreserveGhostAfterBuild", () => {
    test("returns true for AtomBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.AtomBomb)).toBe(true);
    });

    test("returns true for HydrogenBomb so ghost is not cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.HydrogenBomb)).toBe(true);
    });

    test("returns false for City so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.City)).toBe(false);
    });

    test("returns false for Factory so ghost is cleared after placement", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Factory)).toBe(false);
    });

    test("returns false for other buildable types (Port, DefensePost, MissileSilo, SAMLauncher, Warship, MIRV)", () => {
      expect(shouldPreserveGhostAfterBuild(UnitType.Port)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.DefensePost)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MissileSilo)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.SAMLauncher)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.Warship)).toBe(false);
      expect(shouldPreserveGhostAfterBuild(UnitType.MIRV)).toBe(false);
    });
  });
});

function nukeBuildable(
  type: UnitType.AtomBomb | UnitType.HydrogenBomb,
  overrides: Partial<BuildableUnit> = {},
): BuildableUnit {
  return {
    type,
    canBuild: false,
    canUpgrade: false,
    cost: 100n,
    overlappingRailroads: [],
    ghostRailPaths: [],
    ...overrides,
  };
}

describe("shouldClearNukeGhostWhenOutOfGold", () => {
  test("returns true for atom bomb ghost when player gold is less than cost", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    const player = { gold: () => 50n };
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.AtomBomb, unit, player),
    ).toBe(true);
  });

  test("returns true for hydrogen bomb ghost when player gold is less than cost", () => {
    const unit = nukeBuildable(UnitType.HydrogenBomb, { cost: 200n });
    const player = { gold: () => 0n };
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.HydrogenBomb, unit, player),
    ).toBe(true);
  });

  test("returns false when player can afford the nuke (gold >= cost)", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    const player = { gold: () => 100n };
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.AtomBomb, unit, player),
    ).toBe(false);
  });

  test("returns false when ghost is not a nuke type", () => {
    const unit: BuildableUnit = {
      type: UnitType.City,
      canBuild: false,
      canUpgrade: false,
      cost: 50n,
      overlappingRailroads: [],
      ghostRailPaths: [],
    };
    const player = { gold: () => 0n };
    expect(shouldClearNukeGhostWhenOutOfGold(UnitType.City, unit, player)).toBe(
      false,
    );
  });

  test("returns false when unit canBuild is not false (e.g. can place)", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, {
      canBuild: 0 as BuildableUnit["canBuild"],
    });
    const player = { gold: () => 50n };
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.AtomBomb, unit, player),
    ).toBe(false);
  });

  test("returns false when player is null", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.AtomBomb, unit, null),
    ).toBe(false);
  });

  test("treats undefined cost as 0 (player with 0 gold does not clear)", () => {
    const unit = nukeBuildable(UnitType.HydrogenBomb);
    (unit as { cost?: bigint }).cost = undefined;
    const player = { gold: () => 0n };
    expect(
      shouldClearNukeGhostWhenOutOfGold(UnitType.HydrogenBomb, unit, player),
    ).toBe(false);
  });
});

describe("shouldClearNukeGhostInRenderWhenOutOfGold", () => {
  test("does not clear when user has not placed a nuke yet (press 8 with no gold → no flash)", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    const player = { gold: () => 50n };
    expect(
      shouldClearNukeGhostInRenderWhenOutOfGold(
        false,
        UnitType.AtomBomb,
        unit,
        player,
      ),
    ).toBe(false);
  });

  test("clears when user has placed at least one nuke and then runs out of gold", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    const player = { gold: () => 50n };
    expect(
      shouldClearNukeGhostInRenderWhenOutOfGold(
        true,
        UnitType.AtomBomb,
        unit,
        player,
      ),
    ).toBe(true);
  });

  test("does not clear when user has placed a nuke but can still afford another", () => {
    const unit = nukeBuildable(UnitType.AtomBomb, { cost: 100n });
    const player = { gold: () => 200n };
    expect(
      shouldClearNukeGhostInRenderWhenOutOfGold(
        true,
        UnitType.AtomBomb,
        unit,
        player,
      ),
    ).toBe(false);
  });
});
