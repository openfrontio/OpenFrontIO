import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

import {
  clearLocalSession,
  sessionUncertain,
  userAuth,
} from "../../src/client/Auth";

// Only a 401 from /auth/refresh means the session is dead. A 5xx (a database
// or Hyperdrive blip), a 429 or an edge 403 is transient: logging out on it
// dropped players mid-session and, when /auth/logout reached a healthy
// connection, deleted a session that was still valid.
describe("/auth/refresh failure handling", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  // Written by the client, and removed only by clearLocalSession().
  const PERSISTENT_ID_KEY = "player_persistent_id";

  function answerRefreshWith(status: number) {
    fetchMock = vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
  }

  function logoutCalls() {
    return fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/auth/logout"),
    );
  }

  beforeEach(() => {
    localStorage.setItem(PERSISTENT_ID_KEY, "persistent-id");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearLocalSession();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([500, 503, 429, 403])("keeps the session on a %i", async (status) => {
    answerRefreshWith(status);

    expect(await userAuth()).toBe(false);
    // Let a fire-and-forget logOut() settle, had one been started.
    await new Promise((r) => setTimeout(r, 0));

    expect(logoutCalls()).toHaveLength(0);
    expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBe("persistent-id");
  });

  it("logs out on a 401", async () => {
    answerRefreshWith(401);

    expect(await userAuth()).toBe(false);

    expect(logoutCalls()).toHaveLength(1);
    await vi.waitFor(() =>
      expect(localStorage.getItem(PERSISTENT_ID_KEY)).toBeNull(),
    );
  });

  // userAuth() answers false for both, so callers that must tell "signed
  // out" from "couldn't check" (the end screen's Buy) ask sessionUncertain().
  describe("sessionUncertain", () => {
    it.each([500, 503, 429, 403])("is true after a %i", async (status) => {
      answerRefreshWith(status);
      expect(await userAuth()).toBe(false);
      expect(sessionUncertain()).toBe(true);
    });

    it("is true when the refresh never reaches the server", async () => {
      fetchMock = vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      });
      vi.stubGlobal("fetch", fetchMock);
      expect(await userAuth()).toBe(false);
      expect(sessionUncertain()).toBe(true);
    });

    it("is false after a 401: the session is dead", async () => {
      answerRefreshWith(503);
      await userAuth();
      answerRefreshWith(401);
      expect(await userAuth()).toBe(false);
      expect(sessionUncertain()).toBe(false);
    });

    it("a successful refresh clears it", async () => {
      answerRefreshWith(503);
      await userAuth();
      expect(sessionUncertain()).toBe(true);
      fetchMock = vi.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ jwt: "not-a-real-jwt", expiresIn: 900 }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      await userAuth();
      expect(sessionUncertain()).toBe(false);
    });

    it("a local logout clears it", async () => {
      answerRefreshWith(503);
      await userAuth();
      clearLocalSession();
      expect(sessionUncertain()).toBe(false);
    });
  });
});
