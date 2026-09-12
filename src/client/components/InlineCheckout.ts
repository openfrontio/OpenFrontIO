import type {
  StripeExpressCheckoutElement,
  StripeExpressCheckoutElementConfirmEvent,
  StripePaymentElement,
} from "@stripe/stripe-js";
import type { PropertyValues, TemplateResult } from "lit";
import { html, LitElement, render as litRender, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getUserMe, invalidateUserMe } from "../Api";
import { broadcastFreshUserMe, invalidateCosmetics } from "../Cosmetics";
import { showInGameAlert } from "../InGameModal";
import type { PurchaseRequest } from "../Payments";
import {
  InlineCheckoutSession,
  stripeInlineAvailable,
  type InlineConfirmResult,
} from "../StripeInline";
import { translateText } from "../Utils";

/**
 * The webhook grants the entitlement, so the balance read immediately after a
 * success can still be the old one. One delayed re-read covers the ordinary
 * webhook lag; anything slower is what store.purchase_pending's "check your
 * order history" is for.
 */
const BALANCE_RECHECK_MS = 2500;

/** What a tile hands purchase-button to put its dollar line inline. */
export interface InlineCheckoutConfig {
  request: PurchaseRequest;
  /** Seeds Stripe's payment sheet; the server prices the real intent. */
  amountCents: number;
  successMessageKey: string;
}

/**
 * One store tile's dollar line, inline edition: a wallet button (Apple Pay /
 * Google Pay, rendered by Stripe's Express Checkout Element) above a price
 * button that opens an in-page card form. Nothing here navigates — the tile
 * IS the checkout.
 *
 * The wallet button is browser-dependent and renders nothing at all where no
 * wallet is available (desktop Firefox, most notably), so the price button is
 * the load-bearing path and the tile's vertical rhythm never depends on the
 * wallet row.
 *
 * Where the inline flow can't run at all — Steam rail, keyless build,
 * Stripe.js blocked — the price button runs `onFallback`, the pre-existing
 * redirect checkout, so this component never renders a dead button.
 */
@customElement("inline-checkout")
export class InlineCheckout extends LitElement {
  @property({ type: Object }) request: PurchaseRequest | null = null;
  /** Seeds Stripe's payment sheet; the server prices the real intent. */
  @property({ type: Number }) amountCents = 0;
  /** Display price, e.g. "$4.99". Labels the price and pay buttons. */
  @property({ type: String }) priceLabel = "";
  @property({ type: String }) successMessageKey = "";
  /** The redirect-flow purchase used when inline can't run. */
  @property({ type: Function }) onFallback?: () => Promise<unknown>;

  @state() private walletVisible = false;
  @state() private modalOpen = false;
  /** True while any confirm is in flight — wallet or card. One at a time. */
  @state() private confirming = false;
  @state() private cardReady = false;
  @state() private modalError: string | null = null;
  @state() private fallbackBusy = false;
  /** Whether the card modal must collect a buyer email (guest account). */
  @state() private emailRequired = false;
  @state() private emailValue = "";

  private session: InlineCheckoutSession | null = null;
  private sessionPromise: Promise<InlineCheckoutSession | null> | null = null;
  private expressElement: StripeExpressCheckoutElement | null = null;
  private paymentElement: StripePaymentElement | null = null;
  /** The card modal portals to <body>: the store modal clips/stacks its own
   * subtree, same reason ConfirmDialog portals. */
  private portal: HTMLDivElement | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.portal = document.createElement("div");
    document.body.appendChild(this.portal);
  }

  disconnectedCallback() {
    this.expressElement?.destroy();
    this.expressElement = null;
    this.destroyPaymentElement();
    this.session = null;
    this.sessionPromise = null;
    this.walletVisible = false;
    this.modalOpen = false;
    if (this.portal) {
      litRender(html``, this.portal);
      this.portal.remove();
      this.portal = null;
    }
    super.disconnectedCallback();
  }

  private ensureSession(): Promise<InlineCheckoutSession | null> {
    if (this.request === null || !stripeInlineAvailable()) {
      return Promise.resolve(null);
    }
    this.sessionPromise ??= InlineCheckoutSession.create(
      this.request,
      this.amountCents,
    )
      .then((session) => {
        if (session === null) {
          // A transient Stripe.js load failure must not disable this tile for
          // the session — drop the memo so the next interaction retries, same
          // as getStripe() does with its own promise.
          this.sessionPromise = null;
          return null;
        }
        this.session = session;
        // Props may have moved while Stripe.js loaded (the custom-amount
        // slider); sync before anything confirms against the session.
        this.syncSession();
        return session;
      })
      .catch((e: unknown) => {
        // stripe.elements() throws synchronously on inputs it rejects (a
        // zero amount, say), which rejects create()'s promise — and a
        // rejected memo would otherwise stick forever AND surface as an
        // unhandled rejection in both void-ing callers. Resolve to null
        // instead: the price button falls back to the redirect flow, and the
        // dropped memo lets a later interaction retry.
        console.error("inline-checkout: session creation failed", e);
        this.sessionPromise = null;
        return null;
      });
    return this.sessionPromise;
  }

  /** JSON of the last (request, amountCents) pushed into the session. Keyed
   * by VALUE, not prop identity: callers rebuild the request object every
   * render, and pushing an unchanged purchase into the session would drop its
   * cached PaymentIntent each time (see InlineCheckoutSession.update). */
  private syncedKey: string | null = null;

  private syncSession(): void {
    if (this.session === null || this.request === null) return;
    const key = JSON.stringify([this.request, this.amountCents]);
    if (key === this.syncedKey) return;
    this.syncedKey = key;
    this.session.update(this.request, this.amountCents);
  }

  protected firstUpdated() {
    void this.initWallet();
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has("request") || changed.has("amountCents")) {
      this.syncSession();
    }
  }

  /**
   * Whether this purchase must collect a buyer email: the account has no
   * login email, so the purchase email is the only thing that makes the
   * purchase recoverable (the API attaches it post-fulfillment, exactly as
   * the redirect flow did via Stripe Checkout's email field). Accounts that
   * already have one are never asked again — re-collecting risks attaching
   * a second, different address.
   */
  private async needsEmail(): Promise<boolean> {
    const me = await getUserMe();
    // A Google login carries its own email (user.google.email, never the
    // top-level field) and already makes the account recoverable — asking
    // again would collect a second, different address on every purchase.
    //
    // `me === false` is NOT "guest": getUserMe collapses signed-out and any
    // transient /users/@me failure into the same false (memoized for the
    // session, except timeouts), and a signed-in buyer can still purchase
    // through it — checkout auth rides the JWT, not this call. An actual
    // guest session gets a 200 with an empty user object. So only a real
    // response saying "no login email" may ask; on "couldn't tell", don't
    // collect — asking a linked account for an email is the failure mode
    // this function exists to prevent (and the API refuses that attach
    // anyway), while a guest purchase without receipt_email merely skips
    // the recovery attach for that one purchase.
    return me !== false && !me.user.email && !me.user.google;
  }

  private async initWallet(): Promise<void> {
    const [session, emailRequired] = await Promise.all([
      this.ensureSession(),
      this.needsEmail(),
    ]);
    if (session === null || this.expressElement !== null) return;
    const container = this.querySelector("[data-express-checkout]");
    if (container === null || !this.isConnected) return;
    const element = session.createExpressCheckoutElement({ emailRequired });
    element.on("ready", ({ availablePaymentMethods }) => {
      // undefined means no wallet button rendered; keep the row collapsed so
      // the tile looks intentional rather than missing something.
      this.walletVisible = availablePaymentMethods !== undefined;
    });
    element.on("confirm", (event) => void this.confirmWallet(event));
    element.mount(container as HTMLElement);
    this.expressElement = element;
  }

  private async confirmWallet(
    event: StripeExpressCheckoutElementConfirmEvent,
  ): Promise<void> {
    // The native wallet sheet is open and waiting: it only dismisses itself
    // once stripe.confirmPayment runs, so EVERY path out of here that never
    // gets there must call event.paymentFailed() or the sheet spins forever
    // over an alert it hides.
    if (this.session === null || this.confirming) {
      event.paymentFailed({ reason: "fail" });
      return;
    }
    this.confirming = true;
    try {
      // The wallet sheet's email field (present when the account has none)
      // arrives on the confirm event; ride it on the intent so the webhook
      // can attach it to the account.
      const result = await this.session.confirm({
        receiptEmail: event.billingDetails?.email ?? null,
      });
      if (result.kind === "error") {
        // "payment"-stage errors (a decline) already resolved the sheet.
        if (result.stage === "checkout")
          event.paymentFailed({ reason: "fail" });
        // The catalog this tile rendered from named something the rail no
        // longer sells; drop it so the next open refetches — same rule as
        // the redirect flow in Cosmetics.ts.
        if (result.refetchCatalog) invalidateCosmetics();
        await showInGameAlert(result.message);
        return;
      }
      if (result.kind === "redirecting") {
        // Navigation to the rail is in flight; release the sheet rather than
        // leave it spinning for however long the navigation takes.
        event.paymentFailed({ reason: "fail" });
        return;
      }
      await this.settle(result);
    } finally {
      this.confirming = false;
    }
  }

  private async openCardModal(): Promise<void> {
    const [session, emailRequired] = await Promise.all([
      this.ensureSession(),
      this.needsEmail(),
    ]);
    if (session === null) {
      // Stripe.js became unavailable between render and click (blocked,
      // offline). The redirect flow still works; use it.
      await this.runFallback();
      return;
    }
    this.emailRequired = emailRequired;
    this.modalOpen = true;
    this.modalError = null;
    this.cardReady = false;
    await this.updateComplete;
    const container = this.portal?.querySelector("[data-payment-element]");
    if (!container || this.paymentElement !== null) return;
    const element = session.createPaymentElement();
    element.on("ready", () => {
      this.cardReady = true;
    });
    element.mount(container as HTMLElement);
    this.paymentElement = element;
  }

  private destroyPaymentElement(): void {
    this.paymentElement?.destroy();
    this.paymentElement = null;
    this.cardReady = false;
  }

  /**
   * Public because StoreModal.onClose() calls it: the store is an inline
   * modal that hides via CSS rather than unmounting, so disconnectedCallback
   * never fires and an open card modal (portaled to <body>) would outlive
   * the store. No-op mid-confirm — the modal finishes its flow and remains
   * interactively closable either way.
   */
  closeCardModal(): void {
    // Never mid-confirm: tearing the form down under an in-flight
    // confirmPayment is how "did I get charged?" emails happen. The close
    // button is disabled while confirming; this guards the backdrop too.
    if (this.confirming) return;
    this.modalOpen = false;
    this.modalError = null;
    this.destroyPaymentElement();
  }

  /** Loose on purpose — Stripe and the server both validate; this only
   * gates the pay button so a guest can't submit with no address at all. */
  private emailLooksValid(): boolean {
    return /^\S+@\S+\.\S+$/.test(this.emailValue.trim());
  }

  private async confirmCard(): Promise<void> {
    if (this.session === null || this.confirming || !this.cardReady) return;
    if (this.emailRequired && !this.emailLooksValid()) return;
    this.confirming = true;
    this.modalError = null;
    try {
      const result = await this.session.confirm({
        receiptEmail: this.emailRequired ? this.emailValue.trim() : null,
      });
      if (result.kind === "error") {
        if (result.refetchCatalog) invalidateCosmetics();
        this.modalError = result.message;
        return;
      }
      this.modalOpen = false;
      this.destroyPaymentElement();
      await this.settle(result);
    } finally {
      this.confirming = false;
    }
  }

  /** Everything after a confirm that didn't error: UI only — the webhook owns
   * the grant, this just tells the player and re-reads the balance. */
  private async settle(
    result: Exclude<InlineConfirmResult, { kind: "error" }>,
  ): Promise<void> {
    if (result.kind === "redirecting") return; // page is navigating away
    if (result.kind === "success") {
      // Reload, same as the plutonium purchases in Cosmetics.ts: the grant —
      // and, for a guest, the login email the webhook just attached — touches
      // state all over the page (balance, account button, store tiles), and a
      // fresh load picks all of it up rather than chasing every consumer. The
      // alert is awaited first, which also gives the webhook a human-scale
      // head start.
      await showInGameAlert(translateText(this.successMessageKey));
      invalidateUserMe();
      window.location.reload();
      return;
    }
    // Pending: the webhook hasn't settled yet, so a reload would show nothing
    // new — soft-refresh the profile now and again shortly.
    void broadcastFreshUserMe();
    setTimeout(() => void broadcastFreshUserMe(), BALANCE_RECHECK_MS);
    await showInGameAlert(translateText("store.purchase_pending"));
  }

  private async runFallback(): Promise<void> {
    if (!this.onFallback || this.fallbackBusy) return;
    this.fallbackBusy = true;
    try {
      await this.onFallback();
    } catch (e) {
      console.error("inline-checkout fallback failed", e);
      await showInGameAlert(translateText("store.checkout_failed"));
    } finally {
      this.fallbackBusy = false;
    }
  }

  private onPriceClick(e: Event): void {
    e.stopPropagation();
    if (stripeInlineAvailable()) {
      void this.openCardModal();
    } else {
      void this.runFallback();
    }
  }

  render() {
    if (this.portal) {
      litRender(this.modalOpen ? this.renderModal() : html``, this.portal);
    }
    // The price lives in the tile itself (under the plutonium label), so the
    // controls here only say HOW to pay. With a wallet button rendered, the
    // card path shrinks to a small link beneath it; without one, the card
    // path IS the buy button. The keyless/blocked fallback keeps the price
    // on the button — it redirects to hosted Checkout, where the payment
    // method is Stripe's business, not "card".
    const label = stripeInlineAvailable()
      ? translateText("store.pay_with_card")
      : this.priceLabel;
    return html`
      <div class="flex w-full flex-col gap-1">
        <div
          data-express-checkout
          class=${this.walletVisible ? "w-full" : "hidden"}
        ></div>
        ${this.walletVisible
          ? html`<button
              data-pay-with-card
              class="w-full border-0 bg-transparent py-1 text-center text-xs font-semibold text-blue-300 underline underline-offset-2 cursor-pointer transition-colors duration-200 hover:text-white disabled:opacity-50"
              ?disabled=${this.fallbackBusy || this.confirming}
              @click=${(e: Event) => this.onPriceClick(e)}
            >
              ${translateText("store.pay_with_card")}
            </button>`
          : html`<button
              class="purchase-sparkle-btn relative overflow-hidden w-full min-h-11 px-2 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center
               hover:bg-blue-600 hover:border-blue-400 hover:text-white hover:shadow-[0_0_20px_rgba(96,165,250,0.6)] disabled:opacity-50"
              ?disabled=${this.fallbackBusy || this.confirming}
              @click=${(e: Event) => this.onPriceClick(e)}
            >
              <span class="purchase-sparkle-streak"></span>
              ${label}
            </button>`}
      </div>
    `;
  }

  private renderModal(): TemplateResult {
    return html`
      <div
        class="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80"
        @click=${(e: Event) => {
          if (e.target === e.currentTarget) this.closeCardModal();
        }}
      >
        <div
          class="relative mx-4 max-h-[85vh] w-full max-w-sm overflow-y-auto p-6 rounded-2xl border border-white/15 bg-surface shadow-2xl"
        >
          <button
            @click=${() => this.closeCardModal()}
            ?disabled=${this.confirming}
            aria-label=${translateText("common.close")}
            class="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-lg text-xl leading-none text-white/50 hover:bg-white/10 hover:text-white transition-all disabled:opacity-30"
          >
            ×
          </button>
          <h2 class="text-lg font-bold text-white mb-4 pr-8">
            ${translateText("store.pay_with_card")}
          </h2>
          ${this.emailRequired
            ? html`<label
                  class="mb-1 block text-xs font-medium text-white/70"
                  for="inline-checkout-email"
                  >${translateText("store.card_email_label")}</label
                >
                <input
                  id="inline-checkout-email"
                  data-checkout-email
                  type="email"
                  autocomplete="email"
                  .value=${this.emailValue}
                  ?disabled=${this.confirming}
                  @input=${(e: Event) => {
                    this.emailValue = (e.target as HTMLInputElement).value;
                  }}
                  class="mb-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                />
                <p class="mb-3 text-xs text-white/50">
                  ${translateText("store.card_email_hint")}
                </p>`
            : nothing}
          <div data-payment-element class="mb-4 min-h-[6rem]"></div>
          ${this.modalError !== null
            ? html`<p class="mb-4 text-sm font-medium text-red-300">
                ${this.modalError}
              </p>`
            : nothing}
          <button
            @click=${() => void this.confirmCard()}
            ?disabled=${this.confirming ||
            !this.cardReady ||
            (this.emailRequired && !this.emailLooksValid())}
            class="w-full min-h-11 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-base font-bold hover:bg-blue-700 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
          >
            ${this.confirming
              ? html`<span
                  class="inline-block h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                ></span>`
              : nothing}
            ${translateText("store.pay_amount", { amount: this.priceLabel })}
          </button>
        </div>
      </div>
    `;
  }
}
