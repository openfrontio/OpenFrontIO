import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
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
let player1: Player;
let player2: Player;

describe("MIRV betrayal side effects", () => {
  beforeEach(async () => {
    game = await setup("plains", { instantBuild: true }, [
      new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
      new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
    ]);

    player1 = game.player("p1");
    player2 = game.player("p2");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(10, 10));

    player1.addGold(1_000_000_000n);
    player2.addGold(1_000_000_000n);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();
    expect(player1.isAlliedWith(player2)).toBe(true);
  });

  test("a successful launch breaks the alliance and marks the launcher a traitor", () => {
    player1.buildUnit(UnitType.MissileSilo, game.ref(0, 0), {});

    game.addExecution(new MirvExecution(player1, game.ref(10, 10)));
    executeTicks(game, 2); // init + spawn

    expect(player1.units(UnitType.MIRV)).toHaveLength(1);
    expect(player1.isAlliedWith(player2)).toBe(false);
    expect(player1.isTraitor()).toBe(true);
  });

  test("a fizzled launch applies no betrayal side effects", () => {
    // player1 has no silo, so canBuild fails and the execution fizzles.
    game.addExecution(new MirvExecution(player1, game.ref(10, 10)));
    executeTicks(game, 2);

    expect(player1.units(UnitType.MIRV)).toHaveLength(0);
    expect(player1.isAlliedWith(player2)).toBe(true);
    expect(player1.isTraitor()).toBe(false);
  });
});
