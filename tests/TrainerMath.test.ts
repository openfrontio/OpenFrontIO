import { describe, expect, it } from "vitest";
import {
  attackLossesPerTile,
  commitVerdict,
  forecastAttack,
  gradeAttack,
  growthPerTick,
  minLossCommit,
  optimalTroops,
  TERRAIN_HIGHLAND,
  TERRAIN_MOUNTAIN,
  TERRAIN_PLAINS,
  wildlandsSaturationTroops,
  wildlandsSpeedCost,
} from "../src/client/trainer/TrainerMath";
import { Config } from "../src/core/configuration/Config";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  PlayerType,
  TerrainType,
} from "../src/core/game/Game";
import { GameConfig } from "../src/core/Schemas";

const gameConfig: GameConfig = {
  gameMap: GameMapType.Asia,
  gameMapSize: GameMapSize.Normal,
  gameMode: GameMode.FFA,
  gameType: GameType.Singleplayer,
  difficulty: Difficulty.Medium,
  nations: "default",
  donateGold: false,
  donateTroops: false,
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
};

const config = new Config(gameConfig, null, false);

function humanStub(opts: {
  troops: number;
  tiles: number;
  traitor?: boolean;
}): Player {
  return {
    type: () => PlayerType.Human,
    troops: () => opts.troops,
    numTilesOwned: () => opts.tiles,
    units: () => [],
    isPlayer: () => true,
    isTraitor: () => opts.traitor ?? false,
    isDisconnected: () => false,
    isOnSameTeam: () => false,
    isLobbyCreator: () => false,
  } as unknown as Player;
}

/** Game stub for attackLogic: plains everywhere, no posts, no fallout. */
function gameStub(terrain: TerrainType = TerrainType.Plains) {
  return {
    terrainType: () => terrain,
    nearbyUnits: () => [],
    hasFallout: () => false,
    numTilesWithFallout: () => 0,
    numLandTiles: () => 1000,
    config: () => config,
  } as never;
}

describe("growth mirrors Config", () => {
  it("growthPerTick matches Config.troopIncreaseRate for humans", () => {
    for (const [troops, tiles] of [
      [25_000, 100],
      [80_000, 2_000],
      [500_000, 50_000],
      [1_000, 10],
    ]) {
      const player = humanStub({ troops, tiles });
      const max = config.maxTroops(player);
      expect(growthPerTick(troops, max)).toBeCloseTo(
        config.troopIncreaseRate(player),
        6,
      );
    }
  });

  it("optimum sits near 42% of max troops", () => {
    for (const max of [100_000, 1_000_000, 10_000_000]) {
      const opt = optimalTroops(max);
      expect(opt / max).toBeGreaterThan(0.4);
      expect(opt / max).toBeLessThan(0.45);
      // It is a maximum: neighbors grow slower.
      const peak = growthPerTick(opt, max);
      expect(growthPerTick(opt * 0.8, max)).toBeLessThan(peak);
      expect(growthPerTick(opt * 1.2, max)).toBeLessThan(peak);
    }
  });

  it("growth collapses near cap", () => {
    const max = 1_000_000;
    const peak = growthPerTick(optimalTroops(max), max);
    expect(growthPerTick(0.95 * max, max) / peak).toBeLessThan(0.2);
    expect(growthPerTick(max, max)).toBe(0);
  });
});

describe("combat mirrors Config.attackLogic", () => {
  it.each([
    [10_000, 5_000, 500, 100], // healthy overcommit
    [5_000, 10_000, 1_000, 100], // undercommit
    [50_000, 30_000, 2_000, 5_000], // mid game
  ])(
    "attacker/defender losses match (A=%i D=%i)",
    (a, d, defTiles, atkTiles) => {
      const attacker = humanStub({ troops: 100_000, tiles: atkTiles });
      const defender = humanStub({ troops: d, tiles: defTiles });
      const expected = config.attackLogic(
        gameStub(),
        a,
        attacker,
        defender,
        0 as never,
      );
      const mirror = attackLossesPerTile({
        attackTroops: a,
        defenderTroops: d,
        defenderTiles: defTiles,
        attackerTiles: atkTiles,
        terrain: TERRAIN_PLAINS,
      });
      expect(mirror.attackerLoss).toBeCloseTo(expected.attackerTroopLoss, 6);
      expect(mirror.defenderLoss).toBeCloseTo(expected.defenderTroopLoss, 6);
      expect(mirror.speedCost).toBeCloseTo(expected.tilesPerTickUsed, 6);
    },
  );

  it("losses bottom out at the 1.667x commit and rise below it", () => {
    const base = {
      defenderTroops: 30_000,
      defenderTiles: 1_000,
      attackerTiles: 1_000,
      terrain: TERRAIN_PLAINS,
    };
    const atFloor = attackLossesPerTile({
      ...base,
      attackTroops: minLossCommit(30_000),
    }).attackerLoss;
    const overkill = attackLossesPerTile({
      ...base,
      attackTroops: 30_000 * 10,
    }).attackerLoss;
    const under = attackLossesPerTile({
      ...base,
      attackTroops: 10_000,
    }).attackerLoss;
    expect(overkill).toBeCloseTo(atFloor, 6);
    expect(under).toBeGreaterThan(atFloor * 2);
  });

  it("terrain scales losses", () => {
    const base = {
      attackTroops: 50_000,
      defenderTroops: 30_000,
      defenderTiles: 1_000,
      attackerTiles: 1_000,
    };
    const plains = attackLossesPerTile({ ...base, terrain: TERRAIN_PLAINS });
    const highland = attackLossesPerTile({
      ...base,
      terrain: TERRAIN_HIGHLAND,
    });
    const mountain = attackLossesPerTile({
      ...base,
      terrain: TERRAIN_MOUNTAIN,
    });
    expect(highland.attackerLoss).toBeGreaterThan(plains.attackerLoss);
    expect(mountain.attackerLoss).toBeGreaterThan(highland.attackerLoss);
  });

  it("defense post multiplies losses 5x", () => {
    const base = {
      attackTroops: 50_000,
      defenderTroops: 30_000,
      defenderTiles: 1_000,
      attackerTiles: 1_000,
      terrain: TERRAIN_PLAINS,
    };
    const open = attackLossesPerTile(base);
    const posted = attackLossesPerTile({ ...base, defensePost: true });
    expect(posted.attackerLoss).toBeCloseTo(open.attackerLoss * 5, 4);
  });
});

describe("forecastAttack", () => {
  it("well-sized attacks conquer small defenders", () => {
    const f = forecastAttack({
      attackTroops: 60_000,
      defenderTroops: 20_000,
      defenderTiles: 500,
      attackerTiles: 1_000,
      terrain: TERRAIN_PLAINS,
    });
    expect(f.conquered).toBe(true);
    expect(f.tilesTaken).toBe(500);
    expect(f.attackerLosses).toBeGreaterThan(0);
    expect(f.attackerLosses).toBeLessThan(60_000);
    expect(f.minPossibleLosses).toBeLessThanOrEqual(f.attackerLosses + 1e-6);
  });

  it("tiny attacks stall", () => {
    const f = forecastAttack({
      attackTroops: 2_000,
      defenderTroops: 100_000,
      defenderTiles: 2_000,
      attackerTiles: 1_000,
      terrain: TERRAIN_PLAINS,
    });
    expect(f.conquered).toBe(false);
    expect(f.tilesTaken).toBeLessThan(100);
  });
});

describe("wildlands", () => {
  it("speed cost saturates at the documented troop count", () => {
    const sat = wildlandsSaturationTroops(TERRAIN_PLAINS);
    expect(sat).toBeCloseTo(6_600, 0);
    expect(wildlandsSpeedCost(sat, TERRAIN_PLAINS)).toBeCloseTo(5, 6);
    expect(wildlandsSpeedCost(sat / 2, TERRAIN_PLAINS)).toBeCloseTo(10, 6);
    expect(wildlandsSpeedCost(10, TERRAIN_PLAINS)).toBe(100);
  });
});

describe("grading", () => {
  it("grades by loss ratio", () => {
    expect(gradeAttack(100, 100)).toBe("S");
    expect(gradeAttack(115, 100)).toBe("A");
    expect(gradeAttack(140, 100)).toBe("B");
    expect(gradeAttack(190, 100)).toBe("C");
    expect(gradeAttack(240, 100)).toBe("D");
    expect(gradeAttack(400, 100)).toBe("F");
  });

  it("verdicts follow the clamp", () => {
    expect(commitVerdict(10_000, 30_000)).toBe("undercommit");
    expect(commitVerdict(50_001, 30_000)).toBe("efficient");
    expect(commitVerdict(80_000, 30_000)).toBe("overkill");
  });
});
