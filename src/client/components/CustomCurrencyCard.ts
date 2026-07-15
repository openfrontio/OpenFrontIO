import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createCustomCurrencyCheckout } from "../Api";
import { translateText } from "../Utils";
import "./CosmeticContainer";
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
      alert(translateText("store.checkout_failed"));
      return;
    }
    window.location.href = url;
  };

  render() {
    const price = `$${this.priceDollars}`;
    return html`
      <cosmetic-container
        class="flex flex-col items-center justify-between gap-2 p-3 w-48 h-full"
        .rarity=${"common"}
        .name=${translateText("store.custom_amount")}
      >
        <div
          class="relative flex flex-col items-center justify-center gap-1 w-full aspect-square bg-white/5 rounded-lg p-2 border border-white/10 overflow-hidden"
        >
          <plutonium-icon .size=${64}></plutonium-icon>
          <label for="custom-plutonium-amount" class="sr-only"
            >${translateText("store.plutonium_amount")}</label
          >
          <input
            id="custom-plutonium-amount"
            type="number"
            class="custom-plutonium-input w-24 text-center bg-black/30 border border-green-500/30 rounded px-1 py-0.5 text-lg font-black text-green-400 outline-none focus:border-green-400 focus:ring-1 focus:ring-green-400/40"
            aria-label=${translateText("store.plutonium_amount")}
            min=${MIN_PLUTONIUM}
            max=${MAX_PLUTONIUM}
            step="1"
            .value=${String(this.amount)}
            @change=${this.onInputChange}
          />
          <span class="text-[10px] font-bold text-white/50 uppercase"
            >${translateText("cosmetics.hard")}</span
          >
          <input
            type="range"
            class="w-[90%] accent-green-500 cursor-pointer"
            aria-label=${translateText("store.plutonium_amount")}
            min=${MIN_PLUTONIUM}
            max=${MAX_PLUTONIUM}
            step="1"
            .value=${String(this.amount)}
            @input=${this.onSlider}
          />
        </div>

        <purchase-button
          .dollarPrice=${price}
          .onPurchaseDollar=${this.buy}
        ></purchase-button>
      </cosmetic-container>
    `;
  }
}
