import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => "Bearer t",
  logOut: vi.fn(),
}));
vi.mock("../../src/client/ClientEnv", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/ClientEnv")>()),
}));

import { finalizeGooglePurchase } from "../../src/client/Api";
import { logOut } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("finalizeGooglePurchase", () => {
  const fetchSpy = vi.fn();
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy.mockReset();
    vi.mocked(logOut).mockClear();
    vi.stubGlobal("fetch", fetchSpy);
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    // The token is a credential for the purchase: it must never reach a log.
    for (const call of consoleError.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("secret-token");
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("POSTs the token with the auth header", async () => {
    fetchSpy.mockResolvedValue(response(200, { status: "settled" }));

    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: true,
      status: "settled",
    });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/payments\/google\/finalize$/);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer t");
    expect(JSON.parse(init.body)).toEqual({ purchaseToken: "secret-token" });
  });

  it("passes pending through", async () => {
    fetchSpy.mockResolvedValue(response(200, { status: "pending" }));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: true,
      status: "pending",
    });
  });

  it("maps 409 to refused with the server's reason", async () => {
    fetchSpy.mockResolvedValue(
      response(409, { status: "refused", reason: "wrong_account" }),
    );
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "refused",
      reason: "wrong_account",
    });
  });

  it("maps a 409 without a readable reason to refused", async () => {
    fetchSpy.mockResolvedValue(new Response("nope", { status: 409 }));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "refused",
      reason: "unknown",
    });
  });

  it("maps 401 to unauthorized and runs the signed-out handling", async () => {
    fetchSpy.mockResolvedValue(response(401, { error: "Unauthorized" }));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "unauthorized",
    });
    expect(logOut).toHaveBeenCalledTimes(1);
  });

  it("maps 429 to rate_limited", async () => {
    fetchSpy.mockResolvedValue(response(429, {}));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "rate_limited",
    });
  });

  it.each([
    [
      "502 google_unavailable",
      () => response(502, { reason: "google_unavailable" }),
    ],
    ["501 rail not configured", () => response(501, {})],
    ["500", () => response(500, {})],
    ["an unreadable 200", () => response(200, { status: "credited" })],
  ])("maps %s to retry_later", async (_label, make) => {
    fetchSpy.mockResolvedValue(make());
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "retry_later",
    });
  });

  it("maps a network error to retry_later", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network"));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "retry_later",
    });
  });

  it.each([400, 403])("maps %i to failed", async (status) => {
    fetchSpy.mockResolvedValue(response(status, {}));
    expect(await finalizeGooglePurchase("secret-token")).toEqual({
      ok: false,
      code: "failed",
    });
    expect(logOut).not.toHaveBeenCalled();
  });
});
