import { describe, expect, it } from "vitest";
import type { PresencePayload } from "../../src/client/DesktopPresence";
import { groupTokenOf, withGroupToken } from "../../src/client/PresenceGroup";
import type { ServerMessage } from "../../src/core/Schemas";
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
