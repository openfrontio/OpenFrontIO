import type {
  Stripe,
  StripeElements,
  StripeExpressCheckoutElement,
  StripePaymentElement,
} from "@stripe/stripe-js";
// The /pure entry point, deliberately: the default entry injects the Stripe.js
// script tag as a side effect of being imported, which would put js.stripe.com
// on the critical path of every page load. /pure defers it to the first
// loadStripe() call, i.e. to the first time a priced store tile renders.
import { loadStripe } from "@stripe/stripe-js/pure";
import {
  createInlinePaymentIntent,
  paymentsProvider,
  type PurchaseRequest,
} from "./Payments";
import { translateText } from "./Utils";

/**
 * The publishable key baked in at build time, or null when the build has none
 * (dev without a key, tests). Null disables the inline flow entirely; tiles
 * fall back to the redirect flow, which needs no client-side Stripe.
 */
export function stripePublishableKey(): string | null {
  // The build defines this as "" when unset, so empty means "no key" too.
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  return key === undefined || key === "" ? null : key;
}

/**
 * Whether the inline Stripe flow (wallet button on the tile, in-page card
 * form) can run at all: web rail only — the desktop shell buys on Steam and
 * must never reach Stripe — and only in a build that carries a key.
 */
export function stripeInlineAvailable(): boolean {
  return paymentsProvider() === "stripe" && stripePublishableKey() !== null;
}

// One Stripe.js instance per page. A failed load resets the slot so a later
// tile can retry, rather than caching the failure for the session.
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe(): Promise<Stripe | null> {
  const key = stripePublishableKey();
  if (key === null) return Promise.resolve(null);
  stripePromise ??= loadStripe(key).catch((e: unknown) => {
    console.error("getStripe: Stripe.js failed to load", e);
    stripePromise = null;
    return null;
  });
  return stripePromise;
}

/**
 * Where redirect-based payment methods (not wallets or cards, which never
 * leave the page) land afterwards. No `status` param on purpose: the existing
 * #purchase-completed handler classifies a missing status as "pending", which
 * is the honest report — the redirect rail settles asynchronously and the
 * webhook owns the grant.
 */
function inlineReturnUrl(kind: PurchaseRequest["kind"]): string {
  return `${window.location.origin}/#purchase-completed?type=${kind}`;
}

export type InlineConfirmResult =
  // The payment settled on Stripe's side. The entitlement is granted by the
  // payment webhook, not by this client — treat this as "safe to thank the
  // player and refresh the balance", nothing more.
  | { kind: "success" }
  // Confirmed, but the method settles asynchronously. Say "processing", never
  // "failed".
  | { kind: "pending" }
  // The server answered with a redirect handoff; the page is navigating away.
  | { kind: "redirecting" }
  // `message` is ready to display. `refetchCatalog` mirrors PurchaseError's:
  // the server rejected the listing as stale, so the caller must invalidate
  // the cached catalog or every retry re-sends the same dead listing.
  //
  // `stage` says whether stripe.confirmPayment ran. It matters to the wallet
  // button only: the native wallet sheet dismisses itself once confirmPayment
  // runs (even on a decline), but a "checkout"-stage failure leaves it open
  // and spinning, and the caller must call the confirm event's
  // paymentFailed() to release it.
  | {
      kind: "error";
      message: string;
      refetchCatalog?: boolean;
      stage: "checkout" | "payment";
    };

/**
 * One tile's inline checkout: a deferred-mode Elements group that hosts the
 * tile's wallet button and (behind "pay with card") a Payment Element, plus
 * the confirm flow both share.
 *
 * The PaymentIntent is minted lazily on the first confirm — the server prices
 * it from its own catalog; the amount here only seeds the payment sheet — and
 * the client secret is cached for retries of the SAME purchase. update()
 * drops the cache, because a changed purchase (the custom-amount slider) must
 * never confirm an intent minted for the old one.
 */
export class InlineCheckoutSession {
  private clientSecret: string | null = null;

  private constructor(
    private readonly stripe: Stripe,
    readonly elements: StripeElements,
    private request: PurchaseRequest,
    private amountCents: number,
  ) {}

  /** Null when Stripe.js is unavailable (no key, blocked, offline). */
  static async create(
    request: PurchaseRequest,
    amountCents: number,
  ): Promise<InlineCheckoutSession | null> {
    const stripe = await getStripe();
    if (stripe === null) return null;
    const elements = stripe.elements({
      mode: "payment",
      amount: amountCents,
      currency: "usd",
      appearance: { theme: "night" },
    });
    return new InlineCheckoutSession(stripe, elements, request, amountCents);
  }

  /**
   * Wallets only. Link/PayPal/Klarna/Amazon Pay would each add a branded
   * button to every tile; the tile design has room for exactly one wallet
   * button, and the card form already covers everyone else.
   *
   * `emailRequired` makes the wallet sheet expose an email field — wallets
   * do NOT share the buyer's email by default. Set it for accounts with no
   * login email: the purchase email is what lets a guest recover the account
   * (the API attaches it post-fulfillment, as on the redirect flow).
   */
  createExpressCheckoutElement(options: {
    emailRequired: boolean;
  }): StripeExpressCheckoutElement {
    return this.elements.create("expressCheckout", {
      buttonHeight: 44,
      emailRequired: options.emailRequired,
      paymentMethods: {
        link: "never",
        paypal: "never",
        amazonPay: "never",
        klarna: "never",
      },
    });
  }

  createPaymentElement(): StripePaymentElement {
    return this.elements.create("payment");
  }

  update(request: PurchaseRequest, amountCents: number): void {
    this.request = request;
    if (amountCents !== this.amountCents) {
      this.amountCents = amountCents;
      this.elements.update({ amount: amountCents });
    }
    // Always dropped, even when only the request changed: a cached intent was
    // minted for the OLD request and the server will not reprice it.
    this.clientSecret = null;
  }

  /**
   * The whole confirm, shared by the wallet button's `confirm` event and the
   * card form's submit button: validate the collected details, mint (or
   * reuse) the PaymentIntent, confirm it in-page.
   *
   * `receiptEmail` is the buyer email collected inline (the wallet sheet's
   * email field, or the card modal's input) and it rides on the intent as
   * `receipt_email` — first-class on the PaymentIntent so the settlement
   * webhook can attach it to the account without fetching anything extra.
   * The redirect flow got this from Stripe Checkout for free; inline has to
   * carry it explicitly, or a guest's purchase is unrecoverable.
   */
  async confirm(
    options: { receiptEmail?: string | null } = {},
  ): Promise<InlineConfirmResult> {
    // Never throws: both callers route error RESULTS into UI (the wallet
    // sheet's paymentFailed, the card modal's error line) but have no catch —
    // a rejection here would strand a spinning wallet sheet or a silently
    // dead pay button. Stripe.js rejects (rather than resolving {error}) on
    // integration-level failures, e.g. the Elements amount disagreeing with
    // the intent, and the fetch inside minting can reject outright.
    try {
      return await this.confirmInner(options);
    } catch (error) {
      console.error("inline checkout confirm failed", error);
      return {
        kind: "error",
        message: translateText("store.purchase_failed"),
        // "checkout": the payment was never processed, so the wallet sheet
        // is still open and must be failed (a "payment"-stage decline is the
        // one case where Stripe already resolved the sheet itself).
        stage: "checkout",
      };
    }
  }

  private async confirmInner(options: {
    receiptEmail?: string | null;
  }): Promise<InlineConfirmResult> {
    const { error: submitError } = await this.elements.submit();
    if (submitError) {
      // Validation problems ("incomplete card number") carry a message meant
      // for the player; show it rather than a generic failure.
      return {
        kind: "error",
        message: submitError.message ?? translateText("store.checkout_failed"),
        stage: "checkout",
      };
    }

    if (this.clientSecret === null) {
      const minted = await createInlinePaymentIntent(this.request);
      if (minted.kind === "error") {
        return {
          kind: "error",
          message: minted.error.message,
          refetchCatalog: minted.error.refetchCatalog,
          stage: "checkout",
        };
      }
      if (minted.kind === "redirect") {
        // Verbatim, same rule as startPurchase: the URL is the rail's own.
        window.location.href = minted.redirectUrl;
        return { kind: "redirecting" };
      }
      this.clientSecret = minted.clientSecret;
    }

    const { error, paymentIntent } = await this.stripe.confirmPayment({
      elements: this.elements,
      clientSecret: this.clientSecret,
      confirmParams: {
        return_url: inlineReturnUrl(this.request.kind),
        ...(options.receiptEmail
          ? { receipt_email: options.receiptEmail }
          : {}),
      },
      redirect: "if_required",
    });
    if (error) {
      // A decline leaves the PaymentIntent reusable, so the cached secret
      // stays for the retry. Stripe's message is player-facing.
      return {
        kind: "error",
        message: error.message ?? translateText("store.purchase_failed"),
        stage: "payment",
      };
    }
    // The intent is spent (succeeded) or owned by the webhook (processing)
    // either way; the NEXT purchase on this tile must mint a fresh one.
    // Keeping the secret here would replay a settled intent on a repeat buy —
    // a false "purchase successful" at best, a bricked tile at worst.
    this.clientSecret = null;
    // No redirect happened, so there is a PaymentIntent to inspect. Anything
    // not yet "succeeded" (e.g. "processing") settles asynchronously and must
    // be reported as pending, never as failed.
    return paymentIntent?.status === "succeeded"
      ? { kind: "success" }
      : { kind: "pending" };
  }
}
