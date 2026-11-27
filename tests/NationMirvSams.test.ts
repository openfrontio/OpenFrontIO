import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  TerraNullius,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { MirvExecution } from "@openfront/engine/execution/MIRVExecution";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import {
  mirvLeakShare,
  NationMIRVBehavior,
} from "@openfront/engine/execution/nation/NationMIRVBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { Game, Player } from "@openfront/engine/game/Game";
import { vi } from "vitest";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

const SIZE = 200;
const LEADER_WEST_EDGE = 45;

// 200x200 land in a ring of water, so territory samples span the whole territory: `nation`,
// `bystander` and `leader` own the land west of each of `eastEdges`, the rest is free.
function setupField(difficulty: Difficulty, eastEdges: number[]) {
  const grid: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      grid.push(x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1 ? W : L);
    }
  }
  const game = createGame({ width: SIZE, height: SIZE, grid }, { difficulty });
  const add = (id: string, type: PlayerType) =>
    game.addPlayer(new PlayerInfo(id, type, null, `${id}_id`));
  const nation = add("nation", PlayerType.Nation);
  const bystander = add("bystander", PlayerType.Human);
  const leader = add("leader", PlayerType.Human);
  const owners = [nation, bystander, leader];
  game.map().forEachTile((tile) => {
    if (!game.map().isLand(tile)) return;
    const x = game.x(tile);
    owners[eastEdges.findIndex((edge) => x < edge)]?.conquer(tile);
  });
  nation.buildUnit(UnitType.MissileSilo, game.ref(5, 100), {});
  return { game, nation, bystander, leader };
}

// `leader` owns the 77% east of x=45. With `sams`, a grid of the test config's 20-tile SAMs covers all of it.
function setupLeader(difficulty: Difficulty, { sams }: { sams: boolean }) {
  const { game, nation, leader } = setupField(difficulty, [
    40,
    LEADER_WEST_EDGE,
    SIZE,
  ]);
  leader.buildUnit(UnitType.City, game.ref(120, 100), {});
  if (sams) {
    for (let x = LEADER_WEST_EDGE + 12; x < SIZE; x += 25) {
      for (let y = 12; y < SIZE; y += 25) {
        leader.buildUnit(UnitType.SAMLauncher, game.ref(x, y), {});
      }
    }
  }
  game.endSpawnPhase();
  return { game, nation, leader };
}

// `leader` owns 48% of the land, 43 points more than `nation`, and 9.5x as much as `bystander`, which
// borders `nation` and is a bit bigger
function setupRunawayLeader(difficulty: Difficulty) {
  const field = setupField(difficulty, [10, 20, 115]);
  field.game.endSpawnPhase();
  return field;
}

function mirvTarget(game: Game, nation: Player): Player | TerraNullius | null {
  nation.addGold(100_000_000n);
  const random = new PseudoRandom(1);
  vi.spyOn(random, "chance").mockReturnValue(false);
  const behavior = new NationMIRVBehavior(
    random,
    game,
    nation,
    new NationEmojiBehavior(random, game, nation),
  );
  const spy = vi.spyOn(game, "addExecution");
  behavior.considerMIRV();
  const mirv = spy.mock.calls
    .map(([e]) => e)
    .find((e) => e instanceof MirvExecution);
  return mirv === undefined ? null : game.owner(mirv["dst"]);
}

describe("Nations and MIRVs at players close to winning", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Hard's victory denial bar is half the land without fallout; leads count from minute 8, and a
  // runaway leader we don't border must be 40 points ahead of us
  it.each([
    ["no one is close to winning", 0, 0, "bystander"],
    ["a runaway leader", 8 * 600, 0, "leader"],
    ["a leader over half the land without fallout", 0, 12_000, "leader"],
  ] as const)("Hard, %s: MIRVs the %s", (_, ticks, fallout, target) => {
    const players = setupRunawayLeader(Difficulty.Hard);
    const { game, nation } = players;
    vi.spyOn(game, "ticks").mockReturnValue(
      game.config().numSpawnPhaseTurns() + ticks,
    );
    vi.spyOn(game, "numTilesWithFallout").mockReturnValue(fallout);
    expect(mirvTarget(game, nation)).toBe(players[target]);
  });

  it("Hard saves up for a MIRV and a hydrogen bomb before anyone is close to winning", () => {
    const { game, nation } = setupRunawayLeader(Difficulty.Hard);
    const behavior = new NationStructureBehavior(
      new PseudoRandom(1),
      game,
      nation,
    );
    expect(behavior["getSaveUpTarget"]()).toBe(30_000_000n);
  });
});

describe("MIRV warheads getting past SAMs", () => {
  it("every warhead lands without SAMs, none under a full SAM grid", () => {
    const open = setupLeader(Difficulty.Hard, { sams: false });
    expect(mirvLeakShare(open.game, open.nation, open.leader)).toBe(1);
    const covered = setupLeader(Difficulty.Hard, { sams: true });
    expect(
      mirvLeakShare(covered.game, covered.nation, covered.leader),
    ).toBeCloseTo(0);
  });

  // ~15 warheads land in range of one SAM covering all of the leader, which shoots its level in warheads
  it.each([
    [1, 0.85, 1],
    [15, 0, 0.2],
  ])("a level %i SAM lets through between %d and %d", (level, min, max) => {
    const { game, nation, leader } = setupLeader(Difficulty.Hard, {
      sams: false,
    });
    vi.spyOn(game.config(), "samRange").mockReturnValue(130);
    const sam = leader.buildUnit(UnitType.SAMLauncher, game.ref(122, 100), {});
    for (let l = 1; l < level; l++) sam.increaseLevel();
    const leak = mirvLeakShare(game, nation, leader);
    expect(leak).toBeGreaterThanOrEqual(min);
    expect(leak).toBeLessThanOrEqual(max);
  });
});

describe("Nations and MIRVs at small targets", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // With 80-tile hydrogen bomb blasts, Hard wants a target of 20k tiles for a MIRV at its 25M base
  // price and 44k at 55M; the leader has 30k
  it.each([
    [Difficulty.Hard, 0, true],
    [Difficulty.Hard, 2, false],
    [Difficulty.Easy, 2, true],
  ])(
    "%s with %i MIRVs launched before MIRVs the leader: %s",
    (difficulty, launched, launches) => {
      const { game, nation } = setupLeader(difficulty, { sams: false });
      vi.spyOn(game.config(), "nukeMagnitudes").mockReturnValue({
        inner: 60,
        outer: 80,
      });
      vi.spyOn(game, "mirvsLaunched").mockReturnValue(launched);
      nation.addGold(100_000_000n);
      const random = new PseudoRandom(1);
      vi.spyOn(random, "chance").mockReturnValue(false);
      const behavior = new NationMIRVBehavior(
        random,
        game,
        nation,
        new NationEmojiBehavior(random, game, nation),
      );
      const spy = vi.spyOn(game, "addExecution");
      behavior.considerMIRV();
      expect(spy.mock.calls.some(([e]) => e instanceof MirvExecution)).toBe(
        launches,
      );
    },
  );
});

describe("Nations and MIRVs against SAM-covered leaders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [Difficulty.Hard, false, 30_000_000n], // a MIRV and a hydrogen bomb
    [Difficulty.Hard, true, 25_000_000n], // five hydrogen bombs
    [Difficulty.Easy, true, 30_000_000n],
  ])(
    "%s, leader under SAMs: %s, saves up %i",
    (difficulty, sams, saveUpTarget) => {
      const { game, nation } = setupLeader(difficulty, { sams });
      const behavior = new NationStructureBehavior(
        new PseudoRandom(1),
        game,
        nation,
      );
      expect(behavior["getSaveUpTarget"]()).toBe(saveUpTarget);
    },
  );

  // Hard & Impossible keep pacing their nukes even when no MIRV is worth saving for
  it.each([
    [Difficulty.Medium, false, 20_000_000n],
    [Difficulty.Medium, true, 5_000_000n],
    [Difficulty.Hard, true, 20_000_000n],
  ])(
    "%s, leader under SAMs: %s, a hydrogen bomb launched just now makes the next feel like %i",
    (difficulty, sams, perceived) => {
      const { game, nation } = setupLeader(difficulty, { sams });
      nation.addGold(10_000_000n);
      const random = new PseudoRandom(1);
      const behavior = new NationNukeBehavior(
        random,
        game,
        nation,
        null as any,
        new NationEmojiBehavior(random, game, nation),
      );
      behavior["hydrogenBombPerceivedCost"] = 20_000_000n;
      behavior["hydrogenBombLastLaunch"] = game.ticks();
      expect(behavior["getPerceivedNukeCost"](UnitType.HydrogenBomb)).toBe(
        perceived,
      );
    },
  );

  it.each([
    [false, true],
    [true, false],
  ])("Hard, leader under SAMs: %s, saves up for a MIRV: %s", (sams, saving) => {
    const { game, nation } = setupLeader(Difficulty.Hard, { sams });
    nation.addGold(10_000_000n);
    const random = new PseudoRandom(1);
    const behavior = new NationNukeBehavior(
      random,
      game,
      nation,
      null as any,
      new NationEmojiBehavior(random, game, nation),
    );
    expect(behavior["isSavingForMirv"]()).toBe(saving);
  });

  it.each([
    [Difficulty.Hard, false, true],
    [Difficulty.Hard, true, false],
    [Difficulty.Easy, true, true],
  ])(
    "%s, leader under SAMs: %s, MIRVs the leader: %s",
    (difficulty, sams, launches) => {
      const { game, nation } = setupLeader(difficulty, { sams });
      nation.addGold(100_000_000n);
      const random = new PseudoRandom(1);
      vi.spyOn(random, "chance").mockReturnValue(false);
      const behavior = new NationMIRVBehavior(
        random,
        game,
        nation,
        new NationEmojiBehavior(random, game, nation),
      );
      const spy = vi.spyOn(game, "addExecution");
      behavior.considerMIRV();
      expect(spy.mock.calls.some(([e]) => e instanceof MirvExecution)).toBe(
        launches,
      );
    },
  );
});
