import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

// redeemSteamLink is authenticated; Auth is only mocked because Api.ts
// imports it at module scope.
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-jwt"),
  getPlayToken: vi.fn(async () => null),
  logOut: vi.fn(async () => {}),
  userAuth: vi.fn(async () => false),
}));

import { getAuthHeader, logOut } from "../../src/client/Auth";
import {
  fetchSteamLinkTicket,
  parseSteamLinkToken,
  redeemSteamLink,
  stashPendingLink,
  takePendingLink,
} from "../../src/client/SteamLink";

const res = (body: unknown, status = 200) => ({
  status,
  json: async () => body,
});

const fetchMock = () => global.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  // Short-circuits getApiBase before it reads localStorage.
  process.env.API_DOMAIN = "api.test";
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Clears call history from the previous test while keeping the default
  // "Bearer test-jwt" / no-op implementations set in the vi.mock factories
  // above (some tests below override getAuthHeader for a single call via
  // mockResolvedValueOnce, so this must not touch that default).
  vi.mocked(getAuthHeader).mockClear();
  vi.mocked(logOut).mockClear();
});

describe("parseSteamLinkToken", () => {
  it("extracts the token", () => {
    expect(parseSteamLinkToken("#steam-link?token=abc123")).toBe("abc123");
  });
  it("returns null for unrelated hashes", () => {
    expect(parseSteamLinkToken("#token-login?token-login=x")).toBeNull();
    expect(parseSteamLinkToken("")).toBeNull();
  });
});

describe("pending link stash", () => {
  it("survives a round trip and is consumed once", () => {
    stashPendingLink("abc");
    expect(takePendingLink()).toBe("abc");
    expect(takePendingLink()).toBeNull();
  });
});

describe("redeemSteamLink", () => {
  it("posts the token with the auth header and returns ok on 200", async () => {
    fetchMock().mockResolvedValueOnce(res({}, 200));

    const result = await redeemSteamLink("tok123");

    expect(result).toEqual({ ok: true });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(String(url)).toContain("/auth/steam/link");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      token: "tok123",
    });
    expect((init as RequestInit).headers as Record<string, string>).toEqual(
      expect.objectContaining({ Authorization: "Bearer test-jwt" }),
    );
  });

  // 200 is idempotent server-side (re-redeeming an already-linked pair also
  // returns 200), so the client doesn't need to special-case that — it can
  // just call again and get another ok.
  it("treats a repeat redemption as ok", async () => {
    fetchMock()
      .mockResolvedValueOnce(res({}, 200))
      .mockResolvedValueOnce(res({}, 200));

    expect(await redeemSteamLink("tok123")).toEqual({ ok: true });
    expect(await redeemSteamLink("tok123")).toEqual({ ok: true });
    expect(fetchMock()).toHaveBeenCalledTimes(2);
  });

  it("refuses to fire when there is no auth session", async () => {
    vi.mocked(getAuthHeader).mockResolvedValueOnce("");

    const result = await redeemSteamLink("tok123");

    expect(result.ok).toBe(false);
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it("clears the stale session and fails on 401", async () => {
    fetchMock().mockResolvedValueOnce(res({}, 401));

    const result = await redeemSteamLink("tok123");

    expect(result.ok).toBe(false);
    expect(logOut).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's 409 reason verbatim", async () => {
    fetchMock().mockResolvedValueOnce(
      res({ reason: "steam_has_progress" }, 409),
    );

    const result = await redeemSteamLink("tok123");

    expect(result).toEqual({ ok: false, reason: "steam_has_progress" });
  });

  it("maps 410 (expired ticket) to reason 'expired'", async () => {
    fetchMock().mockResolvedValueOnce(res({}, 410));

    const result = await redeemSteamLink("tok123");

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("does not collapse an unrelated failure into the 409/410 reasons", async () => {
    fetchMock().mockResolvedValueOnce(res({}, 500));

    const result = await redeemSteamLink("tok123");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).not.toBe("expired");
    expect(result.reason).not.toBe("steam_has_progress");
  });

  it("returns a failure result when the request throws", async () => {
    fetchMock().mockRejectedValueOnce(new TypeError("network down"));

    const result = await redeemSteamLink("tok123");

    expect(result.ok).toBe(false);
  });
});

describe("fetchSteamLinkTicket", () => {
  it("fetches the persona for the confirmation modal, unauthenticated", async () => {
    fetchMock().mockResolvedValueOnce(
      res({ state: "pending", reason: null, personaName: "Ada" }, 200),
    );

    const result = await fetchSteamLinkTicket("tok123");

    expect(result).toEqual({ ok: true, personaName: "Ada" });
    expect(fetchMock()).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock().mock.calls[0];
    expect(String(url)).toContain("/auth/steam/link_ticket/tok123");
    // Unauthenticated: no Authorization header sent (unlike redeemSteamLink).
    expect(
      (init as RequestInit | undefined)?.headers as
        | Record<string, string>
        | undefined,
    ).not.toHaveProperty("Authorization");
  });

  it("passes through a null persona (Steam declined to resolve one)", async () => {
    fetchMock().mockResolvedValueOnce(
      res({ state: "pending", reason: null, personaName: null }, 200),
    );

    expect(await fetchSteamLinkTicket("tok123")).toEqual({
      ok: true,
      personaName: null,
    });
  });

  it("returns ok:false for an unknown/expired token (404)", async () => {
    fetchMock().mockResolvedValueOnce(res({}, 404));

    expect(await fetchSteamLinkTicket("tok123")).toEqual({ ok: false });
  });

  it("returns ok:false when the request throws", async () => {
    fetchMock().mockRejectedValueOnce(new TypeError("network down"));

    expect(await fetchSteamLinkTicket("tok123")).toEqual({ ok: false });
  });
});
