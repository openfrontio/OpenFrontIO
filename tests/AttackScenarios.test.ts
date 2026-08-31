/**
 * End-to-end attack benchmarks on real maps.
 *
 * Each scenario sets up two territories on a real map, gives each side a
 * troop count, launches a real AttackExecution with the real attack formula
 * and runs the simulation until the attack ends (or a
 * tick cap). The resulting metrics — how long the attack took, tiles taken,
 * troops lost on each side, and the per-second / per-tile rates — are pinned
 * in a snapshot.
 *
 * Purpose: when the attack meta is changed, the snapshot diff quantifies the
 * impact in every scenario ("attacking into mountains got 12% slower, troop
 * loss vs bots unchanged", …). A pure refactor of attackLogic must leave the
 * snapshot untouched.
 *
 * No PlayerExecution is registered, so troops do not regenerate during the
 * attack; the numbers isolate the attack formula itself.
 */
import { AttackExecution } from "../src/core/execution/AttackExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Side {
  rect: Rect;
  troops: number;
  type?: PlayerType;
  traitor?: boolean;
  /** Defense posts at these coordinates (defender only). */
  defensePosts?: [number, number][];
}

interface Scenario {
  map: string;
  attacker: Side;
  /** "terraNullius" attacks unclaimed land inside `defenderRect`. */
  defender: Side | "terraNullius";
  attackTroops: number;
  maxTicks?: number;
}

interface Metrics {
  finished: boolean;
  ticks: number;
  attackerTiles: number;
  defenderTiles: number;
  tilesConquered: number;
  attackerTroopsLost: number;
  defenderTroopsLost: number;
  tilesPerSecond: number;
  attackerLossPerSecond: number;
  defenderLossPerSecond: number;
  attackerLossPerTile: number;
  defenderLossPerTile: number;
  defenderEliminated: boolean;
}

const DEFAULT_MAX_TICKS = 3000; // 5 minutes of game time

/** Conquer every passable land tile in the rect. */
function conquerRect(game: Game, player: Player, r: Rect): void {
  const map = game.map();
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const t = map.ref(x, y);
      if (map.isLand(t) && !map.isImpassable(t)) {
        player.conquer(t);
      }
    }
  }
}

function sig(x: number): number {
  return Number(x.toPrecision(4));
}

async function runScenario(s: Scenario): Promise<Metrics> {
  const attackerInfo = new PlayerInfo(
    "attacker",
    s.attacker.type ?? PlayerType.Human,
    null,
    "attacker",
  );
  const defenderSide = s.defender === "terraNullius" ? null : s.defender;
  const defenderInfo = new PlayerInfo(
    "defender",
    defenderSide?.type ?? PlayerType.Human,
    null,
    "defender",
  );
  const game = await setup(
    s.map,
    {},
    [attackerInfo, defenderInfo],
    undefined,
    UseRealAttackLogic,
  );
  const attacker = game.player("attacker");
  const defender = game.player("defender");

  // Conquer the larger rect first so a small territory can sit inside a big
  // one (the later conquer overrides ownership).
  const area = (r: Rect) => r.w * r.h;
  const attackerFirst =
    defenderSide === null || area(s.attacker.rect) >= area(defenderSide.rect);
  if (attackerFirst) conquerRect(game, attacker, s.attacker.rect);
  if (defenderSide !== null) {
    conquerRect(game, defender, defenderSide.rect);
    defender.setTroops(defenderSide.troops);
    if (defenderSide.traitor) defender.markTraitor();
    for (const [x, y] of defenderSide.defensePosts ?? []) {
      defender.buildUnit(UnitType.DefensePost, game.ref(x, y), {});
    }
  }
  if (!attackerFirst) conquerRect(game, attacker, s.attacker.rect);
  attacker.setTroops(s.attacker.troops);
  if (s.attacker.traitor) attacker.markTraitor();

  const targetID =
    defenderSide === null ? game.terraNullius().id() : defender.id();
  const attackerTroopsBefore = attacker.troops();
  const defenderTroopsBefore = defender.troops();
  const attackerTilesBefore = attacker.numTilesOwned();
  // Actual ownership: a nested rect overrides part of the other.
  const attackerTiles = attackerTilesBefore;
  const defenderTiles = defenderSide === null ? 0 : defender.numTilesOwned();

  game.addExecution(new AttackExecution(s.attackTroops, attacker, targetID));

  const maxTicks = s.maxTicks ?? DEFAULT_MAX_TICKS;
  let ticks = 0;
  do {
    game.executeNextTick();
    ticks++;
  } while (attacker.outgoingAttacks().length > 0 && ticks < maxTicks);

  const inFlight = attacker
    .outgoingAttacks()
    .reduce((sum, a) => sum + a.troops(), 0);
  const attackerTroopsLost =
    attackerTroopsBefore - attacker.troops() - inFlight;
  const defenderTroopsLost = defenderTroopsBefore - defender.troops();
  const tilesConquered = attacker.numTilesOwned() - attackerTilesBefore;
  const seconds = ticks / 10;

  return {
    finished: attacker.outgoingAttacks().length === 0,
    ticks,
    attackerTiles,
    defenderTiles,
    tilesConquered,
    attackerTroopsLost,
    defenderTroopsLost,
    tilesPerSecond: sig(tilesConquered / seconds),
    attackerLossPerSecond: sig(attackerTroopsLost / seconds),
    defenderLossPerSecond: sig(defenderTroopsLost / seconds),
    attackerLossPerTile: sig(
      tilesConquered === 0 ? 0 : attackerTroopsLost / tilesConquered,
    ),
    defenderLossPerTile: sig(
      tilesConquered === 0 ? 0 : defenderTroopsLost / tilesConquered,
    ),
    defenderEliminated: defenderSide !== null && !defender.isAlive(),
  };
}

// plains: 100x100, all Plains terrain. Left half vs right half.
const PLAINS_LEFT: Rect = { x: 0, y: 0, w: 50, h: 100 };
const PLAINS_RIGHT: Rect = { x: 50, y: 0, w: 50, h: 100 };

// big_plains: 200x200, all Plains terrain.
const BIG_LEFT: Rect = { x: 0, y: 0, w: 100, h: 200 };
const BIG_RIGHT: Rect = { x: 100, y: 0, w: 100, h: 200 };

// world: 2000x1000 mixed terrain. These 100x100 blocks are fully land:
//   (1200,100) mostly Plains, some Highland
//   (1300,200) Highland + Mountain
//   (1400,200) mostly Mountain
function worldBlock(bx: number, by: number): [Rect, Rect] {
  return [
    { x: bx, y: by, w: 50, h: 100 },
    { x: bx + 50, y: by, w: 50, h: 100 },
  ];
}
const [WORLD_PLAINS_L, WORLD_PLAINS_R] = worldBlock(1200, 100);
const [WORLD_HILLS_L, WORLD_HILLS_R] = worldBlock(1300, 200);
const [WORLD_MTN_L, WORLD_MTN_R] = worldBlock(1400, 200);

// 20x20 (400-tile) turtle in the middle of the plains map, surrounded by the
// attacker. Note: players with < 100 tiles are conquered outright after
// losing a single tile (AttackExecution.handleDeadDefender), so turtles must
// be bigger than that to exercise the formula.
const PLAINS_TURTLE: Rect = { x: 40, y: 40, w: 20, h: 20 };
const PLAINS_TURTLE_TINY: Rect = { x: 45, y: 45, w: 10, h: 10 };

// giantworldmap: 4108x1948, ~2.3M passable land tiles.
// x 1600..3000 full height: ~1.01M land tiles; x 3000..4108: ~590k.
const GIANT_WEST: Rect = { x: 1600, y: 0, w: 1400, h: 1948 };
const GIANT_EAST: Rect = { x: 3000, y: 0, w: 1108, h: 1948 };
// 20x20 turtle on solid land inside GIANT_WEST.
const GIANT_TURTLE: Rect = { x: 2400, y: 300, w: 20, h: 20 };

const scenarios: Record<string, Scenario> = {
  // --- plains, equal territories, vary attack size --------------------------
  "plains equal 50k vs 50k, attack 10k": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000 },
    attackTroops: 10_000,
  },
  "plains equal 50k vs 50k, attack 25k": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000 },
    attackTroops: 25_000,
  },
  "plains equal 50k vs 50k, attack 50k (all-in)": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000 },
    attackTroops: 50_000,
  },
  "plains dense defender (200k on 5k tiles, 40/tile, ~half the no-city cap), stack 1/4 their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 400_000 },
      defender: { rect: PLAINS_RIGHT, troops: 200_000 },
      attackTroops: 50_000,
    },
  "plains dense defender (200k on 5k tiles, 40/tile, ~half the no-city cap), stack 3/4 their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 400_000 },
      defender: { rect: PLAINS_RIGHT, troops: 200_000 },
      attackTroops: 150_000,
    },
  "plains dense defender (200k on 5k tiles, 40/tile, ~half the no-city cap), stack 1x their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 400_000 },
      defender: { rect: PLAINS_RIGHT, troops: 200_000 },
      attackTroops: 200_000,
    },
  "plains dense defender (200k on 5k tiles, 40/tile, ~half the no-city cap), stack 1.67x their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 400_000 },
      defender: { rect: PLAINS_RIGHT, troops: 200_000 },
      attackTroops: 334_000,
    },
  "plains very dense defender (650k on 5k tiles, 130/tile, ~1 city over cap), stack 1/4 their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 1_300_000 },
      defender: { rect: PLAINS_RIGHT, troops: 650_000 },
      attackTroops: 162_500,
    },
  "plains very dense defender (650k on 5k tiles, 130/tile, ~1 city over cap), stack 3/4 their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 1_300_000 },
      defender: { rect: PLAINS_RIGHT, troops: 650_000 },
      attackTroops: 487_500,
    },
  "plains very dense defender (650k on 5k tiles, 130/tile, ~1 city over cap), stack 1x their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 1_300_000 },
      defender: { rect: PLAINS_RIGHT, troops: 650_000 },
      attackTroops: 650_000,
    },
  "plains very dense defender (650k on 5k tiles, 130/tile, ~1 city over cap), stack 1.67x their army":
    {
      map: "plains",
      attacker: { rect: PLAINS_LEFT, troops: 1_300_000 },
      defender: { rect: PLAINS_RIGHT, troops: 650_000 },
      attackTroops: 1_085_500,
    },
  // --- plains, troop imbalance ---------------------------------------------
  "plains overwhelming 200k vs 20k, attack 40k": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 200_000 },
    defender: { rect: PLAINS_RIGHT, troops: 20_000 },
    attackTroops: 40_000,
  },
  "plains outmatched 20k vs 200k, attack 4k": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 20_000 },
    defender: { rect: PLAINS_RIGHT, troops: 200_000 },
    attackTroops: 4_000,
  },
  "plains outmatched 20k vs 200k, attack 20k (all-in)": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 20_000 },
    defender: { rect: PLAINS_RIGHT, troops: 200_000 },
    attackTroops: 20_000,
  },
  // --- plains, territory imbalance -----------------------------------------
  "plains small attacker (500 tiles) vs big defender (9500 tiles)": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 5, h: 100 }, troops: 50_000 },
    defender: { rect: { x: 5, y: 0, w: 95, h: 100 }, troops: 50_000 },
    attackTroops: 10_000,
  },
  "plains big attacker (9500 tiles) vs small defender (500 tiles)": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 95, h: 100 }, troops: 50_000 },
    defender: { rect: { x: 95, y: 0, w: 5, h: 100 }, troops: 50_000 },
    attackTroops: 10_000,
  },
  // --- player types ---------------------------------------------------------
  "plains human vs bot defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000, type: PlayerType.Bot },
    attackTroops: 10_000,
  },
  "plains nation vs bot defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000, type: PlayerType.Nation },
    defender: { rect: PLAINS_RIGHT, troops: 50_000, type: PlayerType.Bot },
    attackTroops: 10_000,
  },
  "plains bot vs human defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000, type: PlayerType.Bot },
    defender: { rect: PLAINS_RIGHT, troops: 50_000 },
    attackTroops: 10_000,
  },
  // --- modifiers ------------------------------------------------------------
  "plains traitor defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000, traitor: true },
    attackTroops: 10_000,
  },
  "plains defender with one defense post at the border": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: {
      rect: PLAINS_RIGHT,
      troops: 50_000,
      defensePosts: [[55, 50]],
    },
    attackTroops: 10_000,
  },
  "plains defender with defense posts covering the whole border": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: {
      rect: PLAINS_RIGHT,
      troops: 50_000,
      defensePosts: [
        [55, 10],
        [55, 50],
        [55, 90],
      ],
    },
    attackTroops: 10_000,
  },
  // --- terra nullius --------------------------------------------------------
  "plains human vs terra nullius, attack 2k": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 10, h: 100 }, troops: 10_000 },
    defender: "terraNullius",
    attackTroops: 2_000,
  },
  "plains human vs terra nullius, attack 20k": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 10, h: 100 }, troops: 100_000 },
    defender: "terraNullius",
    attackTroops: 20_000,
  },
  "plains bot vs terra nullius, attack 2k": {
    map: "plains",
    attacker: {
      rect: { x: 0, y: 0, w: 10, h: 100 },
      troops: 10_000,
      type: PlayerType.Bot,
    },
    defender: "terraNullius",
    attackTroops: 2_000,
  },
  // --- bigger territories ---------------------------------------------------
  "big_plains equal 20k tiles each, 200k vs 200k, attack 40k": {
    map: "big_plains",
    attacker: { rect: BIG_LEFT, troops: 200_000 },
    defender: { rect: BIG_RIGHT, troops: 200_000 },
    attackTroops: 40_000,
  },
  "big_plains equal 20k tiles each, 1M vs 1M, attack 200k": {
    map: "big_plains",
    attacker: { rect: BIG_LEFT, troops: 1_000_000 },
    defender: { rect: BIG_RIGHT, troops: 1_000_000 },
    attackTroops: 200_000,
  },
  // --- world map, real terrain ---------------------------------------------
  "world plains-ish region, 100k vs 100k, attack 20k": {
    map: "world",
    attacker: { rect: WORLD_PLAINS_L, troops: 100_000 },
    defender: { rect: WORLD_PLAINS_R, troops: 100_000 },
    attackTroops: 20_000,
  },
  "world highland/mountain region, 100k vs 100k, attack 20k": {
    map: "world",
    attacker: { rect: WORLD_HILLS_L, troops: 100_000 },
    defender: { rect: WORLD_HILLS_R, troops: 100_000 },
    attackTroops: 20_000,
  },
  "world mountain region, 100k vs 100k, attack 20k": {
    map: "world",
    attacker: { rect: WORLD_MTN_L, troops: 100_000 },
    defender: { rect: WORLD_MTN_R, troops: 100_000 },
    attackTroops: 20_000,
  },
  "world mountain region, human vs terra nullius, attack 20k": {
    map: "world",
    attacker: { rect: WORLD_MTN_L, troops: 100_000 },
    defender: "terraNullius",
    attackTroops: 20_000,
  },
  // Large empires (>100k tiles) trigger the large-attacker/defender curves.
  "world huge empires (~150k tiles each), 2M vs 2M, attack 400k": {
    map: "world",
    attacker: { rect: { x: 800, y: 100, w: 400, h: 400 }, troops: 2_000_000 },
    defender: { rect: { x: 1200, y: 100, w: 400, h: 400 }, troops: 2_000_000 },
    attackTroops: 400_000,
  },
  // --- extremes -------------------------------------------------------------
  // The extremes are where formulas break.
  "plains 1-troop attack vs 50k defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 50_000 },
    attackTroops: 1,
  },
  "plains 100-troop attack vs 1M defender": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 1_000_000 },
    attackTroops: 100,
  },
  "plains 10M-troop attack vs defender with 1 troop": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 10_000_000 },
    defender: { rect: PLAINS_RIGHT, troops: 1 },
    attackTroops: 10_000_000,
  },
  "plains 50k attack vs defender with 0 troops": {
    map: "plains",
    attacker: { rect: PLAINS_LEFT, troops: 50_000 },
    defender: { rect: PLAINS_RIGHT, troops: 0 },
    attackTroops: 50_000,
  },
  "plains 400-tile turtle, 400k troops (1k/tile), attacked with 400k": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 100, h: 100 }, troops: 2_000_000 },
    defender: { rect: PLAINS_TURTLE, troops: 400_000 },
    attackTroops: 400_000,
  },
  "plains 400-tile turtle, 4M troops (10k/tile) under a defense post, attacked with 1M":
    {
      map: "plains",
      attacker: { rect: { x: 0, y: 0, w: 100, h: 100 }, troops: 2_000_000 },
      defender: {
        rect: PLAINS_TURTLE,
        troops: 4_000_000,
        defensePosts: [[50, 50]],
      },
      attackTroops: 1_000_000,
    },
  // Documents the <100-tile instant-conquest rule, not the formula.
  "plains 100-tile turtle, 1M troops: conquered outright after one tile": {
    map: "plains",
    attacker: { rect: { x: 0, y: 0, w: 100, h: 100 }, troops: 2_000_000 },
    defender: { rect: PLAINS_TURTLE_TINY, troops: 1_000_000 },
    attackTroops: 100_000,
  },
  "giant 1M-tile attacker, 8M troops, attack 2M vs 400-tile turtle with 400k (1k/tile)":
    {
      map: "giantworldmap",
      attacker: { rect: GIANT_WEST, troops: 8_000_000 },
      defender: { rect: GIANT_TURTLE, troops: 400_000 },
      attackTroops: 2_000_000,
    },
  "giant 1M-tile attacker, 8M troops, attack 2M vs 400-tile turtle with 4M (10k/tile)":
    {
      map: "giantworldmap",
      attacker: { rect: GIANT_WEST, troops: 8_000_000 },
      defender: { rect: GIANT_TURTLE, troops: 4_000_000 },
      attackTroops: 2_000_000,
    },
  "giant 400-tile attacker, 100k troops, attack 50k vs 1M-tile sparse defender with 1M":
    {
      map: "giantworldmap",
      attacker: { rect: GIANT_TURTLE, troops: 100_000 },
      defender: { rect: GIANT_WEST, troops: 1_000_000 },
      attackTroops: 50_000,
    },
  "giant 400-tile attacker, 1M troops all-in vs 1M-tile defender with 1M": {
    map: "giantworldmap",
    attacker: { rect: GIANT_TURTLE, troops: 1_000_000 },
    defender: { rect: GIANT_WEST, troops: 1_000_000 },
    attackTroops: 1_000_000,
  },
  "giant 1M vs 600k tiles, 8M vs 8M troops, attack 2M": {
    map: "giantworldmap",
    attacker: { rect: GIANT_WEST, troops: 8_000_000 },
    defender: { rect: GIANT_EAST, troops: 8_000_000 },
    attackTroops: 2_000_000,
  },
  "giant 1M vs 600k tiles, 8M troops all-in vs 1M defender": {
    map: "giantworldmap",
    attacker: { rect: GIANT_WEST, troops: 8_000_000 },
    defender: { rect: GIANT_EAST, troops: 1_000_000 },
    attackTroops: 8_000_000,
  },
  "giant 600k vs 1M tiles, 1M troops attack 500k vs 8M defender": {
    map: "giantworldmap",
    attacker: { rect: GIANT_EAST, troops: 1_000_000 },
    defender: { rect: GIANT_WEST, troops: 8_000_000 },
    attackTroops: 500_000,
  },
};

describe("attack scenarios", () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    test(
      name,
      async () => {
        const metrics = await runScenario(scenario);
        expect(metrics).toMatchSnapshot();
      },
      120_000,
    );
  }
});
