/**
 * Gold-per-minute benchmark of a full nation game.
 *
 * Spawns every nation from the world map manifest at Impossible difficulty
 * with the real production Config (real attack logic, nukes, trade routing —
 * not the TestConfig stubs) and lets the real NationExecutions play the game:
 * expanding, warring, and building their own ports, factories and cities.
 * Nothing is scripted; every port and train line exists because a nation
 * decided to build it.
 *
 * Each game minute (600 ticks) the test samples the gold earned from trade
 * ships and trains across all nations and pins the per-minute table in a
 * snapshot. When the economy meta changes (tradeShipGold, trainGold, spawn
 * rates, structure costs…), the snapshot diff shows exactly how gold per
 * minute shifts over the course of a real game — including second-order
 * effects like nations affording more ports earlier. A pure refactor must
 * leave the snapshot untouched. See TradeTrainGolden.test.ts for the raw
 * formulas and TradeTrainScenarios.test.ts for isolated route benchmarks.
 *
 * StatsImpl ignores nations (they have no clientID), so gold is tallied by
 * wrapping the Stats hooks the sim calls on every payout. All randomness is
 * PseudoRandom seeded from the fixed game ID and nation names, so runs are
 * deterministic.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../src/core/configuration/Config";
import { NationExecution } from "../src/core/execution/NationExecution";
import { RecomputeRailClusterExecution } from "../src/core/execution/RecomputeRailClusterExecution";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GAME_ID = "nation-gold-per-minute";
const TICKS_PER_MINUTE = 600; // 10 ticks per second

function sig(x: bigint | number): number {
  return Number(Number(x).toPrecision(4));
}

function loadWorldNations(): Nation[] {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "testdata/maps/world/manifest.json"),
      "utf8",
    ),
  ) as { nations: { coordinates: [number, number]; name: string }[] };
  // The nation name doubles as the player ID so every NationExecution seeds
  // the same RNG stream on every run.
  return manifest.nations.map(
    (n) =>
      new Nation(
        new Cell(n.coordinates[0], n.coordinates[1]),
        new PlayerInfo(n.name, PlayerType.Nation, null, n.name),
      ),
  );
}

/** Cumulative gold by source, across all players. */
interface GoldTally {
  trade: bigint; // trade-ship arrivals (both port owners' shares)
  steal: bigint; // captured trade ships arriving home
  trainSelf: bigint;
  trainOther: bigint;
  shipsArrived: number;
  trainStops: number;
}

function toBigint(g: number | bigint): bigint {
  return typeof g === "bigint" ? g : BigInt(Math.floor(g));
}

/**
 * Wrap the Stats payout hooks to tally gold for every player. StatsImpl
 * drops players without a clientID, so nation gold never shows up in
 * getPlayerStats — but the sim still calls these hooks on every payout.
 */
function instrumentStats(game: Game): GoldTally {
  const tally: GoldTally = {
    trade: 0n,
    steal: 0n,
    trainSelf: 0n,
    trainOther: 0n,
    shipsArrived: 0,
    trainStops: 0,
  };
  const stats = game.stats();

  const boatArriveTrade = stats.boatArriveTrade.bind(stats);
  stats.boatArriveTrade = (player: Player, target: Player, gold) => {
    tally.trade += 2n * toBigint(gold); // both port owners earn `gold`
    tally.shipsArrived++;
    boatArriveTrade(player, target, gold);
  };
  const boatCapturedTrade = stats.boatCapturedTrade.bind(stats);
  stats.boatCapturedTrade = (player: Player, target: Player, gold) => {
    tally.steal += toBigint(gold);
    boatCapturedTrade(player, target, gold);
  };
  const trainSelfTrade = stats.trainSelfTrade.bind(stats);
  stats.trainSelfTrade = (player: Player, gold) => {
    tally.trainSelf += toBigint(gold);
    tally.trainStops++;
    trainSelfTrade(player, gold);
  };
  const trainExternalTrade = stats.trainExternalTrade.bind(stats);
  stats.trainExternalTrade = (player: Player, gold) => {
    tally.trainOther += toBigint(gold);
    trainExternalTrade(player, gold);
  };
  return tally;
}

interface MinuteRow {
  minute: number;
  /** Gold earned this minute, 4 significant digits. */
  tradeGold: number;
  stealGold: number;
  trainGold: number;
  shipsArrived: number;
  trainStops: number;
  /** Live structure / unit counts at the end of the minute. */
  ports: number;
  factories: number;
  cities: number;
  tradeShipsAtSea: number;
  trainsRunning: number;
}

async function runNationGame(minutes: number): Promise<{
  perMinute: MinuteRow[];
  aliveNations: number;
  totals: {
    tradeGold: number;
    stealGold: number;
    trainGold: number;
    shipsArrived: number;
    trainStops: number;
  };
}> {
  const nations = loadWorldNations();
  const game = await setup(
    "world",
    { difficulty: Difficulty.Impossible },
    [],
    undefined,
    Config,
    false, // keep the spawn phase open so nations can place themselves
    nations,
  );
  for (const nation of nations) {
    game.addExecution(new NationExecution(GAME_ID, nation));
  }
  // Mirror GameRunner.init: trains only run when rail clusters are recomputed.
  game.addExecution(new RecomputeRailClusterExecution(game.railNetwork()));

  // players() only returns alive (spawned) players, so poll allPlayers().
  for (
    let i = 0;
    i < 100 && game.allPlayers().some((p) => !p.hasSpawned());
    i++
  ) {
    game.executeNextTick();
  }
  const unspawned = game.allPlayers().filter((p) => !p.hasSpawned());
  if (unspawned.length > 0) {
    throw new Error(
      `nations failed to spawn: ${unspawned.map((p) => p.name()).join(", ")}`,
    );
  }
  game.endSpawnPhase();

  const tally = instrumentStats(game);
  const perMinute: MinuteRow[] = [];
  let prev: GoldTally = { ...tally };
  for (let minute = 1; minute <= minutes; minute++) {
    for (let t = 0; t < TICKS_PER_MINUTE; t++) {
      game.executeNextTick();
    }
    perMinute.push({
      minute,
      tradeGold: sig(tally.trade - prev.trade),
      stealGold: sig(tally.steal - prev.steal),
      trainGold: sig(
        tally.trainSelf + tally.trainOther - prev.trainSelf - prev.trainOther,
      ),
      shipsArrived: tally.shipsArrived - prev.shipsArrived,
      trainStops: tally.trainStops - prev.trainStops,
      ports: game.units(UnitType.Port).length,
      factories: game.units(UnitType.Factory).length,
      cities: game.units(UnitType.City).length,
      tradeShipsAtSea: game.units(UnitType.TradeShip).length,
      trainsRunning: game.units(UnitType.Train).length,
    });
    prev = { ...tally };
  }
  return {
    perMinute,
    aliveNations: game.players().length,
    totals: {
      tradeGold: sig(tally.trade),
      stealGold: sig(tally.steal),
      trainGold: sig(tally.trainSelf + tally.trainOther),
      shipsArrived: tally.shipsArrived,
      trainStops: tally.trainStops,
    },
  };
}

describe("nation gold per minute", () => {
  test("world map, impossible nations, 20 minutes", async () => {
    expect(await runNationGame(20)).toMatchSnapshot();
  }, 600_000);
});
