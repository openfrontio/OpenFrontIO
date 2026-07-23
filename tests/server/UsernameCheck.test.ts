import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";
import { shadowNames } from "../../src/server/Privilege";
import { fetchBannedUsernames } from "../../src/server/UsernameChecker";

// fetchBannedUsernames resolves its endpoint from ServerEnv.jwtIssuer(),
// which throws if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

describe("fetchBannedUsernames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps bannedIndices back to usernames", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ bannedIndices: [0, 2] }));
    vi.stubGlobal("fetch", fetchMock);

    const banned = await fetchBannedUsernames(["Alice", "Bob", "BadName"]);
    expect(banned).toEqual(new Set(["Alice", "BadName"]));

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      usernames: ["Alice", "Bob", "BadName"],
    });
  });

  it("returns an empty set when everything passes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ bannedIndices: [] })),
    );
    expect(await fetchBannedUsernames(["Alice"])).toEqual(new Set());
  });

  it("returns null on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, false)),
    );
    expect(await fetchBannedUsernames(["Alice"])).toBeNull();
  });

  it("returns null on a malformed body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ banned: ["Alice"] })),
    );
    expect(await fetchBannedUsernames(["Alice"])).toBeNull();
  });

  it("returns null when fetch rejects (network error / timeout)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(await fetchBannedUsernames(["Alice"])).toBeNull();
  });

  it("ignores out-of-range indices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ bannedIndices: [0, 99] })),
    );
    expect(await fetchBannedUsernames(["Alice"])).toEqual(new Set(["Alice"]));
  });
});

describe("GameServer username moderation", () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeGame(usernames: Record<string, string>) {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    for (const [clientID, username] of Object.entries(usernames)) {
      (game as any).allClients.set(clientID, { clientID, username });
    }
    return game;
  }

  const check = (game: GameServer) => (game as any).checkUsernames();
  const intents = (game: GameServer) => (game as any).intents;

  const stubVerdict = (bannedIndices: number[]) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ bannedIndices }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("injects a censor_player intent with a shadow name on a ban", async () => {
    const game = makeGame({ c1: "BadName", c2: "Alice" });
    stubVerdict([0]);

    await check(game);

    expect(intents(game)).toHaveLength(1);
    const intent = intents(game)[0];
    expect(intent.type).toBe("censor_player");
    expect(intent.clientID).toBe("c1");
    expect(shadowNames).toContain(intent.username);
  });

  it("censors every client sharing a banned name", async () => {
    const game = makeGame({ c1: "BadName", c2: "BadName" });
    stubVerdict([0]);

    await check(game);

    expect(intents(game)).toHaveLength(2);
    expect(
      intents(game)
        .map((i: any) => i.clientID)
        .sort(),
    ).toEqual(["c1", "c2"]);
  });

  it("logs an error and censors nothing when the API check fails", async () => {
    const game = makeGame({ c1: "BadName" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await check(game);

    expect(intents(game)).toHaveLength(0);
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it("skips the check entirely with no clients", async () => {
    const game = makeGame({});
    const fetchMock = stubVerdict([]);

    await check(game);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects censor_player intents submitted by clients", () => {
    const game = makeGame({ c1: "Alice" });
    const result = game.handleIntent(
      { type: "censor_player", clientID: "c2", username: "Evil" } as any,
      {
        clientID: "c1",
        isLobbyCreator: false,
        isAdmin: false,
        isAdminBot: false,
      },
    );
    expect(result.status).toBe(400);
    expect(intents(game)).toHaveLength(0);
  });
});
