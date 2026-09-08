import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCreatorCode,
  getApiBase,
  getAudience,
  getCreatorByCode,
  getUserMe,
  invalidateUserMe,
  setCreatorCode,
} from "../src/client/Api";
import { ClientEnv } from "../src/client/ClientEnv";

// Only the creator-code describe blocks below touch Auth; the getApiBase /
// getAudience tests above never call an authed function, so mocking it here
// doesn't affect them.
const { getAuthHeader, logOut, userAuth, isSessionActive, getPlayToken } =
  vi.hoisted(() => ({
    getAuthHeader: vi.fn(async () => "Bearer test"),
    logOut: vi.fn(async () => true),
    userAuth: vi.fn(async () => ({
      jwt: "jwt",
      claims: { sub: "player-1" },
    })),
    isSessionActive: vi.fn(() => true),
    getPlayToken: vi.fn(async () => "token"),
  }));
vi.mock("../src/client/Auth", () => ({
  getAuthHeader,
  logOut,
  userAuth,
  isSessionActive,
  getPlayToken,
}));

function setConfig(jwtAudience: string) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience,
    instanceId: "desktop",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

// setConfig sets window.BOOTSTRAP_CONFIG; clear it (and the cached env) after
// every test so a stray value can't leak into a later test.
afterEach(() => {
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("getApiBase localhost fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    // getAudience() now reads the audience from BOOTSTRAP_CONFIG, so the
    // localhost branch is reached via jwtAudience "localhost".
    setConfig("localhost");
  });

  // API_DOMAIN is forced empty under vitest via the vite.config `define`, so this
  // regression test exercises the fallback branch deterministically regardless of
  // any API_DOMAIN in the host shell / CI.
  it("falls back to http://localhost:8787 on localhost when apiHost is not set and API_DOMAIN is empty", () => {
    expect(getApiBase()).toBe("http://localhost:8787");
  });
});

describe("getAudience / getApiBase from BOOTSTRAP_CONFIG", () => {
  beforeEach(() => ClientEnv.reset());

  it("returns the configured audience (desktop staging)", () => {
    setConfig("openfront.dev");
    expect(getAudience()).toBe("openfront.dev");
    expect(getApiBase()).toBe("https://api.openfront.dev");
  });

  it("returns the configured audience (prod)", () => {
    setConfig("openfront.io");
    expect(getAudience()).toBe("openfront.io");
    expect(getApiBase()).toBe("https://api.openfront.io");
  });
});

function userMeBody(
  playerOverrides: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    user: {},
    player: {
      publicId: "p1",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      friends: [],
      subscription: null,
      ...playerOverrides,
    },
    ...overrides,
  };
}

describe("creator code client functions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      }),
    );
  }

  beforeEach(() => {
    setConfig("openfront.io");
    invalidateUserMe();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    getAuthHeader.mockClear();
    logOut.mockClear();
    userAuth.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    invalidateUserMe();
  });

  describe("setCreatorCode", () => {
    it("binds the code, returns the creator, and invalidates the /users/@me cache", async () => {
      // Prime the cache so the invalidation is actually observable.
      respond(200, userMeBody());
      await getUserMe();
      const callsBeforeMutation = fetchMock.mock.calls.length;

      respond(200, { code: "LEWIS", displayName: "Lewis" });
      const result = await setCreatorCode("LEWIS");

      expect(result).toEqual({
        ok: true,
        creator: { code: "LEWIS", displayName: "Lewis" },
      });
      expect(fetchMock.mock.calls.length).toBe(callsBeforeMutation + 1);
      const [url, init] = fetchMock.mock.calls[callsBeforeMutation] as [
        string,
        RequestInit,
      ];
      expect(url).toMatch(/\/users\/@me\/creator$/);
      expect(init.method).toBe("PUT");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer test",
      );
      expect(JSON.parse(String(init.body))).toEqual({ code: "LEWIS" });

      // The cache was dropped by the mutation, so this triggers a real fetch
      // rather than being served from the cache primed above.
      respond(200, userMeBody());
      await getUserMe();
      expect(fetchMock.mock.calls.length).toBe(callsBeforeMutation + 2);
    });

    it.each(["invalid", "not_found", "self_referral"] as const)(
      "maps the 400 code %s verbatim",
      async (code) => {
        respond(400, { error: "Bad request", ok: false, code });
        expect(await setCreatorCode("LEWIS")).toEqual({ ok: false, code });
      },
    );

    it("maps an unrecognized 400 code to failed", async () => {
      respond(400, { error: "Bad request", ok: false, code: "something_new" });
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "failed",
      });
    });

    it("maps the real 7-day cooldown 429 (ok:false, code:cooldown) with Retry-After", async () => {
      respond(
        429,
        {
          error: "Too many requests",
          message:
            "You can change your supported creator again in 300 second(s)",
          ok: false,
          code: "cooldown",
        },
        { "Retry-After": "300" },
      );
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "cooldown",
        retryAfterSeconds: 300,
      });
    });

    // A missing/unparseable Retry-After must not be coerced into a fake
    // one-day cooldown (a `0` fallback would ceil to 1 day) -- null tells
    // the panel to render a generic message instead of a bogus day count.
    it("maps a cooldown 429 with no Retry-After to retryAfterSeconds: null", async () => {
      respond(429, {
        error: "Too many requests",
        message: "You can change your supported creator again soon",
        ok: false,
        code: "cooldown",
      });
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "cooldown",
        retryAfterSeconds: null,
      });
    });

    // The shared 10s mutation debounce also 429s, but its body carries no
    // ok/code fields at all — this must NOT be mistaken for the cooldown.
    it("maps a code-less 429 (the shared debounce) to rate_limited", async () => {
      respond(
        429,
        {
          error: "Too many requests",
          message:
            "Please wait a moment before changing your creator code again",
        },
        { "Retry-After": "10" },
      );
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "rate_limited",
      });
    });

    it("logs out and fails closed on 401", async () => {
      respond(401, {});
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "failed",
      });
      expect(logOut).toHaveBeenCalled();
    });

    it("fails closed on a malformed 200 payload", async () => {
      respond(200, { code: "LEWIS" }); // missing displayName
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "failed",
      });
    });

    it("fails closed on a network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("offline"));
      expect(await setCreatorCode("LEWIS")).toEqual({
        ok: false,
        code: "failed",
      });
    });
  });

  describe("getCreatorByCode", () => {
    it("returns the code and display name on 200, with no auth header sent", async () => {
      respond(200, { code: "LEWIS", displayName: "Lewis", status: "active" });
      const result = await getCreatorByCode("LEWIS");
      expect(result).toEqual({ code: "LEWIS", displayName: "Lewis" });
      expect(getAuthHeader).not.toHaveBeenCalled();
    });

    it("encodeURIComponent-escapes the code in the URL", async () => {
      respond(200, { code: "A B", displayName: "A B", status: "active" });
      await getCreatorByCode("A B/C");
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe(
        `${getApiBase()}/creators/code/${encodeURIComponent("A B/C")}`,
      );
      expect(url).not.toContain(" ");
    });

    it("returns null on 404 (unknown or non-active code)", async () => {
      respond(404, { error: "Not found" });
      expect(await getCreatorByCode("NOPE")).toBeNull();
    });

    it("returns null on an invalid body", async () => {
      respond(200, { code: "LEWIS" }); // missing displayName/status
      expect(await getCreatorByCode("LEWIS")).toBeNull();
    });
  });

  describe("clearCreatorCode", () => {
    it("unbinds and invalidates the /users/@me cache on 200", async () => {
      respond(200, userMeBody());
      await getUserMe();
      const callsBeforeMutation = fetchMock.mock.calls.length;

      respond(200, { ok: true });
      expect(await clearCreatorCode()).toEqual({ ok: true });
      expect(fetchMock.mock.calls.length).toBe(callsBeforeMutation + 1);

      const [url, init] = fetchMock.mock.calls[callsBeforeMutation] as [
        string,
        RequestInit,
      ];
      expect(url).toMatch(/\/users\/@me\/creator$/);
      expect(init.method).toBe("DELETE");
      expect((init.headers as Record<string, string>).Authorization).toBe(
        "Bearer test",
      );

      respond(200, userMeBody());
      await getUserMe();
      expect(fetchMock.mock.calls.length).toBe(callsBeforeMutation + 2);
    });

    it("logs out and fails closed on 401", async () => {
      respond(401, {});
      expect(await clearCreatorCode()).toEqual({ ok: false, code: "failed" });
      expect(logOut).toHaveBeenCalled();
    });

    // Unbinding is never gated by the real 7-day cooldown (see the doc
    // comment on clearCreatorCode), so the only 429 this endpoint can ever
    // return is the shared 10s mutation debounce — map it to rate_limited
    // rather than lumping it into the generic failure.
    it("maps the shared debounce 429 to rate_limited", async () => {
      respond(
        429,
        {
          error: "Too many requests",
          message: "Please wait a moment before trying again",
        },
        { "Retry-After": "10" },
      );
      expect(await clearCreatorCode()).toEqual({
        ok: false,
        code: "rate_limited",
      });
    });

    it("fails closed on a network error", async () => {
      fetchMock.mockRejectedValueOnce(new Error("offline"));
      expect(await clearCreatorCode()).toEqual({ ok: false, code: "failed" });
    });
  });
});
