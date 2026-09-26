import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "../src/core/execution/nation/NationNukeBehavior";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import {
  Difficulty,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

type Widths = {
  leader: number;
  near: number;
  runnerUp: number;
  far: number;
  unowned?: number;
};

/**
 * Full-height stripes on the 200x200 all-land map, left to right:
 * leader | near | runnerUp | far | unowned. "near" borders the leader,
 * "far" doesn't. Each column is half a percent of the map.
 */
async function setupStripes(difficulty: Difficulty, widths: Widths) {
  const game = await setup("big_plains", { difficulty }, [
    new PlayerInfo("leader", PlayerType.Human, null, "leader_id"),
    new PlayerInfo("near", PlayerType.Nation, null, "near_id"),
    new PlayerInfo("runnerUp", PlayerType.Human, null, "runner_up_id"),
    new PlayerInfo("far", PlayerType.Nation, null, "far_id"),
  ]);
  const [leader, near, runnerUp, far] = [
    "leader_id",
    "near_id",
    "runner_up_id",
    "far_id",
  ].map((id) => game.player(id));

  const stripes: [Player | null, number][] = [
    [leader, widths.leader],
    [near, widths.near],
    [runnerUp, widths.runnerUp],
    [far, widths.far],
    [null, widths.unowned ?? 0],
  ];
  let x = 0;
  for (const [owner, width] of stripes) {
    for (const end = x + width; x < end; x++) {
      if (owner === null) continue;
      for (let y = 0; y < game.map().height(); y++) {
        owner.conquer(game.ref(x, y));
      }
    }
  }
  expect(x).toBe(game.map().width());

  return { game, leader, near, far };
}

function nukeTarget(game: Game, nation: Player): Player | null {
  const emojiBehavior = new NationEmojiBehavior(
    new PseudoRandom(42),
    game,
    nation,
  );
  const allianceBehavior = new NationAllianceBehavior(
    new PseudoRandom(42),
    game,
    nation,
    emojiBehavior,
  );
  const attackBehavior = new AiAttackBehavior(
    new PseudoRandom(42),
    game,
    nation,
    0.5,
    0.3,
    0.2,
    allianceBehavior,
    emojiBehavior,
  );
  return new NationNukeBehavior(
    new PseudoRandom(42),
    game,
    nation,
    attackBehavior,
    emojiBehavior,
  ).findBestNukeTarget();
}

describe("Nations nuking the crown in FFA", () => {
  // Leader 45%, 4.5x everyone else, 35 points ahead of both nations
  const bigLead: Widths = {
    leader: 90,
    near: 20,
    runnerUp: 20,
    far: 20,
    unowned: 50,
  };

  it.each([
    [Difficulty.Easy, false, false],
    [Difficulty.Medium, true, false],
    [Difficulty.Hard, true, false],
    [Difficulty.Impossible, true, true],
  ])(
    "%s: nukes a far-ahead runaway leader as its neighbor: %s, from afar: %s",
    async (difficulty, nearNukes, farNukes) => {
      const { game, leader, near, far } = await setupStripes(
        difficulty,
        bigLead,
      );
      expect(nukeTarget(game, near) === leader).toBe(nearNukes);
      expect(nukeTarget(game, far) === leader).toBe(farNukes);
    },
  );

  it("Impossible: a distant nation holds off while the lead over it is small", async () => {
    // Leader 45%, 1.7x the runner-up (far, 27%)
    const { game, leader, near, far } = await setupStripes(
      Difficulty.Impossible,
      { leader: 90, near: 20, runnerUp: 36, far: 54 },
    );
    expect(nukeTarget(game, near)).toBe(leader);
    expect(nukeTarget(game, far)).toBeNull();
  });

  it.each([Difficulty.Medium, Difficulty.Hard, Difficulty.Impossible])(
    "%s: leaves a leader in a close race alone",
    async (difficulty) => {
      // Leader 35%, runner-up 30%: well ahead of the nation, but no runaway
      const { game, near } = await setupStripes(difficulty, {
        leader: 70,
        near: 20,
        runnerUp: 60,
        far: 50,
      });
      expect(nukeTarget(game, near)).toBeNull();
    },
  );

  it.each([
    Difficulty.Easy,
    Difficulty.Medium,
    Difficulty.Hard,
    Difficulty.Impossible,
  ])(
    "%s: every nation nukes a leader holding over half the map",
    async (difficulty) => {
      const { game, leader, far } = await setupStripes(difficulty, {
        leader: 110,
        near: 30,
        runnerUp: 30,
        far: 30,
      });
      expect(nukeTarget(game, far)).toBe(leader);
    },
  );
});
