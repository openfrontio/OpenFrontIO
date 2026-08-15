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

  it("announces the logout so account state can be cleared", async () => {
    // getUserMe resolves false for a 401 and for a transient failure alike,
    // and caches either, so consumers holding account state cannot tell them
    // apart. Only the 401 is a real sign-out, so only it is announced.
    const seen: (unknown | false)[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("userMeResponse", listener);

    respondWith(401);
    await expect(getUserMe()).resolves.toBe(false);

    document.removeEventListener("userMeResponse", listener);
    expect(logOut).toHaveBeenCalled();
    expect(seen).toEqual([false]);
  });

  it("stays quiet on a transient failure", async () => {
    const seen: unknown[] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent).detail);
    document.addEventListener("userMeResponse", listener);

    respondWith(503);
    await expect(getUserMe()).resolves.toBe(false);

    document.removeEventListener("userMeResponse", listener);
    expect(logOut).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});
