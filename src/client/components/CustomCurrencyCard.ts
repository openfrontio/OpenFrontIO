import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createCustomCurrencyCheckout } from "../Api";
import { showInGameAlert } from "../InGameModal";
import { translateText } from "../Utils";
import "./PlutoniumIcon";
import "./PurchaseButton";

// Fixed rate: 20 plutonium = $1.00 (5 cents each). Bounds and rate are
// enforced server-side; these are for UX only.
const MIN_PLUTONIUM = 20;
const MAX_PLUTONIUM = 2000;

@customElement("custom-currency-card")
export class CustomCurrencyCard extends LitElement {
  /** Always a clamped integer in [MIN_PLUTONIUM, MAX_PLUTONIUM]. */
  @state() private amount = 100;

  createRenderRoot() {
    return this;
  }

  private clamp(value: number): number {
    if (!Number.isFinite(value)) return MIN_PLUTONIUM;
    return Math.min(MAX_PLUTONIUM, Math.max(MIN_PLUTONIUM, Math.floor(value)));
  }

  private get priceDollars(): string {
    return (this.amount / 20).toFixed(2);
  }

  private onSlider(e: Event) {
    this.amount = this.clamp(Number((e.target as HTMLInputElement).value));
  }

  private onInputChange(e: Event) {
    this.amount = this.clamp(Number((e.target as HTMLInputElement).value));
  }

  private buy = async () => {
    const url = await createCustomCurrencyCheckout(this.amount);
    if (url === false) {
      await showInGameAlert(translateText("store.checkout_failed"));
      return;
    }
    window.location.href = url;
  };

  render() {
    const price = `$${this.priceDollars}`;
    // Mirrors cosmetic-card: the name leads, the artwork box is square, and
    // the width comes from the host so the card shrinks with the grid on
    // phones instead of overflowing it.
    return html`
      <article
        data-custom-currency-card
        data-cosmetic-shell
        data-cosmetic-rarity="common"
        style="background:linear-gradient(to top, rgba(80,80,80,0.55) 0%, rgba(15,15,20,0.85) 100%);border-color:rgba(255,255,255,0.15)"
        class="relative flex h-full w-full flex-col items-center overflow-visible rounded-xl border border-white/20 transition-all duration-200 ease-out hover:-translate-y-1 hover:z-10 hover:shadow-[0_0_10px_rgba(255,255,255,0.5)]"
      >
        <span
          data-custom-currency-name
          class="w-full whitespace-normal break-words px-3 pt-3 text-center text-sm font-bold leading-tight text-white"
          >${translateText("store.custom_amount")}</span
        >

        <div
          data-cosmetic-main
          class="group relative flex w-full flex-col items-center gap-2 rounded-xl px-3 pb-3 pt-2"
        >
          <div
            data-custom-currency-preview
            class="relative flex w-full aspect-square flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-white/5 p-2"
          >
            <plutonium-icon class="block shrink-0" .size=${64}></plutonium-icon>
            <label for="custom-plutonium-amount" class="sr-only"
              >${translateText("store.plutonium_amount")}</label
            >
            <input
              id="custom-plutonium-amount"
              type="number"
              class="custom-plutonium-input w-full min-w-0 max-w-24 text-center bg-black/30 border border-green-500/30 rounded px-1 py-0.5 text-lg font-black leading-none text-green-400 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400/40"
              aria-label=${translateText("store.plutonium_amount")}
              min=${MIN_PLUTONIUM}
              max=${MAX_PLUTONIUM}
              step="1"
              .value=${String(this.amount)}
              @change=${this.onInputChange}
            />
            <span
              class="text-[10px] font-bold leading-none text-white/50 uppercase"
              >${translateText("cosmetics.hard")}</span
            >
          </div>

          <input
            type="range"
            class="w-full accent-green-500 cursor-pointer"
            aria-label=${translateText("store.plutonium_amount")}
            min=${MIN_PLUTONIUM}
            max=${MAX_PLUTONIUM}
            step="1"
            .value=${String(this.amount)}
            @input=${this.onSlider}
          />
        </div>

        <div data-cosmetic-action class="mt-auto w-full px-3 pb-3 pt-2">
          <purchase-button
            class="block w-full"
            .dollarPrice=${price}
            .onPurchaseDollar=${this.buy}
          ></purchase-button>
        </div>
      </article>
    `;
  }
}
