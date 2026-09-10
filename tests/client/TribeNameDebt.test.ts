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

// Planted in the bodies of the rejected-amount cases: an amount we refused to
// use is by definition one we did not understand, so none of it may reach a
// log line.
const CANARY = "CANARY-9f3c1d";

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

// A rejected debt amount warns exactly once, with exactly one argument, and
// says nothing about the body. The single-argument shape is the OPE-376 rule.
function expectRejectedAmountWarn() {
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).toHaveBeenCalledTimes(1);
  const call = vi.mocked(console.warn).mock.calls[0];
  expect(call).toHaveLength(1);
  expect(String(call[0])).not.toContain(CANARY);
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

    // The amount IS the message ("your balance is X in debt"), so a debt we
    // cannot state is worse than a generic failure — it would render "your
    // balance is  in debt" at the player. Digits only: the API sends a
    // stringified positive bigint, so everything else fails closed.
    it.each([
      ["missing", {}],
      ["empty", { debt: "" }],
      ["not a number", { debt: "lots" }],
      ["an object", { debt: { amount: 250 } }],
      ["negative", { debt: "-250" }],
      // String() would launder both of these into a valid-looking "250".
      ["a number", { debt: 250 }],
      ["a one-element array", { debt: ["250"] }],
    ])(
      "falls back to a generic failure when the amount is %s",
      async (_label, extra) => {
        respond(400, {
          reason: "insufficient_balance_debt",
          canary: CANARY,
          ...extra,
        });
        expect(await purchaseTribeName("Ninja")).toEqual({
          ok: false,
          code: "failed",
        });
        expectRejectedAmountWarn();
      },
    );

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
    //
    // These bodies carry no `code`, so they are the pre-OPE-389 fallback:
    // production can lag the API, and a server that has not shipped the codes
    // yet must still produce a translated refusal.
    it.each([
      [
        "Name may only contain letters, numbers, spaces, and ' - . _ ! ?",
        "invalid_charset",
      ],
      ["Name must contain a letter", "invalid_no_letter"],
      ["This name is not allowed", "not_allowed"],
    ])(
      "falls back to the reason %s when the body has no code",
      async (reason, code) => {
        respond(400, { reason });
        expect(await purchaseTribeName("Ninja")).toEqual({ ok: false, code });
      },
    );

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

    // OPE-389: the API now sends a stable machine `code` beside the prose.
    // Every body below pairs a real code with prose this client does not
    // recognise, which is the whole point — `reason` is documentation, and a
    // reworded or localized one must not change what the player is told.
    describe("branches on the machine code", () => {
      const UNMATCHED_PROSE = "Refusal prose this client never matched";

      it.each([
        ["invalid_charset", "invalid_charset"],
        ["no_letter", "invalid_no_letter"],
        ["not_allowed", "not_allowed"],
      ])("maps code %s regardless of the reason", async (sent, code) => {
        respond(400, { code: sent, reason: UNMATCHED_PROSE });
        const result = await purchaseTribeName("Ninja");
        expect(result).toEqual({ ok: false, code });
        expect(Object.values(result)).not.toContain(UNMATCHED_PROSE);
      });

      // The bounds come off the body rather than out of the sentence, so the
      // client stops depending on the server's number formatting — and on
      // the server writing them in English at all.
      it("takes the length bounds from min/max, not the prose", async () => {
        respond(400, {
          code: "length",
          reason: UNMATCHED_PROSE,
          min: 5,
          max: 30,
        });
        expect(await purchaseTribeName("Ninja")).toEqual({
          ok: false,
          code: "length",
          min: 5,
          max: 30,
        });
      });

      // The bounds ARE the message. An unusable pair is not a message, so it
      // falls back to the prose the same server still sends.
      it.each([
        ["missing", {}],
        ["a string", { min: "3", max: "24" }],
        ["zero", { min: 0, max: 24 }],
        ["fractional", { min: 3.5, max: 24 }],
        // Two plausible numbers and one impossible range: it would render
        // "24-3" at the player.
        ["inverted", { min: 24, max: 3 }],
      ])(
        "falls back to the prose bounds when min/max are %s",
        async (_label, bounds) => {
          respond(400, {
            code: "length",
            reason: "Name must be 3-24 characters",
            ...bounds,
          });
          expect(await purchaseTribeName("Ninja")).toEqual({
            ok: false,
            code: "length",
            min: 3,
            max: 24,
          });
        },
      );

      it("gives a generic failure when neither bounds nor prose parse", async () => {
        respond(400, { code: "length", reason: UNMATCHED_PROSE });
        expect(await purchaseTribeName("Ninja")).toEqual({
          ok: false,
          code: "failed",
        });
      });

      // The code wins over the reason, so a code this client does not know is
      // a generic failure even when a recognised English sentence sits beside
      // it — the API is telling us it means something we have not handled.
      it("gives a generic failure for a code it does not know", async () => {
        respond(400, {
          code: "some_future_code",
          reason: "Name must contain a letter",
        });
        const result = await purchaseTribeName("Ninja");
        expect(result).toEqual({ ok: false, code: "failed" });
        expect(Object.values(result)).not.toContain("some_future_code");
      });

      // A `code` key that is present but unusable is not the same as an
      // absent one: the server meant to send a code, so reading its English
      // instead would be interpreting a body we have established we do not
      // understand. Each row pairs it with a reason the legacy path matches,
      // so a fall-through to that path returns invalid_no_letter here.
      it.each([
        ["empty", ""],
        ["a number", 42],
        ["null", null],
        // A bare map lookup would return Object.prototype.constructor.
        ["constructor", "constructor"],
      ])(
        "treats a code that is %s as unknown, not absent",
        async (_l, code) => {
          respond(400, { code, reason: "Name must contain a letter" });
          expect(await purchaseTribeName("Ninja")).toEqual({
            ok: false,
            code: "failed",
          });
        },
      );

      it("maps the shortfall code past a reworded reason", async () => {
        respond(400, {
          code: "insufficient_balance",
          reason: UNMATCHED_PROSE,
        });
        expect(await purchaseTribeName("Ninja")).toEqual({
          ok: false,
          code: "insufficient_balance",
        });
      });

      it("maps the debt code past a reworded reason", async () => {
        respond(400, {
          code: "insufficient_balance_debt",
          reason: UNMATCHED_PROSE,
          debt: "250",
        });
        expect(await purchaseTribeName("Ninja")).toEqual({
          ok: false,
          code: "debt",
          debt: "250",
        });
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

    // Same rule as the purchase path. These rows also pin the branch order:
    // the debt reason is read before the catch-all that turns any other
    // string reason into insufficient_balance, so a regression that
    // re-collapsed the two would return insufficient_balance here.
    it.each([
      ["missing", {}],
      ["empty", { debt: "" }],
      ["not a number", { debt: "lots" }],
      ["an object", { debt: { amount: 80 } }],
      ["negative", { debt: "-80" }],
      ["a number", { debt: 80 }],
      ["a one-element array", { debt: ["80"] }],
    ])(
      "falls back to a generic failure when the amount is %s",
      async (_label, extra) => {
        respond(400, {
          reason: "insufficient_balance_debt",
          canary: CANARY,
          ...extra,
        });
        expect(await boostTribeName("7", "key")).toEqual({
          ok: false,
          code: "failed",
        });
        expectRejectedAmountWarn();
      },
    );

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

    // OPE-389. This path used to treat any string reason as a shortfall,
    // which is only safe while balance is the endpoint's only refusal. With
    // a code in the body it no longer has to assume.
    describe("branches on the machine code", () => {
      const UNMATCHED_PROSE = "Refusal prose this client never matched";

      it("maps the shortfall code past a reworded reason", async () => {
        respond(400, {
          code: "insufficient_balance",
          reason: UNMATCHED_PROSE,
        });
        expect(await boostTribeName("7", "key")).toEqual({
          ok: false,
          code: "insufficient_balance",
        });
      });

      it("maps the debt code past a reworded reason", async () => {
        respond(400, {
          code: "insufficient_balance_debt",
          reason: UNMATCHED_PROSE,
          debt: "80",
        });
        expect(await boostTribeName("7", "key")).toEqual({
          ok: false,
          code: "debt",
          debt: "80",
        });
      });

      // Guessing a shortfall here would offer a top-up for a refusal that a
      // top-up may not clear — the same mistake the debt branch exists to
      // undo.
      it("does not guess a shortfall for a code it does not know", async () => {
        respond(400, { code: "some_future_code", reason: UNMATCHED_PROSE });
        const result = await boostTribeName("7", "key");
        expect(result).toEqual({ ok: false, code: "failed" });
        expect(Object.values(result)).not.toContain("some_future_code");
      });
    });
  });
});
