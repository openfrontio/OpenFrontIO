/**
 * Golden-value tests for the trade-ship and train economy formulas:
 * `Config.tradeShipGold`, `Config.tradeShipSaturation`,
 * `Config.tradeShipSpawnRate`, `Config.trainGold`, `Config.trainSaturation`
 * and `Config.trainSpawnRate`.
 *
 * These pin the *exact* numeric output of each formula across a grid of
 * inputs, the same way AttackLogicGolden.test.ts pins the attack formula.
 * They exist so the formulas can be refactored with confidence (a pure
 * restructuring must leave the snapshot untouched) and so that any
 * deliberate balance change shows up as a reviewable diff of numbers rather
 * than a vague "it feels different".
 *
 * This is a test of the formulas, not of the simulation. See
 * TradeTrainScenarios.test.ts for end-to-end numbers on real maps.
 */
import { Config } from "../src/core/configuration/Config";
import { Player } from "../src/core/game/Game";
import { UserSettings } from "../src/core/game/UserSettings";
import { GameConfig } from "../src/core/Schemas";

function makeConfig(gameConfig: Partial<GameConfig> = {}): Config {
  return new Config(gameConfig as GameConfig, new UserSettings(), false);
}

const config = makeConfig();

function player(isLobbyCreator = false): Player {
  return { isLobbyCreator: () => isLobbyCreator } as unknown as Player;
}

const DISTANCES = [
  0, 10, 50, 100, 150, 200, 250, 300, 350, 400, 500, 750, 1_000, 1_500, 2_000,
  5_000,
];

function sig(x: number): number {
  return Number(x.toPrecision(4));
}

describe("trade ship golden values", () => {
  test("tradeShipGold: distance sweep", () => {
    const table: Record<string, bigint> = {};
    for (const dist of DISTANCES) {
      table[`dist=${dist}`] = config.tradeShipGold(dist, player());
    }
    expect(table).toMatchSnapshot();
  });

  test("tradeShipGold: gold multipliers", () => {
    const table: Record<string, bigint> = {};
    for (const mult of [0.5, 2, 10]) {
      const c = makeConfig({ goldMultiplier: mult });
      for (const dist of [100, 500, 2_000]) {
        table[`mult=${mult} dist=${dist}`] = c.tradeShipGold(dist, player());
      }
    }
    const hostCheat = makeConfig({ hostCheats: { goldMultiplier: 5 } });
    table["hostCheat=5 creator dist=500"] = hostCheat.tradeShipGold(
      500,
      player(true),
    );
    table["hostCheat=5 non-creator dist=500"] = hostCheat.tradeShipGold(
      500,
      player(false),
    );
    expect(table).toMatchSnapshot();
  });

  test("tradeShipSaturation: fleet-size sweep", () => {
    // >1 boosts spawning while the world fleet is small, ~1 around 200
    // ships, collapsing toward 0 past the ~300-ship capacity midpoint. The
    // pity timer square-roots the realized spawn-frequency effect.
    const table: Record<string, number> = {};
    for (const ships of [0, 25, 50, 100, 150, 200, 250, 300, 400, 500, 700]) {
      table[`ships=${ships}`] = sig(config.tradeShipSaturation(ships));
    }
    expect(table).toMatchSnapshot();
  });

  test("tradeShipSpawnRate: rejections × active trade ships grid", () => {
    // Probability of a spawn per check is 1 / tradeShipSpawnRate.
    const rejections = [0, 1, 2, 5, 10, 50];
    const numTradeShips = [0, 10, 50, 100, 200, 300, 400, 500, 700, 1_000];
    const table: Record<string, number> = {};
    for (const rej of rejections)
      for (const ships of numTradeShips) {
        table[`rejections=${rej} ships=${ships}`] = config.tradeShipSpawnRate(
          rej,
          ships,
        );
      }
    expect(table).toMatchSnapshot();
  });
});

describe("train golden values", () => {
  test("trainGold: relationship × trade stops grid", () => {
    const rels = ["self", "team", "ally", "other"] as const;
    const stops = [0, 1, 5, 9, 10, 11, 12, 13, 14, 15, 20, 50];
    const table: Record<string, bigint> = {};
    for (const rel of rels)
      for (const visited of stops) {
        table[`rel=${rel} stops=${visited}`] = config.trainGold(
          rel,
          visited,
          player(),
        );
      }
    expect(table).toMatchSnapshot();
  });

  test("trainGold: gold multipliers", () => {
    const table: Record<string, bigint> = {};
    for (const mult of [0.5, 2, 10]) {
      const c = makeConfig({ goldMultiplier: mult });
      for (const rel of ["self", "other"] as const) {
        table[`mult=${mult} rel=${rel}`] = c.trainGold(rel, 0, player());
      }
    }
    const hostCheat = makeConfig({ hostCheats: { goldMultiplier: 5 } });
    table["hostCheat=5 creator rel=self"] = hostCheat.trainGold(
      "self",
      0,
      player(true),
    );
    table["hostCheat=5 non-creator rel=self"] = hostCheat.trainGold(
      "self",
      0,
      player(false),
    );
    expect(table).toMatchSnapshot();
  });

  test("trainSaturation: global train sweep", () => {
    // Counted in Train units (~7 per train). >1 boosts spawning while the
    // world's rail traffic is light, ~1 around 120 units (~17 trains),
    // collapsing toward 0 past the ~400-unit capacity midpoint.
    const table: Record<string, number> = {};
    for (const units of [0, 7, 35, 70, 140, 250, 400, 600, 800, 1_200]) {
      table[`trainUnits=${units}`] = sig(config.trainSaturation(units));
    }
    expect(table).toMatchSnapshot();
  });

  test("trainSpawnRate: factory count × global trains grid", () => {
    // Probability of a spawn per check is 1 / trainSpawnRate, per station
    // level. Expected trains ≈ numFactories / trainSpawnRate(numFactories).
    const table: Record<string, number> = {};
    for (const factories of [0, 1, 2, 5, 10, 20, 50, 100, 500]) {
      for (const trainUnits of [0, 120, 400]) {
        table[`factories=${factories} trainUnits=${trainUnits}`] =
          config.trainSpawnRate(factories, trainUnits);
      }
    }
    expect(table).toMatchSnapshot();
  });
});
