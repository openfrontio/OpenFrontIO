import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../src/core/execution/alliance/BreakAllianceExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

/**
 * Tests for the per-player alliance list maintained on PlayerImpl
 * (player.alliances()). It is updated incrementally as alliances form, break,
 * and expire instead of scanning the global mg.alliances_ list, so the key
 * invariant is that both participants' lists stay in sync with reality.
 */

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

/** Form a mutual alliance via counter-requests, then tick to apply. */
function ally(a: Player, b: Player): void {
  game.addExecution(new AllianceRequestExecution(a, b.id()));
  game.executeNextTick();
  game.addExecution(new AllianceRequestExecution(b, a.id()));
  game.executeNextTick();
}

/**
 * Break an alliance. Executions are inited on the tick they're added and only
 * run on the following tick, so tick twice.
 */
function breakAlliance(a: Player, b: Player): void {
  game.addExecution(new BreakAllianceExecution(a, b.id()));
  game.executeNextTick();
  game.executeNextTick();
}

describe("per-player alliance list", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      { infiniteGold: true, instantBuild: true, infiniteTroops: true },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
        playerInfo("player3", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player1.conquer(game.ref(0, 0));
    player2 = game.player("player2");
    player2.conquer(game.ref(0, 1));
    player3 = game.player("player3");
    player3.conquer(game.ref(0, 2));
  });

  test("forming an alliance adds it to both participants' lists", () => {
    expect(player1.alliances()).toHaveLength(0);
    expect(player2.alliances()).toHaveLength(0);

    ally(player1, player2);

    expect(player1.alliances()).toHaveLength(1);
    expect(player2.alliances()).toHaveLength(1);
    // Same underlying alliance object on both sides.
    expect(player1.alliances()[0]).toBe(player2.alliances()[0]);
    expect(player1.alliances()[0].other(player1)).toBe(player2);
    expect(player2.alliances()[0].other(player2)).toBe(player1);
  });

  test("alliances() agrees with isAlliedWith / allianceWith", () => {
    ally(player1, player2);

    expect(player1.isAlliedWith(player2)).toBe(true);
    expect(player1.allianceWith(player2)).toBe(player1.alliances()[0]);
    expect(player1.isAlliedWith(player3)).toBe(false);
    expect(player3.alliances()).toHaveLength(0);
  });

  test("breaking an alliance removes it from both lists", () => {
    ally(player1, player2);
    expect(player1.alliances()).toHaveLength(1);

    breakAlliance(player1, player2);

    expect(player1.alliances()).toHaveLength(0);
    expect(player2.alliances()).toHaveLength(0);
    expect(player1.isAlliedWith(player2)).toBe(false);
  });

  test("expiring an alliance removes it from both lists", () => {
    ally(player1, player2);
    expect(player1.alliances()).toHaveLength(1);

    player1.alliances()[0].expire();

    expect(player1.alliances()).toHaveLength(0);
    expect(player2.alliances()).toHaveLength(0);
    expect(player1.isAlliedWith(player2)).toBe(false);
  });

  test("a player tracks multiple alliances independently", () => {
    ally(player1, player2);
    ally(player1, player3);

    expect(player1.alliances()).toHaveLength(2);
    const others = player1.alliances().map((a) => a.other(player1));
    expect(others).toContain(player2);
    expect(others).toContain(player3);

    // Breaking one leaves the other intact.
    breakAlliance(player1, player2);

    expect(player1.alliances()).toHaveLength(1);
    expect(player1.alliances()[0].other(player1)).toBe(player3);
    expect(player2.alliances()).toHaveLength(0);
    expect(player3.alliances()).toHaveLength(1);
  });

  test("removeAllAlliances clears the player and every partner", () => {
    ally(player1, player2);
    ally(player1, player3);
    expect(player1.alliances()).toHaveLength(2);

    player1.removeAllAlliances();

    expect(player1.alliances()).toHaveLength(0);
    expect(player2.alliances()).toHaveLength(0);
    expect(player3.alliances()).toHaveLength(0);
  });
});
