import { QuickChatExecution } from "../src/core/execution/QuickChatExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { playerInfo, setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

describe("QuickChat cooldown", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      playerInfo("player1", PlayerType.Human),
      playerInfo("player2", PlayerType.Human),
      playerInfo("player3", PlayerType.Human),
    ]);

    player1 = game.player("player1");
    player1.conquer(game.ref(0, 0));

    player2 = game.player("player2");
    player2.conquer(game.ref(0, 1));

    player3 = game.player("player3");
    player3.conquer(game.ref(0, 2));

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }
  });

  // Helper: add an execution and advance two ticks so tick() actually runs.
  // (addExecution → unInitExecs; first tick: init(); second tick: tick())
  function sendQuickChat(sender: Player, recipient: Player) {
    game.addExecution(
      new QuickChatExecution(sender, recipient.id(), "greet.hello", undefined),
    );
    game.executeNextTick(); // init
    game.executeNextTick(); // tick
  }

  test("first quick chat is sent", () => {
    expect(player1.canSendQuickChat(player2)).toBe(true);
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);
  });

  test("second quick chat within cooldown is blocked", () => {
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);

    // Even after the second attempt, cooldown persists
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);
  });

  test("quick chat is allowed again after cooldown expires", () => {
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);

    // Advance past the cooldown (3 * 10 = 30 ticks)
    const cooldown = game.config().quickChatCooldown();
    for (let i = 0; i < cooldown; i++) {
      game.executeNextTick();
    }

    expect(player1.canSendQuickChat(player2)).toBe(true);
  });

  test("cooldown is per-sender — different sender is not affected", () => {
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);

    // player2 sending to player1 is independent
    expect(player2.canSendQuickChat(player1)).toBe(true);
  });

  test("cooldown is per-recipient — same sender can still chat with a different recipient", () => {
    sendQuickChat(player1, player2);
    expect(player1.canSendQuickChat(player2)).toBe(false);

    // player1 is on cooldown for player2 but not for player3
    expect(player1.canSendQuickChat(player3)).toBe(true);
  });
});
