import {
  Difficulty,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationAttackBehavior } from "@openfront/engine/execution/nation/NationAttackBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationNukeBehavior } from "@openfront/engine/execution/nation/NationNukeBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { NukeFund } from "@openfront/engine/execution/nation/NationUtils";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { NukeExecution } from "@openfront/engine/execution/NukeExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

const HYDRO_PRICE = 5_000_000n;

/**
 * Full-height stripes on the 200x200 all-land map, left to right:
 * leader | nation | runnerUp | far | unowned. The human leader holds 45%,
 * 6x the field's median and 37.5 points more than the nation bordering it,
 * which owns five cities and a missile silo. The clock reads 8 minutes past
 * the spawn phase, when leads start to count.
 */
async function setupRunaway(difficulty: Difficulty) {
  const game = await setup("big_plains", { difficulty }, [
    new PlayerInfo("leader", PlayerType.Human, null, "leader_id"),
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
    new PlayerInfo("runnerUp", PlayerType.Human, null, "runner_up_id"),
    new PlayerInfo("far", PlayerType.Nation, null, "far_id"),
  ]);
  const [leader, nation, runnerUp, far] = [
    "leader_id",
    "nation_id",
    "runner_up_id",
    "far_id",
  ].map((id) => game.player(id));
  const stripes: [Player | null, number][] = [
    [leader, 90],
    [nation, 15],
    [runnerUp, 15],
    [far, 15],
    [null, 65],
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
  vi.spyOn(game, "ticks").mockReturnValue(
    game.config().numSpawnPhaseTurns() + 8 * 600,
  );
  for (let i = 0; i < 5; i++) {
    nation.buildUnit(UnitType.City, game.ref(97, 20 + 30 * i), {});
  }
  nation.buildUnit(UnitType.MissileSilo, game.ref(97, 180), {});
  nation.addTroops(100_000);
  const setGold = (gold: bigint) => {
    nation.removeGold(nation.gold());
    nation.addGold(gold);
  };
  return { game, leader, nation, runnerUp, far, setGold };
}

function nukeBehavior(
  game: Game,
  nation: Player,
  nukeFund: NukeFund | null = null,
): NationNukeBehavior {
  const random = new PseudoRandom(1);
  const emoji = new NationEmojiBehavior(random, game, nation);
  const attack = new NationAttackBehavior(
    random,
    game,
    nation,
    0.5,
    0.3,
    0.2,
    new NationAllianceBehavior(random, game, nation, emoji),
    emoji,
    new NationWarshipBehavior(random, game, nation, emoji),
  );
  return new NationNukeBehavior(random, game, nation, attack, emoji, nukeFund);
}

/** Types of the nukes queued by `send`, with the names of the players they aim at. */
function nukesSent(game: Game, send: () => void): [UnitType, string][] {
  const spy = vi.spyOn(game, "addExecution");
  send();
  const sent = spy.mock.calls
    .map((c) => c[0])
    .filter((e) => e instanceof NukeExecution)
    .map((e): [UnitType, string] => [
      e["nukeType"],
      (game.owner(e["dst"]) as Player).name(),
    ]);
  spy.mockRestore();
  return sent;
}

describe("Nations setting gold aside for nukes at a runaway leader", () => {
  it.each([
    [Difficulty.Easy, 0n, 0n],
    [Difficulty.Medium, 1_000_000n, 2_000_000n],
    [Difficulty.Hard, 2_000_000n, 4_000_000n],
    [Difficulty.Impossible, 3_000_000n, HYDRO_PRICE],
  ])(
    "%s keeps %d of 10M income from structures, %d of 20M",
    async (difficulty, afterOne, afterTwo) => {
      const { game, nation, setGold } = await setupRunaway(difficulty);
      setGold(0n);
      const structures = new NationStructureBehavior(
        new PseudoRandom(7),
        game,
        nation,
      );
      // Income from before the first look isn't counted
      structures.handleStructures();
      for (const expected of [afterOne, afterTwo]) {
        nation.addGold(10_000_000n);
        structures.handleStructures();
        expect(structures.nukeFund()).toBe(expected);
        expect(structures["spendableGold"]()).toBe(nation.gold() - expected);
      }
    },
  );

  it("lets it go once the leader is caught up", async () => {
    const { game, leader, runnerUp, far, nation, setGold } = await setupRunaway(
      Difficulty.Impossible,
    );
    setGold(0n);
    const structures = new NationStructureBehavior(
      new PseudoRandom(7),
      game,
      nation,
    );
    structures.handleStructures();
    nation.addGold(20_000_000n);
    structures.handleStructures();
    expect(structures.nukeFund()).toBe(HYDRO_PRICE);

    // The runner-up and far take 25 columns each, leaving three players at 40
    for (let x = 40; x < 90; x++) {
      for (let y = 0; y < game.map().height(); y++) {
        (x < 65 ? runnerUp : far).conquer(game.ref(x, y));
      }
    }
    expect(leader.numTilesOwned()).toBe(40 * 200);
    structures.handleStructures();
    expect(structures.nukeFund()).toBe(0n);
    expect(structures["spendableGold"]()).toBe(nation.gold());
  });
});

describe("Nations nuking a runaway leader", () => {
  it("Impossible sends a hydrogen bomb at it while saving up for a MIRV", async () => {
    const { game, leader, nation, setGold } = await setupRunaway(
      Difficulty.Impossible,
    );
    leader.buildUnit(UnitType.City, game.ref(50, 100), {});
    // 10M of a MIRV and a hydrogen bomb's 30M, with income enough to save the rest
    setGold(30_000_000n);
    nation.removeGold(20_000_000n);
    const behavior = nukeBehavior(game, nation);
    expect(behavior["isSavingForMirv"]()).toBe(true);

    expect(nukesSent(game, () => behavior.maybeSendNuke())).toEqual([
      [UnitType.HydrogenBomb, leader.name()],
    ]);
  });

  it.each([
    [
      "spends the gold set aside for the leader only on the leader",
      HYDRO_PRICE,
    ],
    ["without it, hits the player it hates most", 0n],
  ])("Impossible %s", async (_, kept) => {
    const { game, leader, nation, far, setGold } = await setupRunaway(
      Difficulty.Impossible,
    );
    leader.buildUnit(UnitType.City, game.ref(50, 100), {});
    // As strong as the nation, so not too weak to be worth a nuke
    for (let i = 0; i < 5; i++) {
      far.buildUnit(UnitType.City, game.ref(127, 20 + 30 * i), {});
    }
    far.addTroops(100_000);
    nation.updateRelation(far, -100);
    setGold(HYDRO_PRICE);
    const spend = vi.fn();
    const behavior = nukeBehavior(game, nation, {
      nukeFund: () => kept,
      spendNukeFund: spend,
    });

    expect(nukesSent(game, () => behavior.maybeSendNuke())).toEqual([
      [UnitType.HydrogenBomb, (kept > 0n ? leader : far).name()],
    ]);
    if (kept > 0n) {
      expect(spend).toHaveBeenCalledWith(HYDRO_PRICE);
    } else {
      expect(spend).not.toHaveBeenCalled();
    }
  });

  it("Impossible aims its SAM salvo at the leader when only the leader is funded", async () => {
    const { game, leader, nation, far, setGold } = await setupRunaway(
      Difficulty.Impossible,
    );
    leader.buildUnit(UnitType.City, game.ref(50, 100), {});
    // Covers the leader's only structures, so no direct launch gets through
    leader.buildUnit(UnitType.SAMLauncher, game.ref(50, 105), {});
    // A second silo, so two atom bombs can arrive at once
    nation.buildUnit(UnitType.MissileSilo, game.ref(100, 35), {});
    for (let i = 0; i < 5; i++) {
      far.buildUnit(UnitType.City, game.ref(127, 20 + 30 * i), {});
    }
    far.addTroops(100_000);
    nation.updateRelation(far, -100);
    setGold(HYDRO_PRICE);
    const spend = vi.fn();
    const behavior = nukeBehavior(game, nation, {
      nukeFund: () => HYDRO_PRICE,
      spendNukeFund: spend,
    });

    expect(nukesSent(game, () => behavior.maybeSendNuke())).toEqual([
      [UnitType.AtomBomb, leader.name()],
      [UnitType.AtomBomb, leader.name()],
    ]);
    const atomCost = game.unitInfo(UnitType.AtomBomb).cost(game, nation);
    expect(spend).toHaveBeenCalledWith(atomCost * 2n);
  });
});
