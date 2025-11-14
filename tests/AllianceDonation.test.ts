import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { AllianceRequestReplyExecution } from "../src/core/execution/alliance/AllianceRequestReplyExecution";
import { DonateGoldExecution } from "../src/core/execution/DonateGoldExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;

describe("Alliance Donation", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: false,
        instantBuild: true,
        infiniteTroops: false,
        donateGold: true,
        donateTroops: true,
      },
      [
        playerInfo("player1", PlayerType.Human),
        playerInfo("player2", PlayerType.Human),
      ],
    );

    player1 = game.player("player1");
    player1.conquer(game.ref(0, 0));
    player1.addGold(1000n);
    player1.addTroops(1000);

    player2 = game.player("player2");
    player2.conquer(game.ref(0, 1));
    player2.addGold(100n);
    player2.addTroops(100);

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  test("Can donate gold after alliance formed by reply", () => {
    // Player 1 sends request, player 2 accepts
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
    expect(player1.isFriendly(player2)).toBeTruthy();
    expect(player2.isFriendly(player1)).toBeTruthy();

    // Try to donate gold
    expect(player1.canDonateGold(player2)).toBeTruthy();
    const goldBefore = player2.gold();
    const success = player1.donateGold(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.gold()).toBe(goldBefore + 100n);
  });

  test("Can donate troops after alliance formed by reply", () => {
    // Player 1 sends request, player 2 accepts
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    // Try to donate troops
    expect(player1.canDonateTroops(player2)).toBeTruthy();
    const troopsBefore = player2.troops();
    const success = player1.donateTroops(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.troops()).toBe(troopsBefore + 100);
  });

  test("Can donate gold after alliance formed by mutual request", () => {
    // Player 1 sends request to player 2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    // Player 2 sends request back to player 1 (auto-accepts)
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
    expect(player1.isFriendly(player2)).toBeTruthy();
    expect(player2.isFriendly(player1)).toBeTruthy();

    // Try to donate gold
    expect(player1.canDonateGold(player2)).toBeTruthy();
    const goldBefore = player2.gold();
    const success = player1.donateGold(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.gold()).toBe(goldBefore + 100n);
  });

  test("Can donate troops after alliance formed by mutual request", () => {
    // Player 1 sends request to player 2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    // Player 2 sends request back to player 1 (auto-accepts)
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    // Try to donate troops
    expect(player1.canDonateTroops(player2)).toBeTruthy();
    const troopsBefore = player2.troops();
    const success = player1.donateTroops(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.troops()).toBe(troopsBefore + 100);
  });

  test("Can donate immediately after accepting alliance (race condition)", () => {
    // This test verifies the bug fix for issue where donations failed
    // when attempted in the same tick as alliance acceptance

    // Player 1 sends request to player 2
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    // Player 2 accepts AND player 1 tries to donate in the same turn
    // This simulates the race condition that occurred in real gameplay
    const goldBefore = player2.gold();
    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.addExecution(new DonateGoldExecution(player1, player2.id(), 100));

    // Execute once to init both executions (alliance is created in init)
    game.executeNextTick();

    // Alliance should be created now (before donation ticks)
    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    // Execute again for donation to tick
    game.executeNextTick();

    // Donation should have succeeded
    expect(player2.gold()).toBe(goldBefore + 100n);
  });
});
