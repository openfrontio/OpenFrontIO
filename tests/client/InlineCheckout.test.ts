import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/StripeInline", () => ({
  stripeInlineAvailable: vi.fn(() => true),
  InlineCheckoutSession: { create: vi.fn() },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  broadcastFreshUserMe: vi.fn(async () => {}),
  invalidateCosmetics: vi.fn(),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

// The side-effect import is what registers the element; the named import is
// only used in type positions and would be elided on its own.
import "../../src/client/components/InlineCheckout";
import type { InlineCheckout } from "../../src/client/components/InlineCheckout";
import {
  broadcastFreshUserMe,
  invalidateCosmetics,
} from "../../src/client/Cosmetics";
import { showInGameAlert } from "../../src/client/InGameModal";
import {
  InlineCheckoutSession,
  stripeInlineAvailable,
} from "../../src/client/StripeInline";

/** A Stripe element double: records listeners, lets tests fire them. */
function fakeElement() {
  const listeners = new Map<string, (event: unknown) => void>();
  return {
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      listeners.set(type, handler);
    }),
    mount: vi.fn(),
    destroy: vi.fn(),
    fire: (type: string, event: unknown = {}) => listeners.get(type)?.(event),
  };
}

function fakeSession() {
  const express = fakeElement();
  const payment = fakeElement();
  return {
    express,
    payment,
    session: {
      elements: {},
      createExpressCheckoutElement: vi.fn(() => express),
      createPaymentElement: vi.fn(() => payment),
      update: vi.fn(),
      confirm: vi.fn(async () => ({ kind: "success" }) as const),
    },
  };
}

const createMock = InlineCheckoutSession.create as unknown as ReturnType<
  typeof vi.fn
>;
const availableMock = stripeInlineAvailable as unknown as ReturnType<
  typeof vi.fn
>;

async function renderComponent(
  overrides: Partial<InlineCheckout> = {},
): Promise<InlineCheckout> {
  const el = document.createElement("inline-checkout") as InlineCheckout;
  el.request = { kind: "currency_pack", packName: "starter_pack" };
  el.amountCents = 499;
  el.priceLabel = "$4.99";
  el.successMessageKey = "store.currency_pack_purchase_success";
  Object.assign(el, overrides);
  document.body.appendChild(el);
  await el.updateComplete;
  // Session creation resolves a promise chain; let it settle.
  await Promise.resolve();
  await Promise.resolve();
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  availableMock.mockReturnValue(true);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inline-checkout wallet row", () => {
  it("stays collapsed until Stripe reports an available wallet", async () => {
    const { session, express } = fakeSession();
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    const row = el.querySelector("[data-express-checkout]")!;
    expect(row.className).toContain("hidden");

    express.fire("ready", { availablePaymentMethods: { applePay: true } });
    await el.updateComplete;
    expect(row.className).not.toContain("hidden");
  });

  it("stays collapsed when no wallet button will render", async () => {
    const { session, express } = fakeSession();
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    express.fire("ready", { availablePaymentMethods: undefined });
    await el.updateComplete;
    expect(el.querySelector("[data-express-checkout]")!.className).toContain(
      "hidden",
    );
  });

  it("confirms through the session and reports success", async () => {
    const { session, express } = fakeSession();
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    const paymentFailed = vi.fn();
    express.fire("confirm", { paymentFailed });
    await vi.waitFor(() => expect(session.confirm).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "store.currency_pack_purchase_success",
      ),
    );
    expect(broadcastFreshUserMe).toHaveBeenCalled();
    // confirmPayment resolved the wallet sheet; failing it too would be a lie.
    expect(paymentFailed).not.toHaveBeenCalled();
    expect(el.querySelector("button")).toBeTruthy();
  });

  it("shows wallet errors without opening the modal", async () => {
    const { session, express } = fakeSession();
    session.confirm.mockResolvedValue({
      kind: "error",
      message: "Your card was declined.",
      stage: "payment",
    } as never);
    createMock.mockResolvedValue(session);
    await renderComponent();

    const paymentFailed = vi.fn();
    express.fire("confirm", { paymentFailed });
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith("Your card was declined."),
    );
    expect(broadcastFreshUserMe).not.toHaveBeenCalled();
    expect(invalidateCosmetics).not.toHaveBeenCalled();
    // A decline reached confirmPayment, which already resolved the sheet.
    expect(paymentFailed).not.toHaveBeenCalled();
  });

  it("releases the wallet sheet on a pre-confirm failure", async () => {
    const { session, express } = fakeSession();
    session.confirm.mockResolvedValue({
      kind: "error",
      message: "store.checkout_retry_later",
      stage: "checkout",
    } as never);
    createMock.mockResolvedValue(session);
    await renderComponent();

    const paymentFailed = vi.fn();
    express.fire("confirm", { paymentFailed });
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "store.checkout_retry_later",
      ),
    );
    // confirmPayment never ran, so the sheet would spin forever otherwise.
    expect(paymentFailed).toHaveBeenCalled();
  });

  it("invalidates the cached catalog on a stale-listing error", async () => {
    const { session, express } = fakeSession();
    session.confirm.mockResolvedValue({
      kind: "error",
      message: "store.checkout_listing_stale",
      refetchCatalog: true,
      stage: "checkout",
    } as never);
    createMock.mockResolvedValue(session);
    await renderComponent();

    express.fire("confirm", { paymentFailed: vi.fn() });
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "store.checkout_listing_stale",
      ),
    );
    expect(invalidateCosmetics).toHaveBeenCalled();
  });
});

describe("inline-checkout card modal", () => {
  it("opens from the price button, mounts the card form, and pays", async () => {
    const { session, payment } = fakeSession();
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    el.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();
    await vi.waitFor(() => expect(payment.mount).toHaveBeenCalled());
    await el.updateComplete;

    // The pay button is labelled with the literal amount and stays disabled
    // until the card form is ready.
    const buttons = Array.from(document.body.querySelectorAll("button"));
    const pay = buttons.find((b) =>
      b.textContent!.includes("store.pay_amount"),
    )!;
    expect(pay.disabled).toBe(true);

    payment.fire("ready", {});
    await el.updateComplete;
    expect(pay.disabled).toBe(false);

    pay.click();
    await vi.waitFor(() => expect(session.confirm).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(showInGameAlert).toHaveBeenCalledWith(
        "store.currency_pack_purchase_success",
      ),
    );
    // Modal closed and its card form torn down.
    expect(payment.destroy).toHaveBeenCalled();
    expect(document.body.querySelector("[data-payment-element]")).toBeNull();
  });

  it("keeps the modal open and shows the message when the card is declined", async () => {
    const { session, payment } = fakeSession();
    session.confirm.mockResolvedValue({
      kind: "error",
      message: "Your card was declined.",
    } as never);
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    el.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();
    await vi.waitFor(() => expect(payment.mount).toHaveBeenCalled());
    payment.fire("ready", {});
    await el.updateComplete;

    const pay = Array.from(document.body.querySelectorAll("button")).find((b) =>
      b.textContent!.includes("store.pay_amount"),
    )!;
    pay.click();
    await vi.waitFor(() => expect(session.confirm).toHaveBeenCalled());
    await el.updateComplete;

    expect(document.body.textContent).toContain("Your card was declined.");
    expect(document.body.querySelector("[data-payment-element]")).toBeTruthy();
    expect(payment.destroy).not.toHaveBeenCalled();
  });
});

describe("inline-checkout external close", () => {
  // The store modal hides via CSS rather than unmounting, so it closes any
  // open card modal through this public method on its onClose path.
  it("closeCardModal() tears the portaled modal down", async () => {
    const { session, payment } = fakeSession();
    createMock.mockResolvedValue(session);
    const el = await renderComponent();

    el.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();
    await vi.waitFor(() => expect(payment.mount).toHaveBeenCalled());
    expect(document.body.querySelector("[data-payment-element]")).toBeTruthy();

    el.closeCardModal();
    await el.updateComplete;
    expect(payment.destroy).toHaveBeenCalled();
    expect(document.body.querySelector("[data-payment-element]")).toBeNull();
  });
});

describe("inline-checkout fallback", () => {
  it("runs the redirect flow when inline is unavailable", async () => {
    availableMock.mockReturnValue(false);
    const onFallback = vi.fn(async () => {});
    const el = await renderComponent({ onFallback });

    expect(createMock).not.toHaveBeenCalled();
    el.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
  });

  it("falls back when Stripe.js fails to load", async () => {
    createMock.mockResolvedValue(null);
    const onFallback = vi.fn(async () => {});
    const el = await renderComponent({ onFallback });

    el.querySelector<HTMLButtonElement>(".purchase-sparkle-btn")!.click();
    await vi.waitFor(() => expect(onFallback).toHaveBeenCalled());
  });
});
