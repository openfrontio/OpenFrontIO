import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => "Bearer t",
  logOut: vi.fn(),
}));
vi.mock("../../src/client/ClientEnv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/ClientEnv")>()),
}));

import { updateUsername } from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";

function response(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("updateUsername", () => {
  const fetchSpy = vi.fn();
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    // Api.ts's getApiBase()/getAudience() read window.BOOTSTRAP_CONFIG via
    // ClientEnv; without it every call throws "Missing BOOTSTRAP_CONFIG"
    // before fetch is ever reached. Same shape as tests/Api.test.ts.
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("sends acceptSuffixed only when asked", async () => {
    fetchSpy.mockResolvedValue(
      response(200, {
        username: "Ninja.4471",
        base: "Ninja",
        discriminator: "4471",
        usernameStatus: "premium",
        nextUsernameChangeAt: null,
        bareClaim: "unavailable",
      }),
    );
    await updateUsername("Ninja");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({
      username: "Ninja",
    });
    await updateUsername("Ninja", { acceptSuffixed: true });
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({
      username: "Ninja",
      acceptSuffixed: true,
    });
  });

  it("maps 409 BARE_NAME_TAKEN to bare_taken with the base", async () => {
    fetchSpy.mockResolvedValue(
      response(409, {
        error: "Conflict",
        code: "BARE_NAME_TAKEN",
        base: "Ninja",
      }),
    );
    expect(await updateUsername("Ninja")).toEqual({
      ok: false,
      code: "bare_taken",
      base: "Ninja",
    });
  });

  it("maps any other 409 to taken, as before", async () => {
    fetchSpy.mockResolvedValue(
      response(409, {
        error: "Conflict",
        message: "Username is already taken",
      }),
    );
    expect(await updateUsername("Ninja")).toEqual({ ok: false, code: "taken" });
  });
});
