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

    expect(player1.canDonateGold(player2)).toBeTruthy();
    const goldBefore = player2.gold();
    const success = player1.donateGold(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.gold()).toBe(goldBefore + 100n);
  });

  test("Can donate troops after alliance formed by reply", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    expect(player1.canDonateTroops(player2)).toBeTruthy();
    const troopsBefore = player2.troops();
    const success = player1.donateTroops(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.troops()).toBe(troopsBefore + 100);
  });

  test("Can donate gold after alliance formed by mutual request", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();
    expect(player1.isFriendly(player2)).toBeTruthy();
    expect(player2.isFriendly(player1)).toBeTruthy();

    expect(player1.canDonateGold(player2)).toBeTruthy();
    const goldBefore = player2.gold();
    const success = player1.donateGold(player2, 100n);
    expect(success).toBeTruthy();
    expect(player2.gold()).toBe(goldBefore + 100n);
  });

  test("Can donate troops after alliance formed by mutual request", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    expect(player1.canDonateTroops(player2)).toBeTruthy();
    const troopsBefore = player2.troops();
    const success = player1.donateTroops(player2, 100);
    expect(success).toBeTruthy();
    expect(player2.troops()).toBe(troopsBefore + 100);
  });

  test("Can donate immediately after accepting alliance (race condition)", () => {
    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();

    const goldBefore = player2.gold();
    game.addExecution(
      new AllianceRequestReplyExecution(player1.id(), player2, true),
    );
    game.addExecution(new DonateGoldExecution(player1, player2.id(), 100));

    game.executeNextTick();

    expect(player1.isAlliedWith(player2)).toBeTruthy();
    expect(player2.isAlliedWith(player1)).toBeTruthy();

    game.executeNextTick();

    // Donation should have succeeded
    expect(player2.gold()).toBe(goldBefore + 100n);
  });
});
