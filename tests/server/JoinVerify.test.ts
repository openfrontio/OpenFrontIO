import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSteamAuthenticated,
  planJoinVerify,
  verifyJoin,
} from "../../src/server/JoinVerify";
import type { TokenPayload } from "../../src/core/ApiSchemas";

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

  it("passes a rejection through (extra identity fields are stripped)", async () => {
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

  it("sends a null token for reconnects (API skips siteverify, runs the name check alone)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        username: "SnugglePuppy",
        clanTag: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const verdict = await verifyJoin("ip", null, "xXblackxX", null);

    expect(verdict).toEqual({
      status: "approved",
      username: "SnugglePuppy",
      clanTag: null,
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).token).toBeNull();
  });

  it("returns error on a 4xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "bad payload" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Turnstile tokens are single-use: a retry could re-submit a token the
  // first attempt already redeemed, turning an API hiccup into a hard
  // rejection. Every failure mode must be a single attempt that fails open.
  it("returns error on a 5xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error on a network error / timeout without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error on a malformed body without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ approved: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await verifyJoin("ip", "tok", "Alice", null)).status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("planJoinVerify", () => {
  const firstJoin = {
    isReadmit: false,
    gameStarted: false,
    turnstileToken: "tok" as string | null,
    identityUnchanged: false,
    steamAuthed: false,
  };
  const readmit = { ...firstJoin, isReadmit: true, turnstileToken: null };

  it("verifies a first join with its token", () => {
    expect(planJoinVerify(firstJoin)).toEqual({
      action: "verify",
      token: "tok",
    });
  });

  it("rejects a first join without a token", () => {
    expect(planJoinVerify({ ...firstJoin, turnstileToken: null })).toEqual({
      action: "reject",
    });
    expect(planJoinVerify({ ...firstJoin, turnstileToken: "" })).toEqual({
      action: "reject",
    });
  });

  // SECURITY: the skip paths must be unreachable for first joins — a skip
  // here would admit a player who never passed Turnstile.
  it("never skips a first join, whatever the game/identity state", () => {
    expect(
      planJoinVerify({
        ...firstJoin,
        gameStarted: true,
        identityUnchanged: true,
      }),
    ).toEqual({ action: "verify", token: "tok" });
    expect(
      planJoinVerify({
        ...firstJoin,
        turnstileToken: null,
        gameStarted: true,
        identityUnchanged: true,
      }),
    ).toEqual({ action: "reject" });
  });

  it("verifies a pre-start re-admit with a changed identity using a null token", () => {
    expect(planJoinVerify(readmit)).toEqual({ action: "verify", token: null });
  });

  // A stale token re-sent by the client must not reach the API: it was
  // already redeemed, so re-admits always verify with a null token.
  it("nulls out the token for re-admits even if the client re-sent one", () => {
    expect(planJoinVerify({ ...readmit, turnstileToken: "stale" })).toEqual({
      action: "verify",
      token: null,
    });
  });

  it("skips re-admits into a started game (identity updates no longer apply)", () => {
    expect(planJoinVerify({ ...readmit, gameStarted: true })).toEqual({
      action: "skip",
    });
  });

  it("skips re-admits whose identity is unchanged (already screened at admission)", () => {
    expect(planJoinVerify({ ...readmit, identityUnchanged: true })).toEqual({
      action: "skip",
    });
  });

  it("verifies a Steam-authed first join with a null token (skips siteverify, keeps the name check)", () => {
    expect(planJoinVerify({ ...firstJoin, steamAuthed: true })).toEqual({
      action: "verify",
      token: null,
    });
  });

  // Steam ownership stands in for the token: a Steam-authed first join is never
  // rejected for a missing token, and never skips the API (name check still runs).
  it("verifies a Steam-authed first join with a null token even when no turnstile token is present", () => {
    expect(
      planJoinVerify({ ...firstJoin, steamAuthed: true, turnstileToken: null }),
    ).toEqual({ action: "verify", token: null });
  });

  it("ignores steamAuthed on re-admits (they already went through the gate)", () => {
    expect(planJoinVerify({ ...readmit, steamAuthed: true })).toEqual({
      action: "verify",
      token: null,
    });
  });
});

describe("isSteamAuthenticated", () => {
  function claims(provider?: string): TokenPayload {
    return {
      jti: "j",
      sub: "s",
      iat: 0,
      iss: "i",
      aud: "openfront.io",
      exp: 0,
      ...(provider ? { provider } : {}),
    } as TokenPayload;
  }

  it("is true only for a verified provider=steam claim", () => {
    expect(isSteamAuthenticated(claims("steam"))).toBe(true);
  });

  it("is false for a missing provider, a non-steam provider, and null claims", () => {
    expect(isSteamAuthenticated(claims())).toBe(false);
    expect(isSteamAuthenticated(claims("discord"))).toBe(false);
    expect(isSteamAuthenticated(null)).toBe(false);
  });
});
