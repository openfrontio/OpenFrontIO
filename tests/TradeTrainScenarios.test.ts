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
import { Config } from "../src/core/configuration/Config";
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
  /**
   * How far around the anchor to conquer and scan for port spots
   * (default 5 for a single port, otherwise 80).
   */
  scanRadius?: number;
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

interface TradeSideBaseline {
  gold: bigint;
  shipsSent: number;
  shipsArrived: number;
}

function tradeSideBaseline(game: Game, player: Player): TradeSideBaseline {
  const trade = game.stats().getPlayerStats(player)?.boats?.trade ?? [];
  return {
    gold: player.gold(),
    shipsSent: Number(trade[0] ?? 0n),
    shipsArrived: Number(trade[1] ?? 0n),
  };
}

function tradeSideMetrics(
  game: Game,
  player: Player,
  base: TradeSideBaseline,
  ticks: number,
): TradeSideMetrics {
  const after = tradeSideBaseline(game, player);
  const arrived = after.shipsArrived - base.shipsArrived;
  const tradeGold = after.gold - base.gold;
  return {
    shipsSent: after.shipsSent - base.shipsSent,
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
function buildPorts(game: Game, player: Player, side: TradeSide): Unit[] {
  const [cx, cy] = side.port;
  const count = side.numPorts ?? 1;
  const map = game.map();
  const r = side.scanRadius ?? (count === 1 ? 5 : 80);
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
  const ports = [port];

  for (let y = Math.max(0, cy - r); y <= cy + r && ports.length < count; y++) {
    for (
      let x = Math.max(0, cx - r);
      x <= cx + r && ports.length < count;
      x++
    ) {
      if (x >= map.width() || y >= map.height()) continue;
      const t = map.ref(x, y);
      if (!map.isLand(t) || !map.isShore(t)) continue;
      if (oceanOf(t) !== ocean) continue;
      const spawn = player.canBuild(UnitType.Port, t);
      if (spawn === false) continue;
      ports.push(player.buildUnit(UnitType.Port, spawn, {}));
    }
  }
  if (ports.length < count) {
    throw new Error(
      `only found room for ${ports.length}/${count} ports near (${cx}, ${cy})`,
    );
  }
  return ports;
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
  // TestConfig stubs proximityBonusPortsNb to 0; restore the real weighting
  // so destination picks favor closer ports like they do in production.
  game.config().proximityBonusPortsNb = (totalPorts: number) =>
    Config.prototype.proximityBonusPortsNb.call(game.config(), totalPorts);
  // Port cost doubles per port up to 1M each; enough for any fleet size.
  a.addGold(10_000_000_000n);
  b.addGold(10_000_000_000n);
  const portsA = buildPorts(game, a, s.a);
  const portsB = buildPorts(game, b, s.b);
  // Register the spawners one tick apart: PortExecution seeds its
  // PseudoRandom from the tick it initializes on, so same-tick registration
  // would give every port an identical RNG stream and lock-step spawn rolls.
  const spawners: Unit[] = [];
  for (let i = 0; i < Math.max(portsA.length, portsB.length); i++) {
    if (i < portsA.length) spawners.push(portsA[i]);
    if (i < portsB.length) spawners.push(portsB[i]);
  }
  for (const port of spawners) {
    game.addExecution(new PortExecution(port));
    game.executeNextTick();
  }
  // The stagger above is warm-up: earlier spawners have already run for up
  // to 2·numPorts ticks (and may have sent ships), so baseline the trade
  // stats together with gold and measure only the s.ticks window.
  const baseA = tradeSideBaseline(game, a);
  const baseB = tradeSideBaseline(game, b);
  for (let i = 0; i < s.ticks; i++) {
    game.executeNextTick();
  }
  const mA = tradeSideMetrics(game, a, baseA, s.ticks);
  const mB = tradeSideMetrics(game, b, baseB, s.ticks);
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
  // Every port rolls its own spawn chance (spawners are registered a tick
  // apart, so each seeds its own RNG stream) and picks a destination with
  // the real proximity weighting, and the growing trade-ship count feeds
  // back into tradeShipSpawnRate — goldPerMinute here is the fleet's
  // steady-state income, not a single route.
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

  // The big-fleet end of the port-count sweep ("long haul" above is the
  // 1-port point on this route). The global trade-ship count feeds back
  // into tradeShipSpawnRate, so income per port falls as the fleet grows.
  // Physically capped well short of 1000 ports — structureMinDist spacing
  // only fits so many on a coastline (the ~330-tile route's coast tops out
  // at ~12 a side), and spawn suppression flattens income long before that.
  test("fifty ports each, long route", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [700, 527], numPorts: 50, scanRadius: 300 },
        b: { port: [1491, 451], numPorts: 50, scanRadius: 300 },
        ticks: 4_000,
      }),
    ).toMatchSnapshot();
  }, 240_000);

  // The absurd end of the port-count sweep. It runs on giantworldmap
  // (4108x1948, whose coasts fit 1000+ ocean-facing ports a side around
  // these anchors) because the world map tops out around ~320 a side. The
  // spawn-suppression midpoint sits at 400 global trade ships regardless
  // of port count, so income has long since flattened — the pinned number
  // is how little a thousand ports a side add over fifty.
  test("a thousand ports each, giant map", async () => {
    expect(
      await runTradeScenario({
        map: "giantworldmap",
        disableNavMesh: false,
        a: { port: [1400, 1018], numPorts: 1_000, scanRadius: 800 },
        b: { port: [3000, 920], numPorts: 1_000, scanRadius: 700 },
        ticks: 6_000,
      }),
    ).toMatchSnapshot();
  }, 600_000);

  // Distance sweep at a fixed ten-port fleet: ~330 tiles ("ten ports each
  // across the ocean"), ~500 tiles here, ~1800 tiles below. Longer routes
  // pay more per trade but keep ships at sea longer, which suppresses
  // spawning fleet-wide.
  test("ten ports, ~500-tile route", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380], numPorts: 10 },
        b: { port: [892, 243], numPorts: 10 },
        ticks: 3_000,
      }),
    ).toMatchSnapshot();
  }, 120_000);

  // (539,380) to (1910,765) is ~1800 tiles as the crow flies and further by
  // sea; trips outlive most of the run, so this pins the far end of the
  // distance curve. More ticks so a meaningful number of trips complete.
  test("ten ports, ~1800-tile route", async () => {
    expect(
      await runTradeScenario({
        map: "world",
        disableNavMesh: false,
        a: { port: [539, 380], numPorts: 10 },
        b: { port: [1910, 765], numPorts: 10 },
        ticks: 6_000,
      }),
    ).toMatchSnapshot();
  }, 240_000);
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
