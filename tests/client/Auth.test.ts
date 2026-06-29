import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Auth.ts derives the API origin from window.location via ./Api. Pin it so the
// fetch URLs are deterministic in the jsdom environment.
vi.mock("../../src/client/Api", () => ({
  getApiBase: () => "http://localhost:8787",
  getAudience: () => "localhost",
}));

import { logOut, userAuth } from "../../src/client/Auth";

const PERSISTENT_ID_KEY = "player_persistent_id";

describe("Auth: transient failures must not destroy identity", () => {
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

  it("preserves the persistent ID and session when /auth/refresh returns a transient non-200", async () => {
    localStorage.setItem(PERSISTENT_ID_KEY, "keep-me-123");
    const fetchMock = vi.fn(async (url: unknown) => {
      if (String(url).includes("/auth/refresh")) {
        return { status: 503, ok: false, json: async () => ({}) };
      }
      return { status: 200, ok: true, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await userAuth();

    // Not authenticated after a failed refresh...
    expect(result).toBe(false);
    // ...but the persistent identity survives so the next refresh can recover.
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("keep-me-123");
    // A transient refresh failure must not revoke the session.
    const postedLogout = fetchMock.mock.calls.some(([u]) =>
      String(u).includes("/auth/logout"),
    );
    expect(postedLogout).toBe(false);
  });

  it("wipes local identity only on an explicit user-initiated logOut", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);

    // Error-path / programmatic logout must preserve the persistent identity.
    localStorage.setItem(PERSISTENT_ID_KEY, "keep-me-456");
    await logOut();
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("keep-me-456");

    // The real "Log out" button passes userInitiated=true and clears identity.
    await logOut(false, true);
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBeNull();
  });
});
