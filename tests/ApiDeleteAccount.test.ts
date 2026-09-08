import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/client/Auth", () => ({
  logOut: async () => true,
  userAuth: async () => null,
  isSessionActive: () => false,
  getPlayToken: async () => "token",
  getAuthHeader: async () => "",
}));

const { deleteAccount } = await import("../src/client/Api");
const { ClientEnv } = await import("../src/client/ClientEnv");

// getApiBase() reads this; without it the fetch never happens and
// deleteAccount returns "failed" from its catch, passing vacuously.
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

function respondWith(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(
    async () =>
      ({
        status,
        ok: status >= 200 && status < 300,
        statusText: "",
        json: async () => body,
      }) as Response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("deleteAccount (DELETE /users/@me)", () => {
  beforeEach(setConfig);

  afterEach(() => {
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.unstubAllGlobals();
  });

  it("sends the refresh cookie and no Authorization header", async () => {
    const fetchMock = respondWith(204);
    await deleteAccount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url.endsWith("/users/@me")).toBe(true);
    expect(init.method).toBe("DELETE");
    expect(init.credentials).toBe("include");
    expect(init.headers).toBeUndefined();
  });

  it("treats 204 as queued (the account is deleted 24 hours later)", async () => {
    respondWith(204);
    expect(await deleteAccount()).toEqual({ ok: true });
  });

  it("maps 401 to logged_out", async () => {
    respondWith(401, {
      error: "Unauthorized",
      message: "Invalid refresh token",
    });
    expect(await deleteAccount()).toEqual({ ok: false, code: "logged_out" });
  });

  it("passes the server's player-facing message through on 403", async () => {
    respondWith(403, {
      error: "Forbidden",
      message: "Banned accounts cannot be deleted",
    });
    expect(await deleteAccount()).toEqual({
      ok: false,
      code: "forbidden",
      message: "Banned accounts cannot be deleted",
    });
  });

  it("maps the global rate limit (429) to rate_limited, not a support failure", async () => {
    respondWith(429, {
      error: "Too many requests",
      message:
        "Account deletion is temporarily unavailable, please try again later",
    });
    expect(await deleteAccount()).toEqual({ ok: false, code: "rate_limited" });
  });

  it("maps any other status to failed", async () => {
    respondWith(500);
    expect(await deleteAccount()).toEqual({ ok: false, code: "failed" });
  });
});
