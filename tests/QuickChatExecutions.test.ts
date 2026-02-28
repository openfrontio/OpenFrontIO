import { GameUpdateType } from "src/core/game/GameUpdates";
import { QuickChatExecution } from "../src/core/execution/QuickChatExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let player1: Player;
let player2: Player;
let player3: Player;

describe("QuickChatExecution", () => {
  beforeEach(async () => {
    game = await setup(
      "plains",
      {
        infiniteGold: true,
        instantBuild: true,
      },
      [
        new PlayerInfo("player1", PlayerType.Human, "c1", "p1"),
        new PlayerInfo("player2", PlayerType.Human, "c2", "p2"),
        new PlayerInfo("player3", PlayerType.Human, "c3", "p3"),
      ],
    );

    while (game.inSpawnPhase()) {
      game.executeNextTick();
    }

    player1 = game.player("p1");
    player2 = game.player("p2");
    player3 = game.player("p3");

    player1.conquer(game.ref(0, 0));
    player2.conquer(game.ref(5, 5));
    player3.conquer(game.ref(10, 10));
  });

  test("two-target quick chat produces DisplayChatEvent updates with correct target and target2", () => {
    const exec = new QuickChatExecution(
      player1,
      player2.id(),
      "warnings.teaming_with",
      player2.id(),
      player3.id(),
    );

    game.addExecution(exec);
    game.executeNextTick(); // init
    const updates = game.executeNextTick(); // tick

    const chatEvents = updates[GameUpdateType.DisplayChatEvent];
    expect(chatEvents.length).toBe(2);

    // Recipient's update (isFrom = true)
    const recipientUpdate = chatEvents.find((e) => e.isFrom === true);
    expect(recipientUpdate).toBeDefined();
    expect(recipientUpdate!.key).toBe("teaming_with");
    expect(recipientUpdate!.category).toBe("warnings");
    expect(recipientUpdate!.target).toBe(player2.id());
    expect(recipientUpdate!.target2).toBe(player3.id());
    expect(recipientUpdate!.playerID).toBe(player2.smallID());
    expect(recipientUpdate!.recipient).toBe(player1.id());

    // Sender's update (isFrom = false)
    const senderUpdate = chatEvents.find((e) => e.isFrom === false);
    expect(senderUpdate).toBeDefined();
    expect(senderUpdate!.key).toBe("teaming_with");
    expect(senderUpdate!.category).toBe("warnings");
    expect(senderUpdate!.target).toBe(player2.id());
    expect(senderUpdate!.target2).toBe(player3.id());
    expect(senderUpdate!.playerID).toBe(player1.smallID());
    expect(senderUpdate!.recipient).toBe(player2.id());
  });

  test("single-target quick chat has target2 undefined in updates", () => {
    const exec = new QuickChatExecution(
      player1,
      player2.id(),
      "chat.greetings.hello",
      player3.id(),
      undefined,
    );

    game.addExecution(exec);
    game.executeNextTick(); // init
    const updates = game.executeNextTick(); // tick

    const chatEvents = updates[GameUpdateType.DisplayChatEvent];
    expect(chatEvents.length).toBe(2);

    for (const event of chatEvents) {
      expect(event.target).toBe(player3.id());
      expect(event.target2).toBeUndefined();
    }
  });

  test("no-target quick chat has both target and target2 undefined", () => {
    const exec = new QuickChatExecution(
      player1,
      player2.id(),
      "chat.greetings.hello",
      undefined,
      undefined,
    );

    game.addExecution(exec);
    game.executeNextTick(); // init
    const updates = game.executeNextTick(); // tick

    const chatEvents = updates[GameUpdateType.DisplayChatEvent];
    expect(chatEvents.length).toBe(2);

    for (const event of chatEvents) {
      expect(event.target).toBeUndefined();
      expect(event.target2).toBeUndefined();
    }
  });

  test("invalid recipient deactivates execution and produces no chat updates", () => {
    const exec = new QuickChatExecution(
      player1,
      "nonexistent_player_id",
      "warnings.teaming_with",
      player2.id(),
      player3.id(),
    );

    game.addExecution(exec);

    const initUpdates = game.executeNextTick();
    expect(initUpdates[GameUpdateType.DisplayChatEvent].length).toBe(0);

    const tickUpdates = game.executeNextTick();
    expect(tickUpdates[GameUpdateType.DisplayChatEvent].length).toBe(0);

    expect(exec.isActive()).toBe(false);
  });

  test("execution lifecycle: isActive, owner, and activeDuringSpawnPhase", () => {
    const exec = new QuickChatExecution(
      player1,
      player2.id(),
      "chat.greetings.hello",
      undefined,
      undefined,
    );

    expect(exec.isActive()).toBe(true);
    expect(exec.owner()).toBe(player1);
    expect(exec.activeDuringSpawnPhase()).toBe(false);

    game.addExecution(exec);
    game.executeNextTick(); // init
    expect(exec.isActive()).toBe(true);

    game.executeNextTick(); // tick
    expect(exec.isActive()).toBe(false);
  });

  test("two-segment key parsed as category and key", () => {
    const exec = new QuickChatExecution(
      player1,
      player2.id(),
      "alerts.danger",
      undefined,
      undefined,
    );

    game.addExecution(exec);
    game.executeNextTick(); // init
    const updates = game.executeNextTick(); // tick

    const chatEvents = updates[GameUpdateType.DisplayChatEvent];
    expect(chatEvents.length).toBe(2);

    for (const event of chatEvents) {
      expect(event.category).toBe("alerts");
      expect(event.key).toBe("danger");
    }
  });
});
