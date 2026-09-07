import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Payments", () => ({
  createInlinePaymentIntent: vi.fn(),
  paymentsProvider: vi.fn(() => "stripe"),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import { createInlinePaymentIntent } from "../../src/client/Payments";
import { InlineCheckoutSession } from "../../src/client/StripeInline";

const mintMock = createInlinePaymentIntent as unknown as ReturnType<
  typeof vi.fn
>;

const PACK = { kind: "currency_pack", packName: "starter_pack" } as const;

/**
 * The session is built through its private constructor: `create()` goes
 * through loadStripe and the publishable key, which vitest's build defines as
 * empty on purpose. The confirm/caching logic under test is identical either
 * way.
 */
function makeSession() {
  const elements = {
    submit: vi.fn(async () => ({})),
    update: vi.fn(),
  };
  const stripe = {
    confirmPayment: vi.fn(
      async (): Promise<{
        paymentIntent?: { status: string };
        error?: { message: string };
      }> => ({ paymentIntent: { status: "succeeded" } }),
    ),
  };
  const session = new (InlineCheckoutSession as unknown as new (
    ...args: unknown[]
  ) => InlineCheckoutSession)(stripe, elements, PACK, 499);
  return { session, stripe, elements };
}

function mintSecret(secret: string) {
  mintMock.mockResolvedValueOnce({
    kind: "client_secret",
    clientSecret: secret,
  });
}

beforeEach(() => {
  mintMock.mockReset();
});

describe("InlineCheckoutSession secret caching", () => {
  it("mints a FRESH intent for a repeat purchase after a success", async () => {
    const { session } = makeSession();
    mintSecret("pi_1_secret_1");
    expect(await session.confirm()).toEqual({ kind: "success" });

    // Second buy of the same tile: replaying pi_1 would falsely report
    // success (or brick the tile); a new intent must be minted.
    mintSecret("pi_2_secret_2");
    expect(await session.confirm()).toEqual({ kind: "success" });
    expect(mintMock).toHaveBeenCalledTimes(2);
  });

  it("mints a fresh intent after a pending confirm too", async () => {
    const { session, stripe } = makeSession();
    stripe.confirmPayment.mockResolvedValueOnce({
      paymentIntent: { status: "processing" },
    });
    mintSecret("pi_1_secret_1");
    expect(await session.confirm()).toEqual({ kind: "pending" });

    mintSecret("pi_2_secret_2");
    await session.confirm();
    expect(mintMock).toHaveBeenCalledTimes(2);
  });

  it("reuses the intent across retries of a declined confirm", async () => {
    const { session, stripe } = makeSession();
    stripe.confirmPayment.mockResolvedValueOnce({
      error: { message: "Your card was declined." },
    });
    mintSecret("pi_1_secret_1");
    expect(await session.confirm()).toEqual({
      kind: "error",
      message: "Your card was declined.",
      // confirmPayment ran, so the wallet sheet has already been resolved.
      stage: "payment",
    });

    // Retry: same intent, no second checkout call (rate-limited server-side).
    expect(await session.confirm()).toEqual({ kind: "success" });
    expect(mintMock).toHaveBeenCalledTimes(1);
    expect(stripe.confirmPayment).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientSecret: "pi_1_secret_1" }),
    );
  });

  it("drops the cached intent when the purchase changes", async () => {
    const { session, stripe } = makeSession();
    // Decline, so the secret would otherwise stay cached for a retry.
    stripe.confirmPayment.mockResolvedValueOnce({
      error: { message: "Your card was declined." },
    });
    mintSecret("pi_1_secret_1");
    await session.confirm();

    // A changed purchase must never confirm the old intent.
    session.update({ kind: "custom_currency", hardAmount: 200 }, 1000);
    mintSecret("pi_2_secret_2");
    await session.confirm();
    expect(mintMock).toHaveBeenCalledTimes(2);
    expect(stripe.confirmPayment).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientSecret: "pi_2_secret_2" }),
    );
  });

  it("carries refetchCatalog through a minting error", async () => {
    const { session } = makeSession();
    mintMock.mockResolvedValueOnce({
      kind: "error",
      error: {
        outcome: "error",
        message: "store.checkout_listing_stale",
        refetchCatalog: true,
      },
    });
    expect(await session.confirm()).toEqual({
      kind: "error",
      message: "store.checkout_listing_stale",
      refetchCatalog: true,
      // confirmPayment never ran; the wallet caller must release the sheet.
      stage: "checkout",
    });
  });
});
