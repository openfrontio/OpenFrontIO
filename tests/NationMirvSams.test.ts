import {
  Difficulty,
  PlayerInfo,
  PlayerType,
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
import { vi } from "vitest";
import { createGame, L, W } from "./core/pathfinding/_fixtures";

const SIZE = 200;
const LEADER_WEST_EDGE = 45;

// 200x200 land in a ring of water, so territory samples span the whole territory: `nation`
// west of x=40, `bystander` up to x=45, and `leader` with the remaining 77%. With `sams`, a grid
// of the test config's 20-tile SAMs covers all of it.
function setupLeader(difficulty: Difficulty, { sams }: { sams: boolean }) {
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
  game.map().forEachTile((tile) => {
    if (!game.map().isLand(tile)) return;
    const x = game.x(tile);
    if (x < 40) nation.conquer(tile);
    else if (x < LEADER_WEST_EDGE) bystander.conquer(tile);
    else leader.conquer(tile);
  });
  leader.buildUnit(UnitType.City, game.ref(120, 100), {});
  if (sams) {
    for (let x = LEADER_WEST_EDGE + 12; x < SIZE; x += 25) {
      for (let y = 12; y < SIZE; y += 25) {
        leader.buildUnit(UnitType.SAMLauncher, game.ref(x, y), {});
      }
    }
  }
  nation.buildUnit(UnitType.MissileSilo, game.ref(20, 100), {});
  game.endSpawnPhase();
  return { game, nation, leader };
}

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

  it.each([
    [false, 20_000_000n],
    [true, 5_000_000n],
  ])(
    "leader under SAMs: %s, a hydrogen bomb feels like it costs %i",
    (sams, perceived) => {
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
      behavior["hydrogenBombPerceivedCost"] = 20_000_000n;
      expect(behavior["getPerceivedNukeCost"](UnitType.HydrogenBomb)).toBe(
        perceived,
      );
    },
  );

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
