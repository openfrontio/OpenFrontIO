import { describe, expect, it } from "vitest";
import {
  ServerLobbyInfoMessageSchema,
  ServerStartGameMessageSchema,
  type ServerLobbyInfoMessage,
  type ServerStartGameMessage,
} from "../../src/core/Schemas";
import {
  decodeServerMessage,
  encodeServerMessage,
} from "../../src/core/ZbinWire";
import { testGameConfig } from "../util/Wire";

// OPE-423. The opaque per-game grouping token on the two server->client
// messages that carry it. The interesting property is not that zod accepts a
// string — it is that the field survives the binary wire in BOTH directions
// (present and absent), because zbin is positional and an optional field that
// only round-trips when set is an optional field that corrupts every frame
// where it is not.

const GAME = "abcd1234";
const CLIENT = "cl001234";
const TOKEN = "Zm9vYmFyYmF6cXV4";

function lobbyInfo(
  groupToken?: string,
): ServerLobbyInfoMessage & { type: "lobby_info" } {
  return {
    type: "lobby_info",
    lobby: { gameID: GAME, serverTime: 1_700_000_000_000 },
    myClientID: CLIENT,
    ...(groupToken === undefined ? {} : { groupToken }),
  };
}

function startGame(groupToken?: string): ServerStartGameMessage {
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

describe("groupToken on the lobby_info message", () => {
  it("accepts a token and round-trips it over the binary wire", () => {
    const parsed = ServerLobbyInfoMessageSchema.parse(lobbyInfo(TOKEN));
    expect(parsed.groupToken).toBe(TOKEN);

    const decoded = decodeServerMessage(
      encodeServerMessage(lobbyInfo(TOKEN), undefined),
      undefined,
    );
    expect(decoded.type).toBe("lobby_info");
    expect(decoded).toMatchObject({ groupToken: TOKEN });
  });

  it("accepts a message without one and omits the key entirely", () => {
    const parsed = ServerLobbyInfoMessageSchema.parse(lobbyInfo());
    expect("groupToken" in parsed).toBe(false);

    const decoded = decodeServerMessage(
      encodeServerMessage(lobbyInfo(), undefined),
      undefined,
    );
    // The rest of the message must still decode correctly with the field
    // absent: a mis-sized presence header shows up here first.
    expect(decoded).toMatchObject({ type: "lobby_info", myClientID: CLIENT });
    expect((decoded as { groupToken?: string }).groupToken).toBeUndefined();
  });
});

describe("groupToken on the start message", () => {
  it("accepts a token and round-trips it over the binary wire", () => {
    const parsed = ServerStartGameMessageSchema.parse(startGame(TOKEN));
    expect(parsed.groupToken).toBe(TOKEN);

    const decoded = decodeServerMessage(
      encodeServerMessage(startGame(TOKEN), undefined),
      undefined,
    );
    expect(decoded).toMatchObject({ type: "start", groupToken: TOKEN });
  });

  it("accepts a message without one and omits the key entirely", () => {
    const parsed = ServerStartGameMessageSchema.parse(startGame());
    expect("groupToken" in parsed).toBe(false);

    const decoded = decodeServerMessage(
      encodeServerMessage(startGame(), undefined),
      undefined,
    );
    expect(decoded).toMatchObject({ type: "start", myClientID: CLIENT });
    expect((decoded as { groupToken?: string }).groupToken).toBeUndefined();
  });
});

describe("groupToken bounds", () => {
  // Both ends are load-bearing. An empty string is indistinguishable from
  // "absent" to the shell but distinguishable to the schema, and an
  // unbounded string is an unbounded allocation on every client that decodes
  // a frame from a server it does not control.
  it("rejects an empty token", () => {
    expect(ServerLobbyInfoMessageSchema.safeParse(lobbyInfo("")).success).toBe(
      false,
    );
  });

  it("rejects a token longer than 64 characters", () => {
    expect(
      ServerLobbyInfoMessageSchema.safeParse(lobbyInfo("x".repeat(65))).success,
    ).toBe(false);
    expect(
      ServerLobbyInfoMessageSchema.safeParse(lobbyInfo("x".repeat(64))).success,
    ).toBe(true);
  });
});
