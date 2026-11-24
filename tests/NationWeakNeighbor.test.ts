import {
  Difficulty,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { setup } from "./util/Setup";

// The nation owns the west half of the all-land map at 20% of its max troops, below its 30%
// reserve ratio, and the human the east half
async function setupNeighbors(difficulty: Difficulty) {
  const game = await setup("big_plains", { difficulty }, [
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  ]);
  const nation = game.player("nation_id");
  const human = game.player("human_id");
  game.map().forEachTile((tile) => {
    (game.x(tile) < 100 ? nation : human).conquer(tile);
  });
  nation.setTroops(Math.floor(game.config().maxTroops(nation) * 0.2));
  const emojiBehavior = new NationEmojiBehavior(
    new PseudoRandom(42),
    game,
    nation,
  );
  const attackBehavior = new NationAttackBehavior(
    new PseudoRandom(42),
    game,
    nation,
    0.5,
    0.3,
    0.2,
    new NationAllianceBehavior(
      new PseudoRandom(42),
      game,
      nation,
      emojiBehavior,
    ),
    emojiBehavior,
    new NationWarshipBehavior(
      new PseudoRandom(42),
      game,
      nation,
      emojiBehavior,
    ),
  );
  return { game, nation, human, attackBehavior };
}

describe("Nations and a neighbor with next to no troops", () => {
  it.each([
    [Difficulty.Easy, 0.03, false],
    [Difficulty.Medium, 0.03, true],
    [Difficulty.Medium, 0.08, false],
    [Difficulty.Hard, 0.08, true],
    [Difficulty.Impossible, 0.12, true],
    [Difficulty.Impossible, 0.3, false],
  ])(
    "%s attacks one with %d of its troops, far below its max troops: %s",
    async (difficulty, share, attacks) => {
      const { game, nation, human, attackBehavior } =
        await setupNeighbors(difficulty);
      human.setTroops(Math.floor(nation.troops() * share));

      const spy = vi.spyOn(game, "addExecution");
      attackBehavior.maybeAttack();

      const sent = spy.mock.calls
        .map((c) => c[0])
        .filter(
          (e): e is AttackExecution =>
            e instanceof AttackExecution && e.targetID() === human.id(),
        );
      expect(sent.length > 0).toBe(attacks);
    },
  );
});
