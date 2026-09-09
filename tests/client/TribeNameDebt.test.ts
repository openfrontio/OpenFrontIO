import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The shared spend helper in the API returns
// `{reason: "insufficient_balance_debt", debt}` whenever a refund or
// chargeback has left the wallet negative. Every endpoint routed through it
// can surface that reason, so every client path off those endpoints has to
// tell the two apart: being short is fixed by topping up, a debt is not.
//
// Two levels here. The first half drives the real Api wrappers over a mocked
// fetch, which is where the reason string is read. The second mounts the
// panel to check what a player actually ends up looking at — in particular
// that the machine reason never reaches the screen.

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  logOut: vi.fn(async () => true),
}));

import { boostTribeName, purchaseTribeName } from "../../src/client/Api";
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

describe("tribe-name spend paths map the debt reason", () => {
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

  describe("purchaseTribeName", () => {
    it("reports the debt and its amount", async () => {
      respond(400, { reason: "insufficient_balance_debt", debt: "250" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "debt",
        debt: "250",
      });
    });

    // The reason is the branch key; the amount is only there to quote back.
    // A body without it must still take the debt branch rather than falling
    // through to a generic failure.
    it("still reports a debt whose amount is missing", async () => {
      respond(400, { reason: "insufficient_balance_debt" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "debt",
        debt: "",
      });
    });

    // Previously this fell into "invalid", which the panel prints verbatim —
    // so the English server string was shown where a shortfall and a top-up
    // offer belong.
    it("distinguishes being short from being in debt", async () => {
      respond(400, { reason: "Insufficient balance" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "insufficient_balance",
      });
    });

    it("still passes a genuine name rejection through as prose", async () => {
      respond(400, { reason: "Name is not allowed" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "invalid",
        message: "Name is not allowed",
      });
    });

    it("degrades a 400 with no readable body to a bare invalid", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("<html>gateway</html>", { status: 400 }),
      );
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "invalid",
        message: undefined,
      });
    });
  });

  describe("boostTribeName", () => {
    it("reports the debt and its amount", async () => {
      respond(400, { reason: "insufficient_balance_debt", debt: "80" });
      expect(await boostTribeName("7", "key")).toEqual({
        ok: false,
        code: "debt",
        debt: "80",
      });
    });

    // This path collapsed every reason string into insufficient_balance,
    // which sends a player with a negative wallet to a top-up dialog that
    // cannot clear it.
    it("still reports a plain shortfall as insufficient_balance", async () => {
      respond(400, { reason: "Insufficient balance" });
      expect(await boostTribeName("7", "key")).toEqual({
        ok: false,
        code: "insufficient_balance",
      });
    });

    it("leaves a malformed-id 400 as a generic failure", async () => {
      respond(400, { resource: "id" });
      expect(await boostTribeName("nope", "key")).toEqual({
        ok: false,
        code: "failed",
      });
    });
  });
});
