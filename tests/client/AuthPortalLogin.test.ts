import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const portal = vi.hoisted(() => ({
  name: vi.fn((): "crazygames" | "poki" | null => null),
  getUserToken: vi.fn(async (): Promise<string | null> => null),
}));

vi.mock("../../src/client/UserSettings", () => ({
  UserSettings: { setPlayerId: vi.fn() },
}));
vi.mock("../../src/client/SteamSDK", () => ({
  steamSDK: { isOnSteam: () => false },
}));
vi.mock("../../src/client/GamePortal", () => ({ gamePortal: portal }));

const { clearLocalSession, userAuth } = await import("../../src/client/Auth");
const { ClientEnv } = await import("../../src/client/ClientEnv");

// Portal players exchange a fresh portal token at /auth/<portal> rather than
// using the refresh cookie, which a cross-site iframe never sends.
describe("portal login", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.dev",
      instanceId: "web",
      gitCommit: "test",
    };
    ClientEnv.reset();
    fetchMock = vi.fn(async () => ({
      status: 200,
      json: async () => ({ jwt: "jwt-value", expiresIn: 3600 }),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    clearLocalSession();
    vi.unstubAllGlobals();
    portal.name.mockReset().mockReturnValue(null);
    portal.getUserToken.mockReset().mockResolvedValue(null);
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it.each(["poki", "crazygames"] as const)(
    "exchanges a signed-in %s token at its endpoint",
    async (name) => {
      portal.name.mockReturnValue(name);
      portal.getUserToken.mockResolvedValue("portal-token");
      await userAuth();
      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`https://api.openfront.dev/auth/${name}`);
      expect(JSON.parse(init.body)).toEqual({ token: "portal-token" });
      // Bounded, so an exchange that never answers can't stall userAuth().
      expect(init.signal).toBeInstanceOf(AbortSignal);
    },
  );

  it("falls back to the guest refresh when no portal user is signed in", async () => {
    portal.name.mockReturnValue("poki");
    await userAuth();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.openfront.dev/auth/refresh",
    );
  });
});
