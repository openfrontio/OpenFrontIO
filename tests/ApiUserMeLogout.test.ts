import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logOut = vi.fn(async () => true);
const userAuth = vi.fn(async () => ({
  jwt: "jwt",
  claims: { sub: "player-1" },
}));
vi.mock("../src/client/Auth", () => ({
  logOut: () => logOut(),
  userAuth: () => userAuth(),
  isSessionActive: () => true,
  getPlayToken: async () => "token",
  getAuthHeader: async () => "",
}));

const { getUserMe, invalidateUserMe } = await import("../src/client/Api");
const { ClientEnv } = await import("../src/client/ClientEnv");

// getApiBase() reads this; without it the fetch never happens and getUserMe
// returns false from its catch, which would pass the test vacuously.
function setConfig() {
  (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "desktop",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

function respondWith(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status, json: async () => ({}) }) as Response),
  );
}

describe("getUserMe on an expired session", () => {
  beforeEach(() => {
    setConfig();
    invalidateUserMe();
    logOut.mockClear();
  });

  afterEach(() => {
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("logs out on a 401, which is what announces the sign-out", () => {
    // getUserMe resolves false for a 401 and for a transient failure alike,
    // and caches either, so consumers holding account state cannot tell them
    // apart from the return value. Clearing the session is the signal — see
    // Auth.clearLocalSession, which every logout path goes through.
    respondWith(401);
    return getUserMe().then((result) => {
      expect(result).toBe(false);
      expect(logOut).toHaveBeenCalled();
    });
  });

  it("drops the cached profile when the session is cleared", async () => {
    // getUserMe answers from its cache before checking authentication, so a
    // profile fetched under the old session would otherwise still be handed
    // out after a background logout.
    respondWith(200);
    const calls = () =>
      (globalThis.fetch as unknown as { mock: { calls: [] } }).mock.calls
        .length;

    await getUserMe();
    const afterFirst = calls();
    await getUserMe();
    expect(calls()).toBe(afterFirst);

    document.dispatchEvent(new CustomEvent("session-cleared"));
    await getUserMe();

    expect(calls()).toBeGreaterThan(afterFirst);
  });

  it("leaves the session alone on a transient failure", () => {
    respondWith(503);
    return getUserMe().then((result) => {
      expect(result).toBe(false);
      expect(logOut).not.toHaveBeenCalled();
    });
  });
});
