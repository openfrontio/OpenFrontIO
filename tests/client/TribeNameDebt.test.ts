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
    // The unrecognised-reason cases warn by design; keep the run quiet.
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

    // Each of the endpoint's refusals maps to a code the panel translates.
    // Nothing reaches the player as the server's English, so a non-English
    // locale gets a localized reason rather than a localized shell around an
    // English sentence.
    it.each([
      [
        "Name may only contain letters, numbers, spaces, and ' - . _ ! ?",
        "invalid_charset",
      ],
      ["Name must contain a letter", "invalid_no_letter"],
      ["This name is not allowed", "not_allowed"],
    ])("maps the refusal %s to a code", async (reason, code) => {
      respond(400, { reason });
      expect(await purchaseTribeName("Ninja")).toEqual({ ok: false, code });
    });

    // The reasons are matched on their exact English, so a reworded one is
    // unrecognised — the generic failure, never the raw server text.
    it("does not echo a reworded refusal", async () => {
      respond(400, { reason: "This name is not permitted" });
      const result = await purchaseTribeName("Ninja");
      expect(result).toEqual({ ok: false, code: "failed" });
      expect(Object.values(result)).not.toContain("This name is not permitted");
    });

    // The length rule is the one refusal whose content is data — the bounds
    // ARE the message — so it comes back structured for the caller to
    // translate rather than as the server's English.
    it("returns the length bounds structured rather than as prose", async () => {
      respond(400, { reason: "Name must be 3-24 characters" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "length",
        min: 3,
        max: 24,
      });
    });

    // The pattern is anchored and digit-specific on purpose: a bare
    // "Name must be " prefix would pass through anything the API ever chose
    // to start that way, which is the denylist failure the allowlist avoids.
    it.each([
      "Name must be unique",
      "Name must be 3- characters",
      "Name must be 3-24 characters long",
    ])("does not treat %s as the length rule", async (reason) => {
      respond(400, { reason });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "failed",
      });
    });

    // The reasons are allowlisted rather than the machine keys denylisted, so
    // the next branch key the API grows does not land on the player's screen
    // the way "insufficient_balance_debt" did.
    it("does not echo a reason it does not recognise", async () => {
      respond(400, { reason: "some_future_machine_key" });
      const result = await purchaseTribeName("Ninja");
      expect(result).toEqual({ ok: false, code: "failed" });
      // Otherwise an early throw would satisfy this just as well.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Object.values(result)).not.toContain("some_future_machine_key");
    });

    // Client-bug reasons are not written for players either.
    it("does not echo the malformed-request reasons", async () => {
      respond(400, { reason: "Invalid request body" });
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "failed",
      });
    });

    it("degrades a 400 with no readable body to a generic failure", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("<html>gateway</html>", { status: 400 }),
      );
      expect(await purchaseTribeName("Ninja")).toEqual({
        ok: false,
        code: "failed",
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
