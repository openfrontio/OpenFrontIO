import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => "Bearer t",
  logOut: vi.fn(),
}));
vi.mock("../../src/client/ClientEnv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/ClientEnv")>()),
}));

import { setLevelVisibility } from "../../src/client/Api";
import { logOut } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("setLevelVisibility", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.mocked(logOut).mockClear();
    vi.stubGlobal("fetch", fetchSpy);
    // getApiBase() reads window.BOOTSTRAP_CONFIG via ClientEnv (same shape as
    // UpdateUsername.test.ts).
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("PUTs the desired state with the auth header and returns the echo", async () => {
    fetchSpy.mockResolvedValue(response(200, { hidden: true }));

    expect(await setLevelVisibility(true)).toEqual({ ok: true, hidden: true });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/users\/@me\/level_visibility$/);
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ hidden: true });
  });

  it("sends hidden=false to show the level again", async () => {
    fetchSpy.mockResolvedValue(response(200, { hidden: false }));

    expect(await setLevelVisibility(false)).toEqual({
      ok: true,
      hidden: false,
    });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      hidden: false,
    });
  });

  it("maps 400 to failed", async () => {
    fetchSpy.mockResolvedValue(response(400, { error: "Bad Request" }));

    expect(await setLevelVisibility(true)).toEqual({
      ok: false,
      code: "failed",
    });
    expect(logOut).not.toHaveBeenCalled();
  });

  it("maps 401 to logged_out and runs the signed-out handling", async () => {
    fetchSpy.mockResolvedValue(response(401, { error: "Unauthorized" }));

    expect(await setLevelVisibility(true)).toEqual({
      ok: false,
      code: "logged_out",
    });
    expect(logOut).toHaveBeenCalledTimes(1);
  });

  it("maps a rate limit, an unreadable body and a network error to failed", async () => {
    fetchSpy.mockResolvedValueOnce(response(429, {}));
    expect(await setLevelVisibility(true)).toEqual({
      ok: false,
      code: "failed",
    });

    fetchSpy.mockResolvedValueOnce(response(200, { hidden: "yes" }));
    expect(await setLevelVisibility(true)).toEqual({
      ok: false,
      code: "failed",
    });

    fetchSpy.mockRejectedValueOnce(new TypeError("network"));
    expect(await setLevelVisibility(true)).toEqual({
      ok: false,
      code: "failed",
    });
  });
});
