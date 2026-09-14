import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  createPaymentsCheckout: vi.fn(),
  finalizeSteamOrder: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import type { PaymentsCheckoutResult } from "../../src/client/Api";
import { createPaymentsCheckout } from "../../src/client/Api";
import {
  createInlinePaymentIntent,
  priceStringToCents,
} from "../../src/client/Payments";
import { PaymentsCheckoutResponseSchema } from "../../src/core/ApiSchemas";

const checkoutMock = createPaymentsCheckout as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  checkoutMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// The response schema's inline additions.

describe("PaymentsCheckoutResponseSchema client_secret handoff", () => {
  const base = {
    orderId: "1234",
    provider: "stripe",
    kind: "currency_pack",
    redirectUrl: null,
    expiresAt: null,
  };

  it("defaults clientSecret to null when an older API omits it", () => {
    const parsed = PaymentsCheckoutResponseSchema.parse({
      ...base,
      handoff: "redirect",
      redirectUrl: "https://stripe.example/session",
    });
    expect(parsed.clientSecret).toBeNull();
  });

  it("accepts a client_secret handoff carrying a secret", () => {
    const parsed = PaymentsCheckoutResponseSchema.parse({
      ...base,
      handoff: "client_secret",
      clientSecret: "pi_123_secret_456",
    });
    expect(parsed.handoff).toBe("client_secret");
    expect(parsed.clientSecret).toBe("pi_123_secret_456");
  });

  it("rejects a client_secret handoff without a secret", () => {
    const result = PaymentsCheckoutResponseSchema.safeParse({
      ...base,
      handoff: "client_secret",
      clientSecret: null,
    });
    expect(result.success).toBe(false);
  });

  it("still rejects a redirect handoff without a redirectUrl", () => {
    const result = PaymentsCheckoutResponseSchema.safeParse({
      ...base,
      handoff: "redirect",
      clientSecret: null,
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display price → cents. Strict on purpose: the amount seeds Stripe's payment
// sheet, and an unrecognised format must yield "no inline checkout", never a
// guessed number.

describe("priceStringToCents", () => {
  it.each([
    ["$4.99", 499],
    ["$5", 500],
    ["$0.99", 99],
    ["$100.00", 10000],
    [" $12.50 ", 1250],
  ])("parses %s to %d", (price, cents) => {
    expect(priceStringToCents(price)).toBe(cents);
  });

  it.each([
    "4.99", // no currency marker — could be anything
    "€4.99", // not dollars
    "$4.9", // not a cents pair
    "$4.999",
    "$1,000.00", // grouping unsupported; be strict rather than clever
    "$",
    "",
    "USD 4.99",
  ])("rejects %j", (price) => {
    expect(priceStringToCents(price)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Minting the inline intent.

const PACK = { kind: "currency_pack", packName: "starter_pack" } as const;

function ok(data: Record<string, unknown>): PaymentsCheckoutResult {
  return {
    ok: true,
    data: {
      orderId: "1234",
      provider: "stripe",
      kind: "currency_pack",
      redirectUrl: null,
      clientSecret: null,
      expiresAt: null,
      ...data,
    },
  } as PaymentsCheckoutResult;
}

describe("createInlinePaymentIntent", () => {
  it("asks for the stripe rail and offers both handoffs", async () => {
    checkoutMock.mockResolvedValue(
      ok({ handoff: "client_secret", clientSecret: "pi_1_secret_2" }),
    );
    await createInlinePaymentIntent(PACK);
    expect(checkoutMock).toHaveBeenCalledWith({
      provider: "stripe",
      handoffs: ["redirect", "client_secret"],
      ...PACK,
    });
  });

  it("returns the client secret on a client_secret handoff", async () => {
    checkoutMock.mockResolvedValue(
      ok({ handoff: "client_secret", clientSecret: "pi_1_secret_2" }),
    );
    expect(await createInlinePaymentIntent(PACK)).toEqual({
      kind: "client_secret",
      clientSecret: "pi_1_secret_2",
    });
  });

  it("degrades to the redirect flow when the server answers redirect", async () => {
    checkoutMock.mockResolvedValue(
      ok({ handoff: "redirect", redirectUrl: "https://stripe.example/s" }),
    );
    expect(await createInlinePaymentIntent(PACK)).toEqual({
      kind: "redirect",
      redirectUrl: "https://stripe.example/s",
    });
  });

  it("maps checkout failures through the shared error taxonomy", async () => {
    checkoutMock.mockResolvedValue({ ok: false, code: "listing_stale" });
    const result = await createInlinePaymentIntent(PACK);
    expect(result).toEqual({
      kind: "error",
      error: {
        outcome: "error",
        message: "store.checkout_listing_stale",
        refetchCatalog: true,
      },
    });
  });

  it("treats a client_overlay handoff on the stripe rail as an error", async () => {
    checkoutMock.mockResolvedValue(ok({ handoff: "client_overlay" }));
    const result = await createInlinePaymentIntent(PACK);
    expect(result).toEqual({
      kind: "error",
      error: {
        outcome: "error",
        message: "store.checkout_failed",
        refetchCatalog: false,
      },
    });
  });
});
