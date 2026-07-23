import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";
import { verifyJoin } from "../../src/server/JoinVerify";

// verifyJoin resolves its endpoint from ServerEnv.jwtIssuer(), which throws
// if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

describe("verifyJoin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the display-ready pair on approval and posts the identity", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        username: "SnugglePuppy",
        clanTag: "COOL",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await verifyJoin("1.2.3.4", "tok", "xXblackxX", "CoOl");

    expect(verdict).toEqual({
      status: "approved",
      username: "SnugglePuppy",
      clanTag: "COOL",
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      ip: "1.2.3.4",
      token: "tok",
      username: "xXblackxX",
      clanTag: "CoOl",
    });
  });

  it("normalizes an absent clanTag to null on approval", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ status: "approved", username: "Alice" }),
        ),
    );
    expect(await verifyJoin("ip", "tok", "Alice", null)).toEqual({
      status: "approved",
      username: "Alice",
      clanTag: null,
    });
  });

  it("passes a rejection through (censored identity in the body is ignored)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "rejected",
          reason: "token invalid",
          username: "SnugglePuppy",
          clanTag: null,
        }),
      ),
    );
    expect(await verifyJoin("ip", "tok", "xXblackxX", null)).toEqual({
      status: "rejected",
      reason: "token invalid",
    });
  });

  it("rejects a null token without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await verifyJoin("ip", null, "Alice", null);

    expect(verdict.status).toBe("rejected");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error on a 4xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "bad payload" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once after a 5xx (siteverify outage fails closed) and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500))
      .mockResolvedValue(
        jsonResponse({ status: "approved", username: "Alice", clanTag: null }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyJoin("ip", "tok", "Alice", null)).toEqual({
      status: "approved",
      username: "Alice",
      clanTag: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns error when both attempts fail (network error / timeout)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns error on a malformed body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ approved: true })),
    );
    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
  });
});

describe("GameServer.admittedIdentity", () => {
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
  });

  function makeGame() {
    return new GameServer("test-game", mockLogger, Date.now(), {
      gameType: GameType.Private,
    } as any);
  }

  it("returns the stored (screened) identity for an admitted player", () => {
    const game = makeGame();
    (game as any).allClients.set("c1", {
      clientID: "c1",
      persistentID: "p1",
      username: "SnugglePuppy",
      clanTag: null,
    });

    expect(game.admittedIdentity("p1")).toEqual({
      username: "SnugglePuppy",
      clanTag: null,
    });
  });

  it("returns null for an unknown player", () => {
    expect(makeGame().admittedIdentity("nobody")).toBeNull();
  });
});
