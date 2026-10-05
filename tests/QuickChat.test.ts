import en from "../resources/lang/en.json";
import quickChatData from "../resources/QuickChat.json";
import { QuickChatExecution } from "../src/core/execution/QuickChatExecution";
import { Game, Player, PlayerType } from "../src/core/game/Game";
import { GameUpdateType } from "../src/core/game/GameUpdates";
import { QuickChatKeySchema } from "../src/core/Schemas";
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

describe("QuickChat phrases", () => {
  const chatText = en.chat as unknown as Record<
    string,
    Record<string, string> | string
  >;

  function englishText(category: string, key: string): string | undefined {
    const group = chatText[category];
    return typeof group === "object" ? group[key] : undefined;
  }

  const newPhrases: Array<[string, string, string]> = [
    ["attack", "betray", "Betray [P1]!"],
    ["attack", "build_sams", "Build SAMs!"],
    ["defend", "make_ally", "Ally with [P1]!"],
    ["help", "send_troops_to", "Send troops to [P1]!"],
    ["help", "send_gold_to", "Send gold to [P1]!"],
    ["warnings", "disconnected", "[P1] has disconnected!"],
    ["warnings", "pirating", "[P1] is pirating all of our trade!"],
    ["misc", "join_discord", "You should join the OpenFront Discord server!"],
  ];

  test.each(newPhrases)(
    "%s.%s is a valid quick chat key with English text",
    (category, key, text) => {
      expect(QuickChatKeySchema.safeParse(`${category}.${key}`).success).toBe(
        true,
      );
      expect(englishText(category, key)).toBe(text);
    },
  );

  test("every phrase in QuickChat.json has English text", () => {
    const missing: string[] = [];
    for (const [category, entries] of Object.entries(quickChatData)) {
      for (const entry of entries) {
        const text = englishText(category, entry.key);
        if (!text) missing.push(`${category}.${entry.key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("a phrase needs a target exactly when its text contains [P1]", () => {
    const mismatched: string[] = [];
    for (const [category, entries] of Object.entries(quickChatData)) {
      for (const entry of entries) {
        const text = englishText(category, entry.key) ?? "";
        if (entry.requiresPlayer !== text.includes("[P1]")) {
          mismatched.push(`${category}.${entry.key}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  test("a new targeted phrase is delivered with its target", async () => {
    const g = await setup("plains", {}, [
      playerInfo("sender", PlayerType.Human),
      playerInfo("recipient", PlayerType.Human),
      playerInfo("target", PlayerType.Human),
    ]);
    const sender = g.player("sender");
    const recipient = g.player("recipient");
    const target = g.player("target");
    sender.conquer(g.ref(0, 0));
    recipient.conquer(g.ref(0, 1));
    target.conquer(g.ref(0, 2));
    while (g.inSpawnPhase()) {
      g.executeNextTick();
    }

    g.addExecution(
      new QuickChatExecution(
        sender,
        recipient.id(),
        "warnings.disconnected",
        target.id(),
      ),
    );
    g.executeNextTick(); // init
    const updates = g.executeNextTick(); // tick

    const chats = updates[GameUpdateType.DisplayChatEvent] ?? [];
    expect(chats).toHaveLength(2);
    for (const chat of chats) {
      expect(chat.category).toBe("warnings");
      expect(chat.key).toBe("disconnected");
      expect(chat.target).toBe(target.id());
    }
    expect(sender.canSendQuickChat(recipient)).toBe(false);
  });
});
