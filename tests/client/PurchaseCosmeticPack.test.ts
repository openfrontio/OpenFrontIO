import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  logOut: vi.fn(async () => true),
}));

import { purchaseCosmeticPack } from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";

let fetchMock: ReturnType<typeof vi.fn>;

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

beforeEach(() => {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: "test",
    serverHost: "main.openfront.dev",
  };
  ClientEnv.reset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("purchaseCosmeticPack", () => {
  it("posts the pack slug with the user token and returns the grant", async () => {
    respond(200, {
      packName: "starter",
      currencyType: "hard",
      amount: "250",
      flareNames: ["pattern:camo", "flag:pirate"],
    });

    const result = await purchaseCosmeticPack("starter");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/shop\/purchase\/pack$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test",
    );
    expect(JSON.parse(String(init.body))).toEqual({ packName: "starter" });
    expect(result).toEqual({
      ok: true,
      data: {
        packName: "starter",
        currencyType: "hard",
        amount: "250",
        flareNames: ["pattern:camo", "flag:pirate"],
      },
    });
  });

  it("maps the player-facing 400 reasons", async () => {
    respond(400, { error: "Bad request", reason: "Insufficient balance" });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "insufficient_balance",
    });

    respond(400, { reason: "insufficient_balance_debt", debt: "300" });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "debt",
      debt: "300",
    });

    for (const reason of [
      "Pack not found",
      "Pack is not for sale",
      "Pack not available for hard currency",
      "Pack has no items",
    ]) {
      respond(400, { error: "Bad request", reason });
      expect(await purchaseCosmeticPack("starter")).toEqual({
        ok: false,
        code: "unavailable",
      });
    }

    // A malformed body is a client bug, not a player error.
    respond(400, { error: "Bad request", reason: "Invalid request body" });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "failed",
    });
  });

  it("reports which items are already owned on 409", async () => {
    respond(409, {
      error: "Conflict",
      message: "Already owned",
      ownedFlareNames: ["flag:pirate"],
    });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "already_owned",
      ownedFlareNames: ["flag:pirate"],
    });
  });

  it("fails closed on server errors, bad payloads, and network errors", async () => {
    respond(500, { reason: "Pack item is missing its flare" });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "failed",
    });

    respond(200, { packName: "starter" });
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "failed",
    });

    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await purchaseCosmeticPack("starter")).toEqual({
      ok: false,
      code: "failed",
    });
  });
});
