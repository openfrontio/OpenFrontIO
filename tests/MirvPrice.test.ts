import { MirvExecution } from "../src/core/execution/MIRVExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let human: Player;
let nation: Player;

function mirvPrice(player: Player): bigint {
  return game.unitInfo(UnitType.MIRV).cost(game, player);
}

describe("MIRV price", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("human", PlayerType.Human, "c1", "h1"),
    ]);
    human = game.player("h1");
    nation = game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "n1"),
    );
    human.conquer(game.ref(0, 0));
    nation.conquer(game.ref(50, 50));
    human.conquer(game.ref(90, 90));
    for (const p of [human, nation]) p.addGold(1_000_000_000n);
  });

  test("rises with every MIRV launched, by anyone", () => {
    expect(game.mirvsLaunched()).toBe(0);
    expect(mirvPrice(human)).toBe(25_000_000n);

    nation.buildUnit(UnitType.MissileSilo, game.ref(50, 50), {});
    game.addExecution(new MirvExecution(nation, game.ref(90, 90)));
    executeTicks(game, 2);

    // A nation has no per-player stats entry; its launch still counts.
    expect(game.mirvsLaunched()).toBe(1);
    expect(mirvPrice(human)).toBe(40_000_000n);
    expect(mirvPrice(nation)).toBe(40_000_000n);
  });

  test("a fizzled launch does not count", () => {
    // No silo, so the MIRV never spawns.
    game.addExecution(new MirvExecution(human, game.ref(50, 50)));
    executeTicks(game, 2);

    expect(human.units(UnitType.MIRV)).toHaveLength(0);
    expect(game.mirvsLaunched()).toBe(0);
    expect(mirvPrice(human)).toBe(25_000_000n);
  });
});
