import type { TokenPayload } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _clearInFlightTokens,
  _inFlightTokenCount,
  clientAuth,
  isSteamAuthenticated,
  planJoinVerify,
  verifyJoin,
} from "../../src/server/JoinVerify";

// verifyJoin resolves its endpoint from ServerEnv.jwtIssuer(), which throws
// if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 300, status, json: async () => body };
}

describe("verifyJoin", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    _clearInFlightTokens();
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

  it("preserves structured errorCodes on rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "rejected",
          reason: "duplicate",
          errorCodes: ["timeout-or-duplicate"],
        }),
      ),
    );
    expect(await verifyJoin("ip", "tok-dup", "xXblackxX", null)).toEqual({
      status: "rejected",
      reason: "duplicate",
      errorCodes: ["timeout-or-duplicate"],
    });
  });

  it("coalesces concurrent in-flight verifyJoin calls for the same non-null token and identity", async () => {
    let resolveFetch: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const call1 = verifyJoin("ip1", "shared-tok", "User1", null);
    const call2 = verifyJoin("ip2", "shared-tok", "User1", null);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!(
      jsonResponse({
        status: "approved",
        username: "User1",
        clanTag: null,
      }),
    );

    const [v1, v2] = await Promise.all([call1, call2]);
    expect(v1).toEqual({
      status: "approved",
      username: "User1",
      clanTag: null,
    });
    expect(v2).toEqual(v1);
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("dispatches a subsequent verifyJoin call after previous in-flight finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        username: "User1",
        clanTag: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await verifyJoin("ip1", "shared-tok", "User1", null);
    const second = await verifyJoin("ip2", "shared-tok", "User1", null);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first.status).toBe("approved");
    expect(second.status).toBe("approved");
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("does not coalesce concurrent calls with the same token but different username or clanTag", async () => {
    let resolveFetch: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const c1 = verifyJoin("ip1", "shared-tok", "Alice", "TAG");
    const c2 = verifyJoin("ip2", "shared-tok", "Bob", "TAG");
    const c3 = verifyJoin("ip3", "shared-tok", "Alice", "OTHER");
    const c4 = verifyJoin("ip4", "shared-tok", "Alice", null);
    const c1Retry = verifyJoin("ip5", "shared-tok", "Alice", "TAG");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(_inFlightTokenCount()).toBe(4);

    resolveFetch!(
      jsonResponse({
        status: "approved",
        username: "Mocked",
        clanTag: null,
      }),
    );

    const [r1, r2, r3, r4, rRetry] = await Promise.all([
      c1,
      c2,
      c3,
      c4,
      c1Retry,
    ]);
    expect(rRetry).toBe(r1);
    expect([r1, r2, r3, r4].every((r) => r.status === "approved")).toBe(true);
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("does not coalesce concurrent calls with the same token and username but different persistentIds", async () => {
    let resolveFetch: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const call1 = verifyJoin("ip1", "shared-tok", "User1", null, "pid-1");
    const call2 = verifyJoin("ip2", "shared-tok", "User1", null, "pid-2");
    const call1Dup = verifyJoin("ip3", "shared-tok", "User1", null, "pid-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(_inFlightTokenCount()).toBe(2);

    resolveFetch!(
      jsonResponse({
        status: "approved",
        username: "User1",
        clanTag: null,
      }),
    );

    const [v1, v2, v1Dup] = await Promise.all([call1, call2, call1Dup]);
    expect(v1.status).toBe("approved");
    expect(v2.status).toBe("approved");
    expect(v1Dup).toBe(v1);
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("treats omitted persistentId as distinct from defined persistentId", async () => {
    let resolveFetch: (val: unknown) => void;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const call1 = verifyJoin("ip1", "shared-tok", "User1", null);
    const call2 = verifyJoin("ip2", "shared-tok", "User1", null, "pid-1");
    const call1Dup = verifyJoin("ip3", "shared-tok", "User1", null);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(_inFlightTokenCount()).toBe(2);

    resolveFetch!(
      jsonResponse({
        status: "approved",
        username: "User1",
        clanTag: null,
      }),
    );

    const [v1, v2, v1Dup] = await Promise.all([call1, call2, call1Dup]);
    expect(v1.status).toBe("approved");
    expect(v2.status).toBe("approved");
    expect(v1Dup).toBe(v1);
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("coalesces concurrent in-flight verifyJoin calls on fetch failure and clears in-flight map", async () => {
    let rejectFetch: (err: unknown) => void;
    const fetchPromise = new Promise((_, reject) => {
      rejectFetch = reject;
    });
    const fetchMock = vi.fn().mockImplementation(() => fetchPromise);
    vi.stubGlobal("fetch", fetchMock);

    const call1 = verifyJoin("ip1", "failing-tok", "User1", null);
    const call2 = verifyJoin("ip2", "failing-tok", "User1", null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(_inFlightTokenCount()).toBe(1);

    rejectFetch!(new Error("network failure"));

    const [v1, v2] = await Promise.all([call1, call2]);
    expect(v1.status).toBe("error");
    expect(v2.status).toBe("error");
    expect(v1).toEqual(v2);
    expect(_inFlightTokenCount()).toBe(0);
  });

  it("does not coalesce calls when token is empty string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "approved",
        username: "User",
        clanTag: null,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const call1 = verifyJoin("ip1", "", "User1", null);
    const call2 = verifyJoin("ip2", "", "User2", null);

    await Promise.all([call1, call2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(_inFlightTokenCount()).toBe(0);
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

  // The API answers 200 {status:"error"} when siteverify or the name check
  // fails or runs past its budget; the name verdict rides along when the
  // name check finished.
  it("passes a degraded error verdict through with the API's identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "error",
          reason: "turnstile timed out",
          username: "SnugglePuppy",
          clanTag: "COOL",
        }),
      ),
    );
    expect(await verifyJoin("ip", "tok", "xXblackxX", "CoOl")).toEqual({
      status: "error",
      reason: "turnstile timed out",
      degraded: true,
      identity: { username: "SnugglePuppy", clanTag: "COOL" },
    });
  });

  it("normalizes an absent clanTag to null on a degraded verdict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: "error",
          reason: "turnstile failed (TimeoutError)",
          username: "Alice",
        }),
      ),
    );
    expect(await verifyJoin("ip", "tok", "Alice", null)).toEqual({
      status: "error",
      reason: "turnstile failed (TimeoutError)",
      degraded: true,
      identity: { username: "Alice", clanTag: null },
    });
  });

  it("returns a degraded verdict without identity when the name check did not finish", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: "error", reason: "name check timed out" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyJoin("ip", "tok", "Alice", null)).toEqual({
      status: "error",
      reason: "name check timed out",
      degraded: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error on a 4xx without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "bad payload" }, 400));
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyJoin("ip", "tok", "Alice", null)).toMatchObject({
      status: "error",
      degraded: false,
    });
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

    expect(await verifyJoin("ip", "tok", "Alice", null)).toMatchObject({
      status: "error",
      degraded: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error on a network error / timeout without retrying", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyJoin("ip", "tok", "Alice", null)).toMatchObject({
      status: "error",
      degraded: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns error on a malformed body without retrying", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ approved: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await verifyJoin("ip", "tok", "Alice", null)).toMatchObject({
      status: "error",
      degraded: false,
    });
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

  it("verifies a pre-start re-admit when stored identity is null (identityUnchanged is false)", () => {
    // When a client drops between verifyJoin and joinClient, isReadmit is true
    // but stored identity is null, resulting in identityUnchanged: false.
    expect(
      planJoinVerify({
        isReadmit: true,
        gameStarted: false,
        turnstileToken: null,
        identityUnchanged: false,
        steamAuthed: false,
      }),
    ).toEqual({ action: "verify", token: null });
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

describe("clientAuth", () => {
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

  it("is account for any persistent provider", () => {
    for (const provider of ["discord", "google", "steam", "email", "poki"]) {
      expect(clientAuth(claims(provider))).toBe("account");
    }
  });

  it("is anonymous for no token, a guest session, and a token without a provider", () => {
    expect(clientAuth(null)).toBe("anonymous");
    expect(clientAuth(claims("guest"))).toBe("anonymous");
    expect(clientAuth(claims())).toBe("anonymous");
  });
});
