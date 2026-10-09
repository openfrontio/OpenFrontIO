import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: { jwtAudience: () => "localhost" },
}));

import { userAuth } from "../../src/client/Auth";

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
});
