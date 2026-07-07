import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { createCustomCurrencyCheckout } from "../Api";
import { translateText } from "../Utils";
import "./PlutoniumIcon";

// Fixed rate: 20 plutonium = $1.00 (5 cents each). Bounds and rate are
// enforced server-side; these are for UX only.
const MIN_PLUTONIUM = 20;
const MAX_PLUTONIUM = 2000;

@customElement("custom-currency-card")
export class CustomCurrencyCard extends LitElement {
  /** Always a clamped integer in [MIN_PLUTONIUM, MAX_PLUTONIUM]. */
  @state() private amount = 100;
  @state() private busy = false;

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

  private async buy() {
    if (this.busy) return;
    this.busy = true;
    try {
      const url = await createCustomCurrencyCheckout(this.amount);
      if (url === false) {
        alert(translateText("store.checkout_failed"));
        return;
      }
      window.location.href = url;
    } finally {
      this.busy = false;
    }
  }

  render() {
    const price = `$${this.priceDollars}`;
    return html`
      <div
        class="relative flex flex-col items-center justify-between gap-2 p-3 w-48 rounded-xl border border-white/15 backdrop-blur-md"
        style="background: linear-gradient(to top, rgba(80,80,80,0.55) 0%, rgba(15,15,20,0.85) 100%);"
      >
        <div
          class="text-xs font-bold uppercase tracking-wider text-center text-white/70 w-full"
        >
          ${translateText("store.custom_amount")}
        </div>

        <div class="flex flex-col items-center gap-2 w-full">
          <plutonium-icon .size=${64}></plutonium-icon>
          <span class="text-lg font-black text-green-400"
            >${this.amount.toLocaleString()}</span
          >
          <span class="text-[10px] font-bold text-white/50 uppercase"
            >${translateText("cosmetics.hard")}</span
          >

          <input
            type="range"
            class="w-full accent-green-500 cursor-pointer"
            min=${MIN_PLUTONIUM}
            max=${MAX_PLUTONIUM}
            step="1"
            .value=${String(this.amount)}
            @input=${this.onSlider}
          />

          <input
            type="number"
            class="w-24 text-center bg-black/30 border border-white/20 rounded px-2 py-1 text-white text-sm"
            aria-label=${translateText("store.custom_amount")}
            min=${MIN_PLUTONIUM}
            max=${MAX_PLUTONIUM}
            step="1"
            .value=${String(this.amount)}
            @change=${this.onInputChange}
          />
        </div>

        <button
          class="w-full mt-1 px-2 py-1.5 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-base font-bold cursor-pointer transition-all duration-200 hover:bg-green-500 hover:border-green-400 hover:text-white hover:shadow-[0_0_20px_rgba(74,222,128,0.6)] disabled:opacity-50 disabled:cursor-not-allowed"
          ?disabled=${this.busy}
          @click=${this.buy}
        >
          ${translateText("store.buy_for", { price })}
        </button>
      </div>
    `;
  }
}
