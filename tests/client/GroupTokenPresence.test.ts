import { describe, expect, it, vi } from "vitest";
import type { PresencePayload } from "../../src/client/DesktopPresence";
import {
  GroupTokenTracker,
  groupTokenOf,
  loggableStartMessage,
  withGroupToken,
} from "../../src/client/PresenceGroup";
import { EventBus } from "../../src/core/EventBus";
import {
  GroupTokenEvent,
  type ServerMessage,
  type ServerStartGameMessage,
} from "../../src/core/Schemas";
import { testGameConfig } from "../util/Wire";

// OPE-423, client half. Two rules, both of which Main and ClientGameRunner
// depend on and neither of which can be reached through them in a test.

const TOKEN = "Zm9vYmFyYmF6cXV4";
const GAME = "abcd1234";
const CLIENT = "cl001234";

function lobbyInfo(groupToken?: string): ServerMessage {
  return {
    type: "lobby_info",
    lobby: { gameID: GAME, serverTime: 1_700_000_000_000 },
    myClientID: CLIENT,
    ...(groupToken === undefined ? {} : { groupToken }),
  };
}

// Shaped like what LocalServer synthesizes for a singleplayer game or a
// replay: a real start message with no server behind it, and so no token.
function startGame(groupToken?: string): ServerMessage {
  return {
    type: "start",
    turns: [],
    gameStartInfo: {
      gameID: GAME,
      lobbyCreatedAt: 1_700_000_000_000,
      config: testGameConfig(),
      players: [],
    },
    lobbyCreatedAt: 1_700_000_000_000,
    myClientID: CLIENT,
    ...(groupToken === undefined ? {} : { groupToken }),
  };
}

describe("groupTokenOf", () => {
  it("reads the token off a lobby_info", () => {
    expect(groupTokenOf(lobbyInfo(TOKEN))).toBe(TOKEN);
  });

  // Both carriers, because a late joiner only ever sees the second one.
  it("reads the token off a start message", () => {
    expect(groupTokenOf(startGame(TOKEN))).toBe(TOKEN);
  });

  it("returns undefined for a singleplayer start message, which has none", () => {
    expect(groupTokenOf(startGame())).toBeUndefined();
  });

  it("returns undefined for a lobby_info without one", () => {
    expect(groupTokenOf(lobbyInfo())).toBeUndefined();
  });

  it("returns undefined for messages that never carry a token", () => {
    expect(groupTokenOf({ type: "ping" })).toBeUndefined();
    expect(groupTokenOf({ type: "new_lobby", gameID: GAME })).toBeUndefined();
  });
});

describe("withGroupToken", () => {
  const lobby: PresencePayload = {
    state: "lobby",
    gameType: "Private",
    lobbyId: GAME,
    playerCount: 3,
  };
  const game: PresencePayload = { ...lobby, state: "game" };
  const spectating: PresencePayload = { ...lobby, state: "spectating" };

  it("forwards the token in the lobby payload", () => {
    expect(withGroupToken(lobby, TOKEN)).toEqual({
      ...lobby,
      groupToken: TOKEN,
    });
  });

  it("forwards the token in the game payload", () => {
    expect(withGroupToken(game, TOKEN)).toEqual({ ...game, groupToken: TOKEN });
  });

  // A spectator is in the same Steam group as the players; it is the shell,
  // not the client, that decides what that does to the group's size.
  it("forwards the token while spectating", () => {
    expect(withGroupToken(spectating, TOKEN).groupToken).toBe(TOKEN);
  });

  it("changes nothing else about the payload", () => {
    const rest: Record<string, unknown> = { ...withGroupToken(lobby, TOKEN) };
    delete rest.groupToken;
    expect(rest).toEqual(lobby);
  });

  // Omitting the key, not setting it to undefined: the shell diffs payloads.
  it("omits the key entirely when there is no token (singleplayer)", () => {
    const payload = withGroupToken(game, undefined);
    expect("groupToken" in payload).toBe(false);
    expect(payload).toEqual(game);
  });

  it("returns the payload untouched when there is no token", () => {
    expect(withGroupToken(game, undefined)).toBe(game);
  });
});

describe("loggableStartMessage", () => {
  const withToken = startGame(TOKEN) as ServerStartGameMessage;

  // The console dump of the start message is what players paste into bug
  // reports. Everything in it is already theirs to see except this.
  it("drops the group token", () => {
    const logged = loggableStartMessage(withToken);
    expect("groupToken" in logged).toBe(false);
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
  });

  it("keeps every other field, so the dump stays useful", () => {
    const logged = loggableStartMessage(withToken);
    expect(logged).toEqual({
      type: "start",
      turns: [],
      gameStartInfo: withToken.gameStartInfo,
      lobbyCreatedAt: withToken.lobbyCreatedAt,
      myClientID: CLIENT,
    });
  });

  it("does not mutate the message the caller is still using", () => {
    loggableStartMessage(withToken);
    expect(withToken.groupToken).toBe(TOKEN);
  });

  it("is a no-op for a singleplayer start message, which has no token", () => {
    const local = startGame() as ServerStartGameMessage;
    expect(loggableStartMessage(local)).toEqual(local);
  });
});

describe("GroupTokenTracker", () => {
  it("accepts the first token", () => {
    expect(new GroupTokenTracker().accept(TOKEN)).toBe(true);
  });

  it("rejects a repeat of the token it already holds", () => {
    const tracker = new GroupTokenTracker();
    tracker.accept(TOKEN);
    expect(tracker.accept(TOKEN)).toBe(false);
    expect(tracker.current()).toBe(TOKEN);
  });

  it("accepts a different token", () => {
    const tracker = new GroupTokenTracker();
    tracker.accept(TOKEN);
    expect(tracker.accept("T3RmaXJzdGdhbWU0")).toBe(true);
    expect(tracker.current()).toBe("T3RmaXJzdGdhbWU0");
  });

  it("holds nothing until a token arrives, and nothing after a clear", () => {
    const tracker = new GroupTokenTracker();
    expect(tracker.current()).toBeUndefined();
    tracker.accept(TOKEN);
    tracker.clear();
    expect(tracker.current()).toBeUndefined();
  });

  // Rejoining the same game after a trip through the menu must re-publish
  // the group, so a cleared tracker cannot treat the old token as a repeat.
  it("accepts the same token again after a clear", () => {
    const tracker = new GroupTokenTracker();
    tracker.accept(TOKEN);
    tracker.clear();
    expect(tracker.accept(TOKEN)).toBe(true);
  });

  // Mirrors Main's subscription exactly: lobby_info carries the token once a
  // second for the whole lobby phase, and each redundant emit is an IPC to
  // the shell carrying the roster from BEFORE this frame's LobbyInfoEvent.
  it("emits presence once across a second of identical lobby_info tokens", () => {
    const eventBus = new EventBus();
    const tracker = new GroupTokenTracker();
    const emitPresence = vi.fn();
    eventBus.on(GroupTokenEvent, (event) => {
      if (tracker.accept(event.groupToken)) emitPresence();
    });

    for (let i = 0; i < 5; i++) {
      eventBus.emit(new GroupTokenEvent(TOKEN));
    }

    expect(emitPresence).toHaveBeenCalledOnce();

    // A real change still gets through.
    eventBus.emit(new GroupTokenEvent("T3RmaXJzdGdhbWU0"));
    expect(emitPresence).toHaveBeenCalledTimes(2);
  });
});
