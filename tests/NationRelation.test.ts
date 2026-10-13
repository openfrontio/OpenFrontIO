import {
  Cell,
  Difficulty,
  Nation,
  PlayerInfo,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AllianceRequestExecution } from "@openfront/engine/execution/alliance/AllianceRequestExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let nation: Player;
let human: Player;

// Two equally strong neighbors: the nation west of x=10, the human east of it
async function setupNeighbors(difficulty: Difficulty) {
  game = await setup("big_plains", { difficulty });
  nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation_id"),
  );
  human = game.addPlayer(
    new PlayerInfo("human", PlayerType.Human, null, "human_id"),
  );
  for (let x = 0; x < 20; x++) {
    for (let y = 0; y < 20; y++) {
      (x < 10 ? nation : human).conquer(game.ref(x, y));
    }
  }
  nation.addTroops(50_000);
  human.addTroops(50_000);
}

function attack(attacker: Player, target: Player, troops: number) {
  game.addExecution(new AttackExecution(troops, attacker, target.id()));
  game.executeNextTick();
}

describe("Nation relations", () => {
  test("a counterattack doesn't make the attacking nation hate its victim", async () => {
    await setupNeighbors(Difficulty.Medium);

    attack(nation, human, 5_000);
    attack(human, nation, 10_000);
    attack(human, nation, 10_000);

    expect(human.relation(nation)).toBe(Relation.Hostile);
    expect(nation.relation(human)).toBe(Relation.Neutral);
  });

  test("the aggressor stays hated when the victim hits back", async () => {
    await setupNeighbors(Difficulty.Medium);

    attack(human, nation, 5_000);
    attack(nation, human, 10_000);
    attack(human, nation, 5_000);

    expect(nation.relation(human)).toBe(Relation.Hostile);
    expect(human.relation(nation)).toBe(Relation.Neutral);
  });

  test("easy nations hate whoever hits back", async () => {
    await setupNeighbors(Difficulty.Easy);

    attack(nation, human, 5_000);
    attack(human, nation, 10_000);

    expect(nation.relation(human)).toBe(Relation.Hostile);
  });

  test("a nation accepts peace from a similarly strong victim that fought back", async () => {
    await setupNeighbors(Difficulty.Medium);
    const random = new PseudoRandom(46);
    const allianceBehavior = new NationAllianceBehavior(
      random,
      game,
      nation,
      new NationEmojiBehavior(random, game, nation),
    );
    // Nations reject requests sent during the spawn phase
    while (game.ticks() <= game.config().numSpawnPhaseTurns() + 1) {
      game.executeNextTick();
    }

    attack(nation, human, 5_000);
    attack(human, nation, 10_000);
    game.addExecution(new AllianceRequestExecution(human, nation.id()));
    game.executeNextTick();
    allianceBehavior.handleAllianceRequests();

    expect(nation.isAlliedWith(human)).toBe(true);
  });

  function lowestRelationWhileEmbargoed(isTemporary: boolean): Relation {
    game.addExecution(
      new NationExecution("game_id", new Nation(new Cell(5, 5), nation.info())),
    );
    human.addEmbargo(nation, isTemporary);
    let lowest = nation.relation(human);
    for (let i = 0; i < 300; i++) {
      game.executeNextTick();
      lowest = Math.min(lowest, nation.relation(human));
    }
    return lowest;
  }

  test("a nation doesn't resent the embargo its own attack triggered", async () => {
    await setupNeighbors(Difficulty.Medium);
    expect(lowestRelationWhileEmbargoed(true)).toBe(Relation.Neutral);
  });

  test("a nation resents a manual embargo", async () => {
    await setupNeighbors(Difficulty.Medium);
    expect(lowestRelationWhileEmbargoed(false)).toBe(Relation.Distrustful);
  });
});
