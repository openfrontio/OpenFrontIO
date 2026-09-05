import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logOutMock = vi.fn(async () => true);

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  logOut: () => logOutMock(),
}));

import {
  createPaymentsCheckout,
  finalizeSteamOrder,
} from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";

let fetchMock: ReturnType<typeof vi.fn>;

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );
}

function lastBody(): any {
  const calls = fetchMock.mock.calls;
  const [, init] = calls[calls.length - 1] as [string, RequestInit];
  return JSON.parse(init.body as string);
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
  logOutMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

const OK_BODY = {
  orderId: "1234",
  provider: "steam",
  kind: "currency_pack",
  handoff: "client_overlay",
  redirectUrl: null,
  expiresAt: "2026-09-02T12:34:56.000Z",
};

describe("createPaymentsCheckout request shape", () => {
  it("POSTs to /payments/checkout with the bearer token and the origin", async () => {
    respond(200, OK_BODY);

    await createPaymentsCheckout({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openfront.io/payments/checkout");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test",
    );
    expect(lastBody()).toEqual({
      provider: "steam",
      kind: "currency_pack",
      hostname: window.location.origin,
      packName: "starter_pack",
    });
  });

  it("sends hardAmount (and nothing else) for custom_currency", async () => {
    respond(200, { ...OK_BODY, kind: "custom_currency" });

    await createPaymentsCheckout({
      provider: "stripe",
      kind: "custom_currency",
      hardAmount: 500,
    });

    expect(lastBody()).toEqual({
      provider: "stripe",
      kind: "custom_currency",
      hostname: window.location.origin,
      hardAmount: 500,
    });
  });

  it("sends tierName (and nothing else) for subscription_tier", async () => {
    respond(200, { ...OK_BODY, kind: "subscription_tier", orderId: null });

    await createPaymentsCheckout({
      provider: "stripe",
      kind: "subscription_tier",
      tierName: "supporter",
    });

    expect(lastBody()).toEqual({
      provider: "stripe",
      kind: "subscription_tier",
      hostname: window.location.origin,
      tierName: "supporter",
    });
  });

  it("never sends a priceId", async () => {
    respond(200, OK_BODY);
    await createPaymentsCheckout({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });
    expect(lastBody()).not.toHaveProperty("priceId");
  });
});

describe("createPaymentsCheckout success", () => {
  it("returns the flat handoff/redirect fields verbatim", async () => {
    respond(200, {
      orderId: "1234",
      provider: "stripe",
      kind: "currency_pack",
      handoff: "redirect",
      redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2",
      expiresAt: "2026-09-02T12:34:56.000Z",
    });

    const result = await createPaymentsCheckout({
      provider: "stripe",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    expect(result).toEqual({
      ok: true,
      data: {
        orderId: "1234",
        provider: "stripe",
        kind: "currency_pack",
        handoff: "redirect",
        redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2",
        expiresAt: "2026-09-02T12:34:56.000Z",
      },
    });
  });

  it("keeps orderId as a string, never coercing it to a number", async () => {
    // 2^53 + 1 — a decimal string that cannot round-trip through a JS number.
    respond(200, { ...OK_BODY, orderId: "9007199254740993" });

    const result = await createPaymentsCheckout({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.orderId).toBe("9007199254740993");
  });

  it("accepts a null orderId (subscription_tier on Stripe)", async () => {
    respond(200, {
      orderId: null,
      provider: "stripe",
      kind: "subscription_tier",
      handoff: "redirect",
      redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_sub",
      expiresAt: null,
    });

    const result = await createPaymentsCheckout({
      provider: "stripe",
      kind: "subscription_tier",
      tierName: "supporter",
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.orderId).toBeNull();
    expect(result.data.expiresAt).toBeNull();
  });

  it("accepts client_overlay with a null redirectUrl", async () => {
    respond(200, OK_BODY);

    const result = await createPaymentsCheckout({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.handoff).toBe("client_overlay");
    expect(result.data.redirectUrl).toBeNull();
  });

  it("rejects a redirect handoff with no redirectUrl as a malformed response", async () => {
    respond(200, { ...OK_BODY, handoff: "redirect", redirectUrl: null });

    const result = await createPaymentsCheckout({
      provider: "stripe",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    expect(result).toEqual({ ok: false, code: "failed" });
  });

  it("rejects an unknown handoff rather than guessing from redirectUrl", async () => {
    respond(200, {
      ...OK_BODY,
      handoff: "teleport",
      redirectUrl: "https://example.test/x",
    });

    const result = await createPaymentsCheckout({
      provider: "stripe",
      kind: "currency_pack",
      packName: "starter_pack",
    });

    expect(result).toEqual({ ok: false, code: "failed" });
  });
});

describe("createPaymentsCheckout errors", () => {
  async function checkout() {
    return createPaymentsCheckout({
      provider: "steam",
      kind: "currency_pack",
      packName: "starter_pack",
    });
  }

  it("maps 400 Bad request to client_bug", async () => {
    respond(400, { reason: "Bad request", errors: ["provider: required"] });
    expect(await checkout()).toEqual({ ok: false, code: "client_bug" });
  });

  it("maps 400 Invalid hostname to client_bug", async () => {
    respond(400, { reason: "Invalid hostname" });
    expect(await checkout()).toEqual({ ok: false, code: "client_bug" });
  });

  it("maps 400 soft_pack_not_purchasable to client_bug", async () => {
    respond(400, { reason: "soft_pack_not_purchasable" });
    expect(await checkout()).toEqual({ ok: false, code: "client_bug" });
  });

  it("maps 400 Pack not available to listing_stale", async () => {
    respond(400, { reason: "Pack not available" });
    expect(await checkout()).toEqual({ ok: false, code: "listing_stale" });
  });

  it("maps 400 Tier not available to listing_stale", async () => {
    respond(400, { reason: "Tier not available" });
    expect(await checkout()).toEqual({ ok: false, code: "listing_stale" });
  });

  it("maps 400 listing_not_synced to retry_later", async () => {
    respond(400, { reason: "listing_not_synced" });
    expect(await checkout()).toEqual({ ok: false, code: "retry_later" });
  });

  it("maps 400 kind_unavailable_on_provider with its provider and kind", async () => {
    respond(400, {
      reason: "kind_unavailable_on_provider",
      provider: "steam",
      kind: "custom_currency",
    });
    expect(await checkout()).toEqual({
      ok: false,
      code: "kind_unavailable_on_provider",
      provider: "steam",
      kind: "custom_currency",
    });
  });

  it("maps 400 provider_account_required with its provider", async () => {
    respond(400, { reason: "provider_account_required", provider: "steam" });
    expect(await checkout()).toEqual({
      ok: false,
      code: "provider_account_required",
      provider: "steam",
    });
  });

  it("maps 400 Failed to create checkout to the generic failure", async () => {
    respond(400, { reason: "Failed to create checkout" });
    expect(await checkout()).toEqual({ ok: false, code: "failed" });
  });

  it("maps 401 to unauthorized and clears the session", async () => {
    respond(401, { reason: "Unauthorized" });
    expect(await checkout()).toEqual({ ok: false, code: "unauthorized" });
    expect(logOutMock).toHaveBeenCalledOnce();
  });

  it("maps 409 subscription_exclusivity with the message and existing rail", async () => {
    respond(409, {
      reason: "subscription_exclusivity",
      message: "You already subscribe through Stripe.",
      existingProvider: "stripe",
      existingTier: "supporter",
    });
    expect(
      await createPaymentsCheckout({
        provider: "steam",
        kind: "subscription_tier",
        tierName: "patron",
      }),
    ).toEqual({
      ok: false,
      code: "subscription_exclusivity",
      message: "You already subscribe through Stripe.",
      existingProvider: "stripe",
      existingTier: "supporter",
    });
  });

  it("maps 409 pending_provider_transaction with its provider", async () => {
    respond(409, {
      reason: "pending_provider_transaction",
      provider: "steam",
    });
    expect(await checkout()).toEqual({
      ok: false,
      code: "pending_provider_transaction",
      provider: "steam",
    });
  });

  it("maps 429 to rate_limited and reads Retry-After", async () => {
    respond(429, { reason: "Too many requests" }, { "Retry-After": "42" });
    expect(await checkout()).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 42,
    });
  });

  it("reports a null Retry-After when the header is missing or unparseable", async () => {
    respond(429, { reason: "Too many requests" });
    expect(await checkout()).toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: null,
    });
  });

  it("maps 501 provider_unavailable with its provider", async () => {
    respond(501, { reason: "provider_unavailable", provider: "steam" });
    expect(await checkout()).toEqual({
      ok: false,
      code: "provider_unavailable",
      provider: "steam",
    });
  });

  it("maps 502 provider_error carrying provider, code and retryable", async () => {
    respond(502, {
      reason: "provider_error",
      provider: "steam",
      code: "k_EResultTimeout",
      retryable: true,
    });
    expect(await checkout()).toEqual({
      ok: false,
      code: "provider_error",
      provider: "steam",
      providerCode: "k_EResultTimeout",
      retryable: true,
    });
  });

  it("treats a non-retryable provider_error as non-retryable", async () => {
    respond(502, {
      reason: "provider_error",
      provider: "steam",
      code: "k_EResultInvalidParam",
      retryable: false,
    });
    expect(await checkout()).toMatchObject({
      code: "provider_error",
      retryable: false,
    });
  });

  it("returns the generic failure when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await checkout()).toEqual({ ok: false, code: "failed" });
  });
});

describe("finalizeSteamOrder", () => {
  it("POSTs the internal order id to /payments/steam/finalize", async () => {
    respond(200, { orderId: "1234", resolution: "settled" });

    const result = await finalizeSteamOrder("1234");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openfront.io/payments/steam/finalize");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test",
    );
    expect(JSON.parse(init.body as string)).toEqual({ orderId: "1234" });
    expect(result).toEqual({ ok: true, resolution: "settled" });
  });

  // The 200 body is a RESOLUTION, not a boolean success. All four values are
  // reported to the caller unchanged; collapsing them here would throw away
  // the difference between "captured", "never charged" and "still working".
  it.each(["settled", "expired", "open", "unresolved"] as const)(
    "reports resolution %s verbatim",
    async (resolution) => {
      respond(200, { orderId: "1234", resolution });
      expect(await finalizeSteamOrder("1234")).toEqual({
        ok: true,
        resolution,
      });
    },
  );

  it("treats an unreadable 200 body as a failure to observe, not a resolution", async () => {
    respond(200, { orderId: "1234", resolution: "teleported" });
    expect(await finalizeSteamOrder("1234")).toEqual({
      ok: false,
      code: "failed",
    });
  });

  it("maps 404 (not the caller's order) to not_found", async () => {
    respond(404, { reason: "Not found" });
    expect(await finalizeSteamOrder("1234")).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("maps 401 to unauthorized and clears the session", async () => {
    respond(401, { reason: "Unauthorized" });
    expect(await finalizeSteamOrder("1234")).toEqual({
      ok: false,
      code: "unauthorized",
    });
    expect(logOutMock).toHaveBeenCalledOnce();
  });

  it("returns the generic failure when the request throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(await finalizeSteamOrder("1234")).toEqual({
      ok: false,
      code: "failed",
    });
  });
});
