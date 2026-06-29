import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth.ts derives the API origin from window.location via ./Api. Pin it so the
// fetch URLs are deterministic in the jsdom environment.
vi.mock("../../src/client/Api", () => ({
  getApiBase: () => "http://localhost:8787",
  getAudience: () => "localhost",
}));

import { getLastRefreshOutcome, logOut, userAuth } from "../../src/client/Auth";

const PERSISTENT_ID_KEY = "player_persistent_id";

// Build a decodeable JWT whose `iss` matches getApiBase() so userAuth()'s
// claim checks pass. Only the payload matters to decodeJwt.
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(payload)}.sig`;
}

const okJson = (data: unknown) => ({
  status: 200,
  ok: true,
  json: async () => data,
});

describe("Auth: refresh resilience and session-expiry handling", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("retries transient (5xx) refresh failures, then preserves identity without logging out", async () => {
    localStorage.setItem(PERSISTENT_ID_KEY, "keep-me-123");
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/auth/refresh")) {
        return { status: 503, ok: false, json: async () => ({}) };
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await userAuth();

    expect(result).toBe(false);
    // Transient failures are retried (3 attempts) before giving up.
    const refreshCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/auth/refresh"),
    ).length;
    expect(refreshCalls).toBe(3);
    expect(getLastRefreshOutcome()).toBe("transient");
    // Identity preserved and the session is never revoked on a transient blip.
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("keep-me-123");
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("/auth/logout")),
    ).toBe(false);
  });

  it("does NOT retry a definitive 401, and (no prior session) does not raise session-expired", async () => {
    localStorage.setItem(PERSISTENT_ID_KEY, "keep-me-401");
    const onExpired = vi.fn();
    window.addEventListener("auth-session-expired", onExpired);
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/auth/refresh")) {
        return { status: 401, ok: false, json: async () => ({}) };
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await userAuth();

    expect(result).toBe(false);
    // 401 is definitive — exactly one attempt, no retry.
    const refreshCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("/auth/refresh"),
    ).length;
    expect(refreshCalls).toBe(1);
    expect(getLastRefreshOutcome()).toBe("expired");
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("keep-me-401");
    // No active session existed, so we must not nag with the modal.
    expect(onExpired).not.toHaveBeenCalled();
    window.removeEventListener("auth-session-expired", onExpired);
  });

  it("raises auth-session-expired when an ACTIVE session is rejected with a 401", async () => {
    const onExpired = vi.fn();
    window.addEventListener("auth-session-expired", onExpired);
    // First refresh mints a session (already-expired so the next userAuth
    // re-refreshes); the second refresh is rejected.
    let call = 0;
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/auth/refresh")) {
        call++;
        if (call === 1) {
          return okJson({
            jwt: fakeJwt({ iss: "http://localhost:8787" }),
            expiresIn: 0,
          });
        }
        return { status: 401, ok: false, json: async () => ({}) };
      }
      return okJson({});
    });
    vi.stubGlobal("fetch", fetchMock);

    await userAuth(); // establishes __jwt via the first (200) refresh
    await userAuth(); // session now active -> second refresh 401s

    expect(getLastRefreshOutcome()).toBe("expired");
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener("auth-session-expired", onExpired);
  });

  it("wipes local identity only on an explicit user-initiated logOut", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okJson({})),
    );

    localStorage.setItem(PERSISTENT_ID_KEY, "keep-me-456");
    await logOut(); // error-path / programmatic logout
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("keep-me-456");

    await logOut({ userInitiated: true }); // the real "Log out" button
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBeNull();
  });
});
