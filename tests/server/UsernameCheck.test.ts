import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";
import { fetchCensoredPlayers } from "../../src/server/UsernameChecker";

// fetchCensoredPlayers resolves its endpoint from ServerEnv.jwtIssuer(),
// which throws if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

describe("fetchCensoredPlayers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the display-ready pairs and posts the roster", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        players: [
          { username: "Alice", clanTag: "COOL" },
          { username: "SnugglePuppy", clanTag: null },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCensoredPlayers([
      { username: "Alice", clanTag: "CoOl" },
      { username: "xXblackxX", clanTag: null },
    ]);

    expect(result).toEqual([
      { username: "Alice", clanTag: "COOL" },
      { username: "SnugglePuppy", clanTag: null },
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      players: [
        { username: "Alice", clanTag: "CoOl" },
        { username: "xXblackxX", clanTag: null },
      ],
    });
  });

  it("normalizes an absent clanTag to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          players: [{ username: "BlackHawk" }],
        }),
      ),
    );
    expect(
      await fetchCensoredPlayers([{ username: "BlackHawk", clanTag: null }]),
    ).toEqual([{ username: "BlackHawk", clanTag: null }]);
  });

  it("returns null when the response length does not match the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ players: [] })),
    );
    expect(
      await fetchCensoredPlayers([{ username: "Alice", clanTag: null }]),
    ).toBeNull();
  });

  it("returns null on a malformed body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ bannedIndices: [0] })),
    );
    expect(
      await fetchCensoredPlayers([{ username: "Alice", clanTag: null }]),
    ).toBeNull();
  });

  it("returns null on a 4xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "bad payload" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchCensoredPlayers([{ username: "Alice", clanTag: null }]),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 5xx and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500))
      .mockResolvedValue(
        jsonResponse({ players: [{ username: "Alice", clanTag: null }] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchCensoredPlayers([{ username: "Alice", clanTag: null }]),
    ).toEqual([{ username: "Alice", clanTag: null }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null when both attempts fail (network error / timeout)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await fetchCensoredPlayers([{ username: "Alice", clanTag: null }]),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("GameServer roster censoring at start", () => {
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

  function makeGame(
    players: { clientID: string; username: string; clanTag: string | null }[],
  ) {
    const game = new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
    for (const p of players) {
      game.activeClients.push(p as any);
    }
    return game;
  }

  const censorAndStart = (game: GameServer) =>
    (game as any).censorRosterAndStart();

  it("applies the display-ready pairs to the roster", async () => {
    const game = makeGame([
      { clientID: "c1", username: "xXblackxX", clanTag: "BAD" },
      { clientID: "c2", username: "Alice", clanTag: "cool" },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          players: [
            { username: "SnugglePuppy", clanTag: null },
            { username: "Alice", clanTag: "COOL" },
          ],
        }),
      ),
    );

    await censorAndStart(game);

    expect(game.activeClients[0].username).toBe("SnugglePuppy");
    expect(game.activeClients[0].clanTag).toBeNull();
    expect(game.activeClients[1].username).toBe("Alice");
    expect(game.activeClients[1].clanTag).toBe("COOL");
  });

  it("starts with names as-is when the check fails", async () => {
    const game = makeGame([
      { clientID: "c1", username: "xXblackxX", clanTag: "BAD" },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    await censorAndStart(game);

    expect(game.activeClients[0].username).toBe("xXblackxX");
    expect(game.activeClients[0].clanTag).toBe("BAD");
    expect(mockLogger.error).toHaveBeenCalledWith(
      "username check failed, starting with names as-is",
    );
  });

  it("skips the request entirely with an empty roster", async () => {
    const game = makeGame([]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await censorAndStart(game);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
