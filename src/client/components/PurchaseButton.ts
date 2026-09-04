import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import type { InsufficientCurrency, PurchaseResult } from "../Cosmetics";
import { showInGameAlert } from "../InGameModal";
import { translateText } from "../Utils";
import "./CapIcon";
import "./ConfirmDialog";
import "./InsufficientCurrencyDialog";
import "./PlutoniumIcon";

const PURCHASE_STYLE_ID = "purchase-button-styles";
if (!document.getElementById(PURCHASE_STYLE_ID)) {
  const style = document.createElement("style");
  style.id = PURCHASE_STYLE_ID;
  style.textContent = `
    @keyframes purchase-streak {
      0%   { left: -60%; opacity: 0; }
      10%  { opacity: 1; }
      90%  { opacity: 1; }
      100% { left: 160%; opacity: 0; }
    }
    .purchase-sparkle-streak {
      pointer-events: none;
      position: absolute;
      top: 0;
      left: -60%;
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, transparent 0%, rgba(147,197,253,0.5) 50%, transparent 100%);
      transform: skewX(-15deg);
      opacity: 0;
    }
    .purchase-btn-wrap:hover .purchase-sparkle-streak,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-sparkle-streak {
      animation: purchase-streak 0.7s ease-in-out;
    }
    .purchase-btn-wrap:hover .purchase-sparkle-btn,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-sparkle-btn {
      background: rgb(37,99,235);
      border-color: rgb(96,165,250);
      color: white;
      box-shadow: 0 0 20px rgba(96,165,250,0.6);
    }
    .purchase-btn-wrap:hover .purchase-sparkle-btn-hard,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-sparkle-btn-hard {
      background: rgb(29,78,216);
      border-color: rgb(96,165,250);
      color: white;
      box-shadow: 0 0 20px rgba(96,165,250,0.6);
    }
    .purchase-btn-wrap:hover .purchase-sparkle-btn-soft,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-sparkle-btn-soft {
      background: rgb(180,83,9);
      border-color: rgb(217,119,6);
      color: white;
      box-shadow: 0 0 20px rgba(217,119,6,0.6);
    }
    @keyframes purchase-pulse {
      0%   { box-shadow: 0 0 15px rgba(96,165,250,0.6), 0 0 30px rgba(37,99,235,0.3); }
      50%  { box-shadow: 0 0 25px rgba(96,165,250,0.9), 0 0 50px rgba(37,99,235,0.5); }
      100% { box-shadow: 0 0 15px rgba(96,165,250,0.6), 0 0 30px rgba(37,99,235,0.3); }
    }
    .purchase-sparkle-btn:hover {
      background: rgb(29,78,216) !important;
      border-color: rgb(96,165,250) !important;
      color: white !important;
      animation: purchase-pulse 1.2s ease-in-out infinite !important;
    }
    .purchase-sparkle-btn-hard:hover {
      background: rgb(29,78,216) !important;
      border-color: rgb(96,165,250) !important;
      color: white !important;
      animation: purchase-pulse 1.2s ease-in-out infinite !important;
    }
    @keyframes purchase-pulse-soft {
      0%   { box-shadow: 0 0 15px rgba(217,119,6,0.6), 0 0 30px rgba(180,83,9,0.3); }
      50%  { box-shadow: 0 0 25px rgba(217,119,6,0.9), 0 0 50px rgba(180,83,9,0.5); }
      100% { box-shadow: 0 0 15px rgba(217,119,6,0.6), 0 0 30px rgba(180,83,9,0.3); }
    }
    .purchase-sparkle-btn-soft:hover {
      background: rgb(180,83,9) !important;
      border-color: rgb(217,119,6) !important;
      color: white !important;
      animation: purchase-pulse-soft 1.2s ease-in-out infinite !important;
    }
    @keyframes purchase-ember-0 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-35px) translateX(5px) scale(0.2); opacity: 0; }
    }
    @keyframes purchase-ember-1 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-30px) translateX(-6px) scale(0.3); opacity: 0; }
    }
    @keyframes purchase-ember-2 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-40px) translateX(3px) scale(0.2); opacity: 0; }
    }
    @keyframes purchase-ember-3 {
      0%   { transform: translateY(0) translateX(0) scale(1); opacity: 0.9; }
      100% { transform: translateY(-28px) translateX(-4px) scale(0.3); opacity: 0; }
    }
    .purchase-ember {
      pointer-events: none;
      position: absolute;
      top: var(--purchase-particle-top, 0px);
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: rgba(96,165,250,0.9);
      box-shadow: 0 0 4px rgba(96,165,250,0.8);
      opacity: 0;
      display: none;
    }
    .purchase-ember-0 { left: 20%; animation: purchase-ember-0 1.2s ease-out infinite; }
    .purchase-ember-1 { left: 40%; animation: purchase-ember-1 1.5s ease-out infinite 0.25s; }
    .purchase-ember-2 { left: 60%; animation: purchase-ember-2 1.3s ease-out infinite 0.5s; }
    .purchase-ember-3 { left: 80%; animation: purchase-ember-3 1.6s ease-out infinite 0.15s; }
    .purchase-btn-wrap:hover .purchase-ember,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-ember {
      display: block;
    }
    @keyframes purchase-burst-a { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-70px) translateX(14px) scale(0); opacity:0; } }
    @keyframes purchase-burst-b { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-60px) translateX(-12px) scale(0); opacity:0; } }
    @keyframes purchase-burst-c { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-80px) translateX(8px) scale(0); opacity:0; } }
    @keyframes purchase-burst-d { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-55px) translateX(-16px) scale(0); opacity:0; } }
    @keyframes purchase-burst-e { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-75px) translateX(18px) scale(0); opacity:0; } }
    @keyframes purchase-burst-f { 0% { transform: translateY(0) translateX(0) scale(1.2); opacity:1; } 100% { transform: translateY(-65px) translateX(-6px) scale(0); opacity:0; } }
    .purchase-burst {
      pointer-events: none;
      position: absolute;
      top: var(--purchase-particle-top, 0px);
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: rgba(96,165,250,1);
      box-shadow: 0 0 6px rgba(96,165,250,0.9), 0 0 2px rgba(255,255,255,0.5);
      opacity: 0;
      display: none;
    }
    .purchase-burst-0  { left: 3%;  animation: purchase-burst-a 0.9s  ease-out infinite 0.00s; }
    .purchase-burst-1  { left: 8%;  animation: purchase-burst-d 1.1s  ease-out infinite 0.73s; }
    .purchase-burst-2  { left: 12%; animation: purchase-burst-c 0.95s ease-out infinite 0.41s; }
    .purchase-burst-3  { left: 16%; animation: purchase-burst-f 1.05s ease-out infinite 0.17s; }
    .purchase-burst-4  { left: 20%; animation: purchase-burst-b 0.85s ease-out infinite 0.89s; }
    .purchase-burst-5  { left: 24%; animation: purchase-burst-e 1.0s  ease-out infinite 0.53s; }
    .purchase-burst-6  { left: 28%; animation: purchase-burst-a 1.1s  ease-out infinite 0.29s; }
    .purchase-burst-7  { left: 32%; animation: purchase-burst-c 0.9s  ease-out infinite 0.97s; }
    .purchase-burst-8  { left: 36%; animation: purchase-burst-f 1.05s ease-out infinite 0.61s; }
    .purchase-burst-9  { left: 40%; animation: purchase-burst-d 0.95s ease-out infinite 0.07s; }
    .purchase-burst-10 { left: 44%; animation: purchase-burst-b 1.0s  ease-out infinite 0.83s; }
    .purchase-burst-11 { left: 48%; animation: purchase-burst-e 0.85s ease-out infinite 0.37s; }
    .purchase-burst-12 { left: 52%; animation: purchase-burst-a 1.1s  ease-out infinite 0.67s; }
    .purchase-burst-13 { left: 56%; animation: purchase-burst-f 0.9s  ease-out infinite 0.11s; }
    .purchase-burst-14 { left: 60%; animation: purchase-burst-c 1.05s ease-out infinite 0.79s; }
    .purchase-burst-15 { left: 64%; animation: purchase-burst-d 0.95s ease-out infinite 0.47s; }
    .purchase-burst-16 { left: 68%; animation: purchase-burst-b 1.0s  ease-out infinite 0.23s; }
    .purchase-burst-17 { left: 72%; animation: purchase-burst-e 0.85s ease-out infinite 1.03s; }
    .purchase-burst-18 { left: 76%; animation: purchase-burst-a 1.1s  ease-out infinite 0.57s; }
    .purchase-burst-19 { left: 80%; animation: purchase-burst-f 0.95s ease-out infinite 0.31s; }
    .purchase-burst-20 { left: 6%;  animation: purchase-burst-b 0.92s ease-out infinite 0.15s; }
    .purchase-burst-21 { left: 14%; animation: purchase-burst-e 1.08s ease-out infinite 0.86s; }
    .purchase-burst-22 { left: 22%; animation: purchase-burst-a 0.88s ease-out infinite 0.44s; }
    .purchase-burst-23 { left: 30%; animation: purchase-burst-d 1.02s ease-out infinite 0.71s; }
    .purchase-burst-24 { left: 38%; animation: purchase-burst-f 0.93s ease-out infinite 0.03s; }
    .purchase-burst-25 { left: 46%; animation: purchase-burst-c 1.07s ease-out infinite 0.59s; }
    .purchase-burst-26 { left: 54%; animation: purchase-burst-b 0.87s ease-out infinite 0.92s; }
    .purchase-burst-27 { left: 62%; animation: purchase-burst-e 0.98s ease-out infinite 0.26s; }
    .purchase-burst-28 { left: 70%; animation: purchase-burst-a 1.12s ease-out infinite 0.64s; }
    .purchase-burst-29 { left: 78%; animation: purchase-burst-d 0.91s ease-out infinite 0.38s; }
    .purchase-burst-30 { left: 84%; animation: purchase-burst-c 1.03s ease-out infinite 0.77s; }
    .purchase-burst-31 { left: 88%; animation: purchase-burst-f 0.86s ease-out infinite 0.09s; }
    .purchase-burst-32 { left: 92%; animation: purchase-burst-b 1.06s ease-out infinite 0.52s; }
    .purchase-burst-33 { left: 96%; animation: purchase-burst-e 0.94s ease-out infinite 0.81s; }
    .purchase-burst-34 { left: 10%; animation: purchase-burst-d 0.89s ease-out infinite 0.34s; }
    .purchase-burst-35 { left: 26%; animation: purchase-burst-a 1.04s ease-out infinite 0.96s; }
    .purchase-burst-36 { left: 42%; animation: purchase-burst-f 0.91s ease-out infinite 0.19s; }
    .purchase-burst-37 { left: 58%; animation: purchase-burst-c 1.09s ease-out infinite 0.69s; }
    .purchase-burst-38 { left: 74%; animation: purchase-burst-b 0.87s ease-out infinite 0.46s; }
    .purchase-burst-39 { left: 90%; animation: purchase-burst-e 1.01s ease-out infinite 0.13s; }
    .purchase-btn-wrap:hover .purchase-burst,
    [data-cosmetic-shell]:hover .purchase-btn-wrap .purchase-burst {
      display: block;
    }
    @keyframes cosmetic-spin {
      0%   { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .cosmetic-loading-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.6);
      border-radius: 0.75rem;
      z-index: 20;
    }
    .cosmetic-loading-spinner {
      width: 40px;
      height: 40px;
      border: 4px solid rgba(255,255,255,0.2);
      border-top-color: rgb(96,165,250);
      border-radius: 50%;
      animation: cosmetic-spin 0.8s linear infinite;
    }
  `;
  document.head.appendChild(style);
}

@customElement("purchase-button")
export class PurchaseButton extends LitElement {
  @property({ type: Object })
  product: Product | null = null;

  /** Price shown for a direct dollar checkout without a catalog product. */
  @property({ type: String })
  dollarPrice: string = "";

  @property({ type: Number })
  priceHard: number | null = null;

  @property({ type: Number })
  priceSoft: number | null = null;

  @property({ type: String })
  rarity: string = "common";

  /** Optional action-label key shown before the price (e.g. "Switch"). Empty
   * shows the price on its own. */
  @property({ type: String })
  dollarLabelKey: string = "";

  /** Optional suffix appended to the displayed price, e.g. "/mo". Not translated here. */
  @property({ type: String })
  priceSuffix: string = "";

  /** Display name of the item, used in the currency confirmation dialog. */
  @property({ type: String })
  itemName: string = "";

  /**
   * Keep an empty line where this payment method's button would go. Set by
   * grids where sibling cards do offer the method, so the same currency lands
   * on the same line across the row.
   */
  @property({ type: Boolean })
  reserveDollar = false;

  @property({ type: Boolean })
  reserveHard = false;

  @property({ type: Boolean })
  reserveSoft = false;

  @property({ type: Function })
  onPurchaseDollar?: () => Promise<PurchaseResult>;

  @property({ type: Function })
  onPurchaseHard?: () => Promise<PurchaseResult>;

  @property({ type: Function })
  onPurchaseSoft?: () => Promise<PurchaseResult>;

  /** Set when a purchase fails for lack of funds; drives the dialog. */
  @state() private insufficient: InsufficientCurrency | null = null;
  /** Currency purchase snapshot awaiting confirmation, if any. */
  @state() private confirmingPurchase: {
    method: "hard" | "soft";
    amount: number;
    itemName: string;
    handler: () => Promise<PurchaseResult>;
  } | null = null;
  @state() private busy = false;

  createRenderRoot() {
    return this;
  }

  get offersDollar(): boolean {
    return Boolean((this.product ?? this.dollarPrice) && this.onPurchaseDollar);
  }

  get offersHard(): boolean {
    return this.priceHard !== null && this.onPurchaseHard !== undefined;
  }

  get offersSoft(): boolean {
    return this.priceSoft !== null && this.onPurchaseSoft !== undefined;
  }

  private handleClick(e: Event, handler?: () => Promise<PurchaseResult>) {
    e.stopPropagation();
    this.executePurchase(handler);
  }

  /** Opens the currency confirmation dialog; the purchase runs on confirm. */
  requestCurrencyPurchase(method: "hard" | "soft") {
    const handler =
      method === "hard" ? this.onPurchaseHard : this.onPurchaseSoft;
    if (!handler || this.busy) return;
    this.confirmingPurchase = {
      method,
      amount: (method === "hard" ? this.priceHard : this.priceSoft) ?? 0,
      itemName: this.itemName,
      handler,
    };
  }

  private executePurchase(handler?: () => Promise<PurchaseResult>) {
    if (!handler || this.busy) return;
    this.busy = true;
    void Promise.resolve()
      .then(() => handler())
      .then((result) => {
        if (result) this.insufficient = result;
      })
      .catch((error: unknown) => {
        console.error("Purchase callback failed", error);
        void showInGameAlert(translateText("store.purchase_failed"));
      })
      .finally(() => (this.busy = false));
  }

  showInsufficient(result: InsufficientCurrency) {
    this.insufficient = result;
  }

  private renderDollarButton() {
    const price = this.dollarPrice || this.product?.price;
    if (!price) return nothing;

    return html`
      <button
        class="purchase-sparkle-btn relative overflow-hidden w-full min-h-11 px-2 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center
         hover:bg-blue-600 hover:border-blue-400 hover:text-white hover:shadow-[0_0_20px_rgba(96,165,250,0.6)]"
        ?disabled=${this.busy}
        @click=${(e: Event) => this.handleClick(e, this.onPurchaseDollar)}
      >
        <span class="purchase-sparkle-streak"></span>
        ${this.dollarLabelKey
          ? html`${translateText(this.dollarLabelKey)} `
          : nothing}${price}${this.priceSuffix}
      </button>
    `;
  }

  private renderHardButton() {
    return html`
      <button
        class="purchase-sparkle-btn-hard relative overflow-hidden w-full min-h-11 px-2 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/40 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center gap-2
         hover:bg-blue-600 hover:border-blue-400 hover:text-white hover:shadow-[0_0_20px_rgba(96,165,250,0.6)]"
        ?disabled=${this.busy}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.requestCurrencyPurchase("hard");
        }}
      >
        <plutonium-icon .size=${20} style="margin-top:3px"></plutonium-icon>
        ${this.priceHard!.toLocaleString()}
      </button>
    `;
  }

  private renderSoftButton() {
    return html`
      <button
        class="purchase-sparkle-btn-soft relative overflow-hidden w-full min-h-11 px-2 py-1.5 bg-amber-700/20 text-amber-600 border border-amber-700/30 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 flex items-center justify-center gap-2
         hover:bg-amber-700 hover:border-amber-600 hover:text-white hover:shadow-[0_0_20px_rgba(217,119,6,0.6)]"
        ?disabled=${this.busy}
        @click=${(e: Event) => {
          e.stopPropagation();
          this.requestCurrencyPurchase("soft");
        }}
      >
        <cap-icon .size=${22} style="margin-top:3px"></cap-icon>
        ${this.priceSoft!.toLocaleString()}
      </button>
    `;
  }

  /** Invisible stand-in with a real button's height, holding a line open. */
  private renderReservedLine() {
    return html`<span
      aria-hidden="true"
      class="invisible block w-full min-h-11 px-2 py-1.5 border rounded-lg text-base font-bold"
      >0</span
    >`;
  }

  render() {
    const hasDollar = this.offersDollar;
    const hasHard = this.offersHard;
    const hasSoft = this.offersSoft;

    if (!hasDollar && !hasHard && !hasSoft) return nothing;

    // Reserved lines above the topmost real button push the rising particles
    // down with it, so they never sparkle over an empty line. Each line is
    // min-h-11 (2.75rem) plus the column's gap-1 (0.25rem).
    const leadingReserved =
      (!hasDollar && this.reserveDollar ? 1 : 0) +
      (!hasDollar && !hasHard && this.reserveHard ? 1 : 0);

    return html`
      <div
        class="no-crazygames w-full mt-2 relative purchase-btn-wrap"
        style="--purchase-particle-top: ${leadingReserved * 3}rem"
        aria-busy=${this.busy ? "true" : nothing}
      >
        ${this.rarity !== "common"
          ? html`<span class="purchase-ember purchase-ember-0"></span>
              <span class="purchase-ember purchase-ember-1"></span>
              <span class="purchase-ember purchase-ember-2"></span>
              <span class="purchase-ember purchase-ember-3"></span>
              ${Array.from(
                { length: 40 },
                (_, i) =>
                  html`<span
                    class="purchase-burst purchase-burst-${i}"
                  ></span>`,
              )}`
          : null}
        <div class="flex flex-col gap-1 w-full">
          ${hasDollar
            ? this.renderDollarButton()
            : this.reserveDollar
              ? this.renderReservedLine()
              : null}
          ${hasHard
            ? this.renderHardButton()
            : this.reserveHard
              ? this.renderReservedLine()
              : null}
          ${hasSoft
            ? this.renderSoftButton()
            : this.reserveSoft
              ? this.renderReservedLine()
              : null}
        </div>
        ${this.busy
          ? html`<div class="cosmetic-loading-overlay">
              <div class="cosmetic-loading-spinner"></div>
            </div>`
          : nothing}
      </div>
      ${this.confirmingPurchase
        ? html`<confirm-dialog
            .heading=${translateText("store.confirm_purchase_title")}
            .message=${translateText("store.confirm_purchase_body", {
              item: this.confirmingPurchase.itemName,
              amount: this.confirmingPurchase.amount,
              currency: translateText(
                this.confirmingPurchase.method === "hard"
                  ? "cosmetics.hard"
                  : "cosmetics.soft",
              ),
            })}
            variant="warning"
            @confirm=${() => {
              const pending = this.confirmingPurchase;
              this.confirmingPurchase = null;
              this.executePurchase(pending?.handler);
            }}
            @cancel=${() => (this.confirmingPurchase = null)}
          ></confirm-dialog>`
        : nothing}
      <insufficient-currency-dialog
        .info=${this.insufficient}
        @close=${() => (this.insufficient = null)}
      ></insufficient-currency-dialog>
    `;
  }
}

/**
 * Line up payment buttons by currency within each visual row: every card in a
 * row reserves a line for the methods its row-mates offer, and only those — a
 * row with no caps price keeps no caps line. Rows are read from laid-out card
 * positions (offsetTop, so a hovered card's scale doesn't move it), so callers
 * must run this after render and on resize.
 */
export function alignPurchaseRows(root: ParentNode): void {
  const rows = new Map<number, PurchaseButton[]>();
  for (const button of root.querySelectorAll<PurchaseButton>(
    "purchase-button",
  )) {
    const card =
      button.closest<HTMLElement>("cosmetic-card, custom-currency-card") ??
      button;
    const row = rows.get(card.offsetTop);
    if (row) row.push(button);
    else rows.set(card.offsetTop, [button]);
  }

  for (const row of rows.values()) {
    const dollar = row.some((button) => button.offersDollar);
    const hard = row.some((button) => button.offersHard);
    const soft = row.some((button) => button.offersSoft);
    for (const button of row) {
      button.reserveDollar = dollar;
      button.reserveHard = hard;
      button.reserveSoft = soft;
    }
  }
}
