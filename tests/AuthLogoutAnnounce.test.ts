import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/core/game/UserSettings", () => ({
  UserSettings: { setPlayerId: vi.fn() },
}));
vi.mock("../src/client/SteamSDK", () => ({
  steamSDK: {
    isOnSteam: () => false,
    getTicket: async () => ({ ok: false, reason: "unavailable" }),
  },
}));
vi.mock("../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: () => false,
    getUserToken: async () => null,
  },
}));

const { clearLocalSession, userAuth } = await import("../src/client/Auth");
const { ClientEnv } = await import("../src/client/ClientEnv");

// Deliberately not userMeResponse: account state lives partly outside that
// event (the nav button's cached profile, window.adsEnabled), so Main answers
// this by running its no-session path, which broadcasts userMeResponse itself.
function listen(): { seen: unknown[]; stop: () => void } {
  const seen: unknown[] = [];
  const listener = (e: Event) => seen.push(e.type);
  document.addEventListener("session-cleared", listener);
  return {
    seen,
    stop: () => document.removeEventListener("session-cleared", listener),
  };
}

// Every logout path — an expired refresh token, a JWT issued for another
// origin, a 401 on any endpoint — runs through clearLocalSession. Consumers
// holding account state can't infer a sign-out otherwise: the calls that fail
// just resolve false, which is also what a network error looks like.
describe("clearLocalSession", () => {
  beforeEach(() => {
    localStorage.clear();
    // getApiBase() reads this.
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.dev",
      instanceId: "desktop",
      gitCommit: "test",
    };
    ClientEnv.reset();
  });

  afterEach(() => {
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("announces the sign-out when a session was in place", async () => {
    // userAuth() with no JWT refreshes, and a 200 from /auth/refresh is what
    // stores one. The token itself is unparseable, so userAuth still resolves
    // false — irrelevant here: the session is established either way, which is
    // what clearLocalSession keys off.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        status: 200,
        json: async () => ({ jwt: "jwt-value", expiresIn: 3600 }),
      })) as unknown as typeof fetch,
    );
    await userAuth();

    const { seen, stop } = listen();
    clearLocalSession();
    stop();

    expect(seen).toEqual(["session-cleared"]);
  });

  it("stays quiet when there was no session to clear", () => {
    const { seen, stop } = listen();
    clearLocalSession();
    stop();

    // Guests clear on every failed refresh; announcing each one would churn
    // every consumer for no change.
    expect(seen).toEqual([]);
  });
});
