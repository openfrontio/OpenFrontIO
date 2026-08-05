import { describe, expect, test } from "vitest";
import {
  chooseMissileSilo,
  isPlayerMissileType,
  isReadyMissileSilo,
  samThreatensNukePreview,
  shouldPreserveGhostAfterBuild,
} from "../../../src/client/controllers/BuildPreviewController";
import { UnitType } from "../../../src/core/game/Game";

describe("BuildPreviewController ghost preservation (locked nuke / Enter confirm)", () => {
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

describe("missile silo source selection", () => {
  test("recognizes every player-aimed missile type", () => {
    expect(isPlayerMissileType(UnitType.AtomBomb)).toBe(true);
    expect(isPlayerMissileType(UnitType.HydrogenBomb)).toBe(true);
    expect(isPlayerMissileType(UnitType.MIRV)).toBe(true);
    expect(isPlayerMissileType(UnitType.MIRVWarhead)).toBe(false);
    expect(isPlayerMissileType(UnitType.MissileSilo)).toBe(false);
  });

  test("only active, completed silos with capacity are selectable", () => {
    const silo = (
      active: boolean,
      cooldown: boolean,
      underConstruction: boolean,
    ) => ({
      isActive: () => active,
      isInCooldown: () => cooldown,
      isUnderConstruction: () => underConstruction,
    });

    expect(isReadyMissileSilo(silo(true, false, false))).toBe(true);
    expect(isReadyMissileSilo(silo(false, false, false))).toBe(false);
    expect(isReadyMissileSilo(silo(true, true, false))).toBe(false);
    expect(isReadyMissileSilo(silo(true, false, true))).toBe(false);
  });

  test("explicit selection overrides the nearest-silo default", () => {
    const silos = [
      { id: () => 11, distance: 2 },
      { id: () => 22, distance: 20 },
    ];

    expect(chooseMissileSilo(silos, null, (s) => s.distance)?.id()).toBe(11);
    expect(chooseMissileSilo(silos, 22, (s) => s.distance)?.id()).toBe(22);
    expect(chooseMissileSilo(silos, 99, (s) => s.distance)).toBeUndefined();
  });
});

describe("samThreatensNukePreview (nuke trajectory threat set, #4226)", () => {
  const teammates = new Set([7, 8]);
  const allies = new Set([2, 3]);

  test("non-friendly SAM threatens the trajectory", () => {
    expect(samThreatensNukePreview(5, teammates, allies, new Set())).toBe(true);
  });

  test("allied SAM does not threaten when the strike breaks no alliance", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set())).toBe(
      false,
    );
  });

  test("would-be-betrayed ally's SAM threatens (alliance breaks at launch)", () => {
    expect(samThreatensNukePreview(2, teammates, allies, new Set([2]))).toBe(
      true,
    );
  });

  test("other allies' SAMs still excluded when a different ally is betrayed", () => {
    expect(samThreatensNukePreview(3, teammates, allies, new Set([2]))).toBe(
      false,
    );
  });

  test("teammate SAM does not threaten the trajectory", () => {
    expect(samThreatensNukePreview(7, teammates, new Set(), new Set())).toBe(
      false,
    );
  });

  test("teammate SAM stays excluded even if listed as betrayed (a strike never breaks a team)", () => {
    expect(
      samThreatensNukePreview(7, teammates, new Set([7]), new Set([7])),
    ).toBe(false);
  });
});
