/**
 * Golden-value tests for the trade-ship and train economy formulas:
 * `Config.tradeShipGold`, `Config.tradeShipSpawnRate`, `Config.trainGold`
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

// Global-count pacing midpoint: economyPacing(count, 250) is ~1x here, so
// sweeps over the other inputs stay readable at their unpaced values.
const NEUTRAL_SHIPS = 250;
const NEUTRAL_TRAIN_UNITS = 250;

describe("trade ship golden values", () => {
  test("tradeShipGold: distance sweep", () => {
    const table: Record<string, bigint> = {};
    for (const dist of DISTANCES) {
      table[`dist=${dist}`] = config.tradeShipGold(
        dist,
        NEUTRAL_SHIPS,
        player(),
      );
    }
    expect(table).toMatchSnapshot();
  });

  test("tradeShipGold: global fleet pacing", () => {
    // Fewer trade ships game-wide pay up to 2x; a mature fleet tapers
    // toward the 0.5x floor.
    const table: Record<string, bigint> = {};
    for (const ships of [0, 25, 50, 100, 150, 250, 400, 600, 1_000]) {
      for (const dist of [100, 500]) {
        table[`ships=${ships} dist=${dist}`] = config.tradeShipGold(
          dist,
          ships,
          player(),
        );
      }
    }
    expect(table).toMatchSnapshot();
  });

  test("tradeShipGold: gold multipliers", () => {
    const table: Record<string, bigint> = {};
    for (const mult of [0.5, 2, 10]) {
      const c = makeConfig({ goldMultiplier: mult });
      for (const dist of [100, 500, 2_000]) {
        table[`mult=${mult} dist=${dist}`] = c.tradeShipGold(
          dist,
          NEUTRAL_SHIPS,
          player(),
        );
      }
    }
    const hostCheat = makeConfig({ hostCheats: { goldMultiplier: 5 } });
    table["hostCheat=5 creator dist=500"] = hostCheat.tradeShipGold(
      500,
      NEUTRAL_SHIPS,
      player(true),
    );
    table["hostCheat=5 non-creator dist=500"] = hostCheat.tradeShipGold(
      500,
      NEUTRAL_SHIPS,
      player(false),
    );
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
          NEUTRAL_TRAIN_UNITS,
          player(),
        );
      }
    expect(table).toMatchSnapshot();
  });

  test("trainGold: global train pacing", () => {
    // Each train is ~7 Train units; fewer trains game-wide pay up to 2x,
    // tapering toward the 0.5x floor as the world fills with rail traffic.
    const table: Record<string, bigint> = {};
    for (const units of [0, 7, 21, 70, 140, 250, 420, 700, 1_400]) {
      for (const rel of ["self", "other"] as const) {
        table[`trainUnits=${units} rel=${rel}`] = config.trainGold(
          rel,
          0,
          units,
          player(),
        );
      }
    }
    expect(table).toMatchSnapshot();
  });

  test("trainGold: gold multipliers", () => {
    const table: Record<string, bigint> = {};
    for (const mult of [0.5, 2, 10]) {
      const c = makeConfig({ goldMultiplier: mult });
      for (const rel of ["self", "other"] as const) {
        table[`mult=${mult} rel=${rel}`] = c.trainGold(
          rel,
          0,
          NEUTRAL_TRAIN_UNITS,
          player(),
        );
      }
    }
    const hostCheat = makeConfig({ hostCheats: { goldMultiplier: 5 } });
    table["hostCheat=5 creator rel=self"] = hostCheat.trainGold(
      "self",
      0,
      NEUTRAL_TRAIN_UNITS,
      player(true),
    );
    table["hostCheat=5 non-creator rel=self"] = hostCheat.trainGold(
      "self",
      0,
      NEUTRAL_TRAIN_UNITS,
      player(false),
    );
    expect(table).toMatchSnapshot();
  });

  test("trainSpawnRate: factory count sweep", () => {
    // Probability of a spawn per check is 1 / trainSpawnRate, per station
    // level. Expected trains ≈ numFactories / trainSpawnRate(numFactories).
    const table: Record<string, number> = {};
    for (const factories of [0, 1, 2, 5, 10, 20, 50, 100, 500]) {
      table[`factories=${factories}`] = config.trainSpawnRate(factories);
    }
    expect(table).toMatchSnapshot();
  });
});
