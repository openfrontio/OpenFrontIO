/**
 * Golden-value tests for `Config.attackLogic` / `Config.attackTilesPerTick`.
 *
 * These pin the *exact* numeric output of the per-tile attack formula across a
 * grid of inputs. They exist so the formula can be refactored with confidence
 * (a pure restructuring must leave the snapshot untouched) and so that any
 * deliberate balance change shows up as a reviewable diff of numbers rather
 * than a vague "it feels different".
 *
 * This is a test of the formula, not of the simulation. See
 * AttackScenarios.test.ts for end-to-end numbers on real maps.
 */
import { AttackLogicInput, Config } from "../src/core/configuration/Config";
import {
  Player,
  PlayerType,
  TerrainType,
  TerraNullius,
} from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";

const config = new Config({} as GameConfig, new UserSettings(), false);

type Defender = NonNullable<AttackLogicInput["defender"]>;

function defender(
  o: Partial<Defender> & { numTiles: number; troops: number },
): Defender {
  return {
    type: PlayerType.Human,
    isTraitor: false,
    isDisconnectedTeammate: false,
    ...o,
  };
}

function round(x: number): number {
  return Number(x.toPrecision(6));
}

function run(o: Partial<AttackLogicInput> & { attackTroops: number }) {
  const r = config.attackLogic({
    terrain: TerrainType.Plains,
    attacker: { type: PlayerType.Human, numTiles: 20_000 },
    defender: null,
    defenderHasDefensePost: false,
    falloutRatio: null,
    ...o,
  });
  return {
    attackerLoss: round(r.attackerTroopLoss),
    defenderLoss: round(r.defenderTroopLoss),
    tileCost: round(r.tilesPerTickUsed),
  };
}

const TERRAINS = [
  TerrainType.Plains,
  TerrainType.Highland,
  TerrainType.Mountain,
] as const;

describe("attackLogic golden values", () => {
  test("player vs player: terrain × territory × troops grid", () => {
    const attackerTiles = [1_000, 50_000, 200_000];
    const defenderTiles = [1_000, 50_000, 150_000, 400_000];
    const defenderTroops = [10_000, 100_000, 1_000_000];
    const attackTroops = [10_000, 100_000, 1_000_000];

    const table: Record<string, ReturnType<typeof run>> = {};
    for (const terrain of TERRAINS)
      for (const at of attackerTiles)
        for (const dt of defenderTiles)
          for (const dtr of defenderTroops)
            for (const atr of attackTroops) {
              const key = `${TerrainType[terrain]} aTiles=${at} dTiles=${dt} dTroops=${dtr} attack=${atr}`;
              table[key] = run({
                terrain,
                attackTroops: atr,
                attacker: { type: PlayerType.Human, numTiles: at },
                defender: defender({ numTiles: dt, troops: dtr }),
              });
            }
    expect(table).toMatchSnapshot();
  });

  test("player vs player: situational modifiers", () => {
    const base = { numTiles: 20_000, troops: 100_000 };
    const pvp = (o: Partial<AttackLogicInput> = {}) =>
      run({ attackTroops: 100_000, defender: defender(base), ...o });
    const cases: Record<string, ReturnType<typeof run>> = {
      baseline: pvp(),
      "defender has defense post": pvp({ defenderHasDefensePost: true }),
      "no fallout": pvp({ falloutRatio: null }),
      "fallout 10%": pvp({ falloutRatio: 0.1 }),
      "fallout 100%": pvp({ falloutRatio: 1 }),
      "defender is traitor": pvp({
        defender: defender({ ...base, isTraitor: true }),
      }),
      "human attacks bot": pvp({
        defender: defender({ ...base, type: PlayerType.Bot }),
      }),
      "nation attacks bot": pvp({
        attacker: { type: PlayerType.Nation, numTiles: 20_000 },
        defender: defender({ ...base, type: PlayerType.Bot }),
      }),
      "bot attacks bot": pvp({
        attacker: { type: PlayerType.Bot, numTiles: 20_000 },
        defender: defender({ ...base, type: PlayerType.Bot }),
      }),
      "bot attacks human": pvp({
        attacker: { type: PlayerType.Bot, numTiles: 20_000 },
      }),
      "disconnected teammate": pvp({
        defender: defender({ ...base, isDisconnectedTeammate: true }),
      }),
      "defense post + fallout + traitor (stacking)": pvp({
        terrain: TerrainType.Mountain,
        defenderHasDefensePost: true,
        falloutRatio: 0.5,
        defender: defender({ ...base, isTraitor: true }),
      }),
    };
    expect(cases).toMatchSnapshot();
  });

  test("player vs player: troop ratio clamps", () => {
    // defender.troops / attackTroops is clamped to [0.6, 2] for losses and
    // defender.troops / (5 * attackTroops) to [0.2, 1.5] for tile cost.
    const ratios = [0.01, 0.1, 0.5, 0.6, 1, 2, 5, 7.5, 10, 100];
    const table: Record<string, ReturnType<typeof run>> = {};
    for (const r of ratios) {
      table[`defenderTroops/attackTroops=${r}`] = run({
        attackTroops: 100_000 / r,
        defender: defender({ numTiles: 20_000, troops: 100_000 }),
      });
    }
    expect(table).toMatchSnapshot();
  });

  test("player vs player: large-territory curves", () => {
    // Sweep territory size on each side independently to pin the sigmoid
    // defender debuff and the >100k attacker bonus.
    const sizes = [
      1_000, 10_000, 50_000, 100_000, 100_001, 150_000, 200_000, 300_000,
      500_000, 1_000_000,
    ];
    const table: Record<string, ReturnType<typeof run>> = {};
    for (const s of sizes) {
      table[`attackerTiles=${s}`] = run({
        attackTroops: 100_000,
        attacker: { type: PlayerType.Human, numTiles: s },
        defender: defender({ numTiles: 20_000, troops: 100_000 }),
      });
      table[`defenderTiles=${s}`] = run({
        attackTroops: 100_000,
        defender: defender({ numTiles: s, troops: 100_000 }),
      });
    }
    expect(table).toMatchSnapshot();
  });

  test("player vs terra nullius", () => {
    const table: Record<string, ReturnType<typeof run>> = {};
    for (const terrain of TERRAINS)
      for (const type of [PlayerType.Human, PlayerType.Bot])
        for (const atr of [100, 1_000, 10_000, 100_000, 1_000_000])
          for (const fallout of [0, 0.5]) {
            const key = `${TerrainType[terrain]} ${type} attack=${atr} fallout=${fallout}`;
            table[key] = run({
              terrain,
              attackTroops: atr,
              attacker: { type, numTiles: 1_000 },
              falloutRatio: fallout > 0 ? fallout : null,
            });
          }
    expect(table).toMatchSnapshot();
  });

  test("attackTilesPerTick", () => {
    const table: Record<string, number> = {};
    const attacker = {} as Player;
    const troops = (n: number) =>
      ({ isPlayer: () => true, troops: () => n }) as unknown as Player;
    const terraNullius = { isPlayer: () => false } as unknown as TerraNullius;
    for (const dtr of [1_000, 100_000, 10_000_000])
      for (const atr of [1_000, 100_000, 10_000_000])
        for (const border of [1, 10, 100, 1_000]) {
          table[`dTroops=${dtr} attack=${atr} border=${border}`] = round(
            config.attackTilesPerTick(atr, attacker, troops(dtr), border),
          );
        }
    for (const border of [1, 10, 100, 1_000]) {
      table[`terraNullius border=${border}`] = round(
        config.attackTilesPerTick(1_000, attacker, terraNullius, border),
      );
    }
    expect(table).toMatchSnapshot();
  });

  // The extremes are where formulas break: giant vs tiny territories, 1-troop
  // attacks, 10M-troop armies, empty defenders and turtles with thousands of
  // troops per tile.
  test("extremes: territory and troop counts", () => {
    const attackerTiles = [100, 1_000_000, 5_000_000];
    const defenderTiles = [100, 1_000_000];
    const defenderTroops = [0, 1, 1_000, 1_000_000, 10_000_000];
    const attackTroops = [1, 1_000, 1_000_000, 10_000_000];

    const table: Record<string, ReturnType<typeof run>> = {};
    for (const terrain of [TerrainType.Plains, TerrainType.Mountain])
      for (const at of attackerTiles)
        for (const dt of defenderTiles)
          for (const dtr of defenderTroops)
            for (const atr of attackTroops) {
              const key = `${TerrainType[terrain]} aTiles=${at} dTiles=${dt} dTroops=${dtr} attack=${atr}`;
              table[key] = run({
                terrain,
                attackTroops: atr,
                attacker: { type: PlayerType.Human, numTiles: at },
                defender: defender({ numTiles: dt, troops: dtr }),
              });
            }
    expect(table).toMatchSnapshot();
  });

  test("extremes: terra nullius", () => {
    const table: Record<string, ReturnType<typeof run>> = {};
    for (const at of [100, 5_000_000])
      for (const atr of [1, 10_000_000]) {
        table[`aTiles=${at} attack=${atr}`] = run({
          attackTroops: atr,
          attacker: { type: PlayerType.Human, numTiles: at },
        });
      }
    expect(table).toMatchSnapshot();
  });

  test("impassable terrain throws", () => {
    expect(() =>
      run({ terrain: TerrainType.Impassable, attackTroops: 1 }),
    ).toThrow();
  });
});
