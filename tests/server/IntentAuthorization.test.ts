import { describe, expect, it } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameConfig, Intent } from "../../src/core/Schemas";
import {
  authorizeIntent,
  IntentActor,
  IntentGameState,
} from "../../src/server/IntentAuthorization";
import { cid } from "../util/GameServerHarness";

// The guards on their own, as a table. What an authorized intent then does —
// kicking, config patching, the start timer, pausing, queueing — is covered
// through GameServer in AdminBotIntent, HostedLobbyListing and the golden
// transcript.

const actor = (over: Partial<IntentActor> = {}): IntentActor => ({
  clientID: cid("p1"),
  isLobbyCreator: false,
  isAdmin: false,
  isAdminBot: false,
  ...over,
});
const player = actor();
const host = actor({ isLobbyCreator: true });
const admin = actor({ isAdmin: true });
const bot = actor({ isAdmin: true, isAdminBot: true });

const lobby = (over: Partial<IntentGameState> = {}): IntentGameState => ({
  isPublic: false,
  isListed: false,
  hasStarted: false,
  ...over,
});

const kick: Intent = { type: "kick_player", targetClientID: cid("p2") };
const config = (c: Partial<GameConfig>): Intent => ({
  type: "update_game_config",
  config: c,
});
const timer: Intent = { type: "toggle_game_start_timer" };
const pause: Intent = { type: "toggle_pause", paused: true };
const spawn: Intent = { type: "spawn", tile: 1 };

describe("authorizeIntent", () => {
  it.each<[string, Intent, IntentActor, IntentGameState, number | null]>([
    // The admin bot is refused any intent on a public game, before anything
    // else is considered.
    ["bot on a public game", spawn, bot, lobby({ isPublic: true }), 403],
    ["bot kick on a public game", kick, bot, lobby({ isPublic: true }), 403],

    [
      "mark_disconnected from anyone",
      { type: "mark_disconnected", isDisconnected: true },
      host,
      lobby(),
      400,
    ],

    ["kick by a player", kick, player, lobby(), 403],
    ["kick by the host", kick, host, lobby(), null],
    [
      "kick by the host of a listed lobby",
      kick,
      host,
      lobby({ isListed: true }),
      403,
    ],
    [
      "kick by an admin in a listed lobby",
      kick,
      admin,
      lobby({ isListed: true }),
      null,
    ],
    [
      "kick by the bot in a listed lobby",
      kick,
      bot,
      lobby({ isListed: true }),
      null,
    ],
    [
      "kick by the host of a listed game that started",
      kick,
      host,
      lobby({ isListed: true, hasStarted: true }),
      403,
    ],

    ["config by a player", config({ bots: 1 }), player, lobby(), 403],
    [
      "config by an admin who is not the host",
      config({ bots: 1 }),
      admin,
      lobby(),
      403,
    ],
    ["config by the host", config({ bots: 1 }), host, lobby(), null],
    ["config by the bot", config({ bots: 1 }), bot, lobby(), null],
    [
      "config on a public game",
      config({ bots: 1 }),
      host,
      lobby({ isPublic: true }),
      403,
    ],
    [
      "config after the start",
      config({ bots: 1 }),
      host,
      lobby({ hasStarted: true }),
      409,
    ],
    [
      "config promoting the game to public",
      config({ gameType: GameType.Public }),
      host,
      lobby(),
      400,
    ],
    [
      "config enabling host cheats in a listed lobby",
      config({ hostCheats: { infiniteGold: true } }),
      host,
      lobby({ isListed: true }),
      409,
    ],
    [
      "config without cheats in a listed lobby",
      config({ bots: 1 }),
      host,
      lobby({ isListed: true }),
      null,
    ],

    ["start timer by a player", timer, player, lobby(), 403],
    ["start timer by the host", timer, host, lobby(), null],
    ["start timer by the bot", timer, bot, lobby(), null],
    [
      "start timer on a public game",
      timer,
      host,
      lobby({ isPublic: true }),
      403,
    ],
    [
      "start timer after the start",
      timer,
      host,
      lobby({ hasStarted: true }),
      409,
    ],

    ["pause by a player", pause, player, lobby({ hasStarted: true }), 403],
    ["pause by the host", pause, host, lobby({ hasStarted: true }), null],
    [
      "pause by the host of a listed game",
      pause,
      host,
      lobby({ isListed: true, hasStarted: true }),
      403,
    ],
    [
      "pause by the bot in a listed game",
      pause,
      bot,
      lobby({ isListed: true, hasStarted: true }),
      null,
    ],
    ["pause before the start", pause, host, lobby(), 409],

    ["gameplay by a player", spawn, player, lobby(), null],
    [
      "gameplay by a player in a public game",
      spawn,
      player,
      lobby({ isPublic: true }),
      null,
    ],
    ["gameplay by an admin", spawn, admin, lobby(), null],
    ["gameplay by the bot", spawn, bot, lobby(), 400],
  ])("%s", (_name, intent, who, game, status) => {
    const outcome = authorizeIntent(intent, who, game);
    if (status === null) {
      expect(outcome).toBeNull();
    } else {
      expect(outcome).toMatchObject({ status, error: expect.any(String) });
    }
  });

  it("names the reason", () => {
    expect(authorizeIntent(kick, host, lobby({ isListed: true }))).toEqual({
      status: 403,
      error: "the host cannot kick players in a publicly listed lobby",
    });
  });
});
