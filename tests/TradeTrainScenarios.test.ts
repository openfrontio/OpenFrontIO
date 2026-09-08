/**
 * End-to-end trade-ship and train economy benchmarks on real maps.
 *
 * Each scenario sets up territories with real ports / factories / cities,
 * registers the real PortExecution / FactoryExecution spawners and runs the
 * simulation for a fixed number of ticks. The resulting metrics — ships and
 * trains spawned, arrivals, gold earned by each side and the per-minute /
 * per-trip rates — are pinned in a snapshot.
 *
 * Purpose: when the trade or train meta is changed (tradeShipGold,
 * tradeShipSpawnRate, trainGold, trainSpawnRate), the snapshot diff
 * quantifies the impact in every scenario ("long-haul trades earn 20% more,
 * spawn cadence unchanged", …). A pure refactor must leave the snapshot
 * untouched. See TradeTrainGolden.test.ts for the formulas themselves.
 *
 * No PlayerExecution is registered, so no worker income accrues; every gold
 * delta comes from the trade or train economy alone. All randomness is
 * PseudoRandom seeded from game ticks, so runs are deterministic.
 */
import { FactoryExecution } from "../src/core/execution/FactoryExecution";
import { PortExecution } from "../src/core/execution/PortExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Unit,
  UnitType,
} from "../src/core/game/Game";
import {
  GOLD_INDEX_TRAIN_OTHER,
  GOLD_INDEX_TRAIN_SELF,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

function sig(x: number): number {
  return Number(x.toPrecision(4));
}

/** Conquer every passable land tile within `r` (chebyshev) of (cx, cy). */
function conquerDisc(
  game: Game,
  player: Player,
  cx: number,
  cy: number,
  r: number,
): void {
  const map = game.map();
  for (let y = Math.max(0, cy - r); y <= cy + r && y < map.height(); y++) {
    for (let x = Math.max(0, cx - r); x <= cx + r && x < map.width(); x++) {
      const t = map.ref(x, y);
      if (map.isLand(t) && !map.isImpassable(t)) {
        player.conquer(t);
      }
    }
  }
}

function build(
  game: Game,
  player: Player,
  type: UnitType,
  x: number,
  y: number,
): Unit {
  const spawn = player.canBuild(type, game.ref(x, y));
  if (spawn === false) {
    throw new Error(`cannot build ${type} at (${x}, ${y})`);
  }
  return player.buildUnit(type, spawn, {});
}

interface TradeSide {
  /** Shore tile the port is built on; a disc around it is conquered. */
  port: [number, number];
  portLevel?: number;
  /**
   * Build this many ports (default 1): the first on the anchor tile, the
   * rest on nearby shore tiles facing the same ocean (canBuild enforces
   * structureMinDist spacing).
   */
  numPorts?: number;
}

interface TradeScenario {
  map: string;
  disableNavMesh?: boolean;
  a: TradeSide;
  b: TradeSide;
  ticks: number;
}

interface TradeSideMetrics {
  shipsSent: number;
  shipsArrived: number;
  tradeGold: bigint;
  arrivalsPerMinute: number;
  goldPerMinute: number;
}

function tradeSideMetrics(
  game: Game,
  player: Player,
  goldBefore: bigint,
  ticks: number,
): TradeSideMetrics {
  const stats = game.stats().getPlayerStats(player);
  const trade = stats?.boats?.trade ?? [];
  const arrived = Number(trade[1] ?? 0n);
  const tradeGold = player.gold() - goldBefore;
  return {
    shipsSent: Number(trade[0] ?? 0n),
    shipsArrived: arrived,
    tradeGold,
    arrivalsPerMinute: sig(arrived / (ticks / 600)),
    goldPerMinute: sig(Number(tradeGold) / (ticks / 600)),
  };
}

/**
 * Build `side.numPorts` ports for `player`: the first on the anchor shore
 * tile, the rest on surrounding shore tiles that face the same ocean, in
 * scan order. canBuild itself rejects tiles within structureMinDist of an
 * existing port, so the fleet spreads out along the coastline.
 */
function buildPorts(game: Game, player: Player, side: TradeSide): void {
  const [cx, cy] = side.port;
  const count = side.numPorts ?? 1;
  const map = game.map();
  const r = count === 1 ? 5 : 80;
  conquerDisc(game, player, cx, cy, r);

  const oceanOf = (t: number): number | null => {
    for (const n of game.neighbors(t)) {
      if (!map.isWater(n)) continue;
      const comp = game.getWaterComponent(n);
      if (comp !== null) return comp;
    }
    return null;
  };
  const ocean = oceanOf(map.ref(cx, cy));

  const port = build(game, player, UnitType.Port, cx, cy);
  for (let l = 1; l < (side.portLevel ?? 1); l++) port.increaseLevel();
  game.addExecution(new PortExecution(port));
  let built = 1;

  for (let y = Math.max(0, cy - r); y <= cy + r && built < count; y++) {
    for (let x = Math.max(0, cx - r); x <= cx + r && built < count; x++) {
      if (x >= map.width() || y >= map.height()) continue;
      const t = map.ref(x, y);
      if (!map.isLand(t) || !map.isShore(t)) continue;
      if (oceanOf(t) !== ocean) continue;
      const spawn = player.canBuild(UnitType.Port, t);
      if (spawn === false) continue;
      const extra = player.buildUnit(UnitType.Port, spawn, {});
      game.addExecution(new PortExecution(extra));
      built++;
    }
  }
  if (built < count) {
    throw new Error(
      `only found room for ${built}/${count} ports near (${cx}, ${cy})`,
    );
  }
}

async function runTradeScenario(s: TradeScenario): Promise<{
  a: TradeSideMetrics;
  b: TradeSideMetrics;
  /** Every arrival pays both port owners this on average. */
  goldPerTrade: number;
}> {
  const game = await setup(
    s.map,
    { instantBuild: true, disableNavMesh: s.disableNavMesh },
    [
      new PlayerInfo("a", PlayerType.Human, "a", "a"),
      new PlayerInfo("b", PlayerType.Human, "b", "b"),
    ],
  );
  const a = game.player("a");
  const b = game.player("b");
  for (const [player, side] of [
    [a, s.a],
    [b, s.b],
  ] as const) {
    player.addGold(10_000_000n);
    buildPorts(game, player, side);
  }
  const goldA = a.gold();
  const goldB = b.gold();
  for (let i = 0; i < s.ticks; i++) {
    game.executeNextTick();
  }
  const mA = tradeSideMetrics(game, a, goldA, s.ticks);
  const mB = tradeSideMetrics(game, b, goldB, s.ticks);
  const arrivals = mA.shipsArrived + mB.shipsArrived;
  return {
    a: mA,
    b: mB,
    goldPerTrade: sig(arrivals === 0 ? 0 : Number(mA.tradeGold) / arrivals),
  };
}

describe("trade ship scenarios", () => {
  // (539,380) and (539,442) sit ~60 tiles apart on the same coastline: a
  // short hop deep inside the short-range debuff.
  test("short coastal hop", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380] },
        b: { port: [539, 442] },
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);

  // world is 2000x1000. (539,380) and (832,341) face each other across an
  // ocean; a trip is a few hundred tiles, past the short-range debuff.
  test("across the ocean", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380] },
        b: { port: [832, 341] },
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);

  // (700,527) to (1491,451) is a ~800-tile haul on the same ocean: the
  // linear term of tradeShipGold dominates.
  test("long haul", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [700, 527] },
        b: { port: [1491, 451] },
        ticks: 4_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);

  // Same route as "across the ocean" but side A's port is level 3, which
  // rolls the spawn chance three times per check.
  test("across the ocean, level-3 port", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380], portLevel: 3 },
        b: { port: [832, 341] },
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);

  // A real port economy: ten ports per side spread along each coastline.
  // Every port rolls its own spawn chance and picks a destination weighted
  // by proximity, and the growing trade-ship count feeds back into
  // tradeShipSpawnRate — goldPerMinute here is the fleet's steady-state
  // income, not a single route.
  test("ten ports each across the ocean", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380], numPorts: 10 },
        b: { port: [832, 341], numPorts: 10 },
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);
});

interface TrainScenario {
  /** Factories owned by player a (factories spawn the trains). */
  factories: [number, number][];
  /** Cities owned by player a. */
  cities: [number, number][];
  /** Cities owned by player b (external trade stations). */
  otherCities?: [number, number][];
  ticks: number;
}

interface TrainMetrics {
  trainUnitsSeen: number;
  aSelfTradeGold: bigint;
  aExternalTradeGold: bigint;
  bExternalTradeGold: bigint;
  aGoldDelta: bigint;
  bGoldDelta: bigint;
  aGoldPerMinute: number;
}

async function runTrainScenario(s: TrainScenario): Promise<TrainMetrics> {
  // plains is 100x100, all land.
  const game = await setup("plains", { instantBuild: true }, [
    new PlayerInfo("a", PlayerType.Human, "a", "a"),
    new PlayerInfo("b", PlayerType.Human, "b", "b"),
  ]);
  const a = game.player("a");
  const b = game.player("b");
  a.addGold(100_000_000n);
  b.addGold(100_000_000n);
  conquerDisc(game, a, 50, 50, 49);
  for (const [x, y] of s.otherCities ?? []) {
    conquerDisc(game, b, x, y, 2);
    build(game, b, UnitType.City, x, y);
  }
  for (const [x, y] of s.cities) {
    build(game, a, UnitType.City, x, y);
  }
  for (const [x, y] of s.factories) {
    const factory = build(game, a, UnitType.Factory, x, y);
    // The real spawner: creates the factory's own (train-spawning) station
    // and stations for every structure in range.
    game.addExecution(new FactoryExecution(factory));
  }
  const goldA = a.gold();
  const goldB = b.gold();
  const trainIds = new Set<number>();
  for (let i = 0; i < s.ticks; i++) {
    game.executeNextTick();
    for (const u of game.units(UnitType.Train)) {
      trainIds.add(u.id());
    }
  }
  const statsA = game.stats().getPlayerStats(a);
  const statsB = game.stats().getPlayerStats(b);
  const aGoldDelta = a.gold() - goldA;
  return {
    trainUnitsSeen: trainIds.size,
    aSelfTradeGold: statsA?.gold?.[GOLD_INDEX_TRAIN_SELF] ?? 0n,
    aExternalTradeGold: statsA?.gold?.[GOLD_INDEX_TRAIN_OTHER] ?? 0n,
    bExternalTradeGold: statsB?.gold?.[GOLD_INDEX_TRAIN_OTHER] ?? 0n,
    aGoldDelta,
    bGoldDelta: b.gold() - goldB,
    aGoldPerMinute: sig(Number(aGoldDelta) / (s.ticks / 600)),
  };
}

describe("train scenarios", () => {
  test("factory and one city", async () => {
    expect(
      await runTrainScenario({
        factories: [[50, 50]],
        cities: [[70, 50]],
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 60_000);

  test("factory and four cities", async () => {
    expect(
      await runTrainScenario({
        factories: [[50, 50]],
        cities: [
          [30, 50],
          [70, 50],
          [50, 30],
          [50, 70],
        ],
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 60_000);

  // A second factory halves nothing outright but lowers the per-station
  // spawn chance (trainSpawnRate grows with factory count) while doubling
  // the number of spawning stations.
  test("two factories and two cities", async () => {
    expect(
      await runTrainScenario({
        factories: [
          [40, 50],
          [60, 50],
        ],
        cities: [
          [25, 50],
          [75, 50],
        ],
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 60_000);

  // Another player's city joins the rail cluster: their station pays out
  // "other"-relationship gold to both sides on each stop there.
  test("external city in the cluster", async () => {
    expect(
      await runTrainScenario({
        factories: [[50, 50]],
        cities: [[30, 50]],
        otherCities: [[70, 50]],
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 60_000);
});
