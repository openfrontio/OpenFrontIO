import {
  Difficulty,
  GameMode,
  HumansVsNations,
  Nation,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { getSpawnTiles } from "@openfront/engine/execution/Util";
import { setup } from "./util/Setup";
import { UseRealAttackLogic } from "./util/TestConfig";

// A human on its 52-tile spawn at (100, 100) with a big army, and a nation owning the
// block west of it, `seconds` after the spawn phase
async function setupSpawns(
  difficulty: Difficulty,
  seconds: number,
  gameMode = GameMode.Team,
) {
  const game = await setup(
    "big_plains",
    gameMode === GameMode.Team
      ? { difficulty, gameMode, playerTeams: HumansVsNations }
      : { difficulty, gameMode },
    [new PlayerInfo("human", PlayerType.Human, null, "human_id")],
    undefined,
    UseRealAttackLogic,
    true,
    [
      new Nation(
        undefined,
        new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
      ),
    ],
  );
  const nation = game.player("nation_id");
  const human = game.player("human_id");
  for (const tile of getSpawnTiles(game.map(), game.ref(100, 100))) {
    human.conquer(tile);
  }
  for (let x = 68; x < 96; x++) {
    for (let y = 86; y < 114; y++) nation.conquer(game.ref(x, y));
  }
  human.setTroops(100_000);
  nation.setTroops(20_000);
  for (let i = 0; i < seconds * 10; i++) game.executeNextTick();
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

describe("Nations and an enemy idle on its spawn", () => {
  it.each([
    [Difficulty.Easy, 10, false],
    [Difficulty.Medium, 5, false],
    [Difficulty.Medium, 7, true],
    [Difficulty.Hard, 3, false],
    [Difficulty.Hard, 5, true],
    [Difficulty.Impossible, 3, true],
  ])(
    "%s, %is after spawn, takes it: %s",
    async (difficulty, seconds, takes) => {
      const { game, human, attackBehavior } = await setupSpawns(
        difficulty,
        seconds,
      );
      expect(attackBehavior.strikeIdleSpawn()).toBe(takes);
      for (let i = 0; i < 5; i++) game.executeNextTick();
      expect(human.isAlive()).toBe(!takes);
    },
  );

  it("takes it with a small stack, whatever its army", async () => {
    const { game, nation, human, attackBehavior } = await setupSpawns(
      Difficulty.Hard,
      5,
    );
    const spy = vi.spyOn(game, "addExecution");
    attackBehavior.strikeIdleSpawn();
    const [attack] = spy.mock.calls.map((c) => c[0] as AttackExecution);
    expect(attack).toBeInstanceOf(AttackExecution);
    expect(attack.targetID()).toBe(human.id());
    expect(attack["startTroops"]).toBeLessThan(nation.troops() / 50);
  });

  it("leaves one expanding into free land alone", async () => {
    const { game, human, attackBehavior } = await setupSpawns(
      Difficulty.Hard,
      5,
    );
    game.addExecution(
      new AttackExecution(1_000, human, game.terraNullius().id()),
    );
    game.executeNextTick();
    expect(human.numTilesOwned()).toBeLessThan(100);
    expect(attackBehavior.strikeIdleSpawn()).toBe(false);
  });

  it("leaves one that expanded alone", async () => {
    const { game, human, attackBehavior } = await setupSpawns(
      Difficulty.Hard,
      5,
    );
    for (let x = 110; x < 120; x++) {
      for (let y = 90; y < 100; y++) human.conquer(game.ref(x, y));
    }
    expect(attackBehavior.strikeIdleSpawn()).toBe(false);
  });

  it("only in team games", async () => {
    const { attackBehavior } = await setupSpawns(
      Difficulty.Impossible,
      5,
      GameMode.FFA,
    );
    expect(attackBehavior.strikeIdleSpawn()).toBe(false);
  });
});
