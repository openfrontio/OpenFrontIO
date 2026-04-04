import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import { translateText } from "../Utils";

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
      background: linear-gradient(90deg, transparent 0%, rgba(134,239,172,0.5) 50%, transparent 100%);
      transform: skewX(-15deg);
      opacity: 0;
    }
    cosmetic-container:hover .purchase-sparkle-streak {
      animation: purchase-streak 0.7s ease-in-out;
    }
    cosmetic-container:hover .purchase-sparkle-btn {
      background: rgb(34,197,94);
      border-color: rgb(74,222,128);
      color: white;
      box-shadow: 0 0 20px rgba(74,222,128,0.6);
    }
    .purchase-sparkle-btn:hover {
      background: rgb(22,163,74) !important;
      border-color: rgb(74,222,128) !important;
      color: white !important;
      box-shadow: 0 0 30px rgba(74,222,128,0.8), 0 0 60px rgba(34,197,94,0.4) !important;
    }
  `;
  document.head.appendChild(style);
}

@customElement("purchase-button")
export class PurchaseButton extends LitElement {
  @property({ type: Object })
  product!: Product;

  @property({ type: Function })
  onPurchase?: () => void;

  createRenderRoot() {
    return this;
  }

  private handleClick(e: Event) {
    e.stopPropagation();
    this.onPurchase?.();
  }

  render() {
    return html`
      <div class="no-crazygames w-full mt-2">
        <button
          class="purchase-sparkle-btn relative overflow-hidden w-full px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-all duration-200
           hover:bg-green-500 hover:border-green-400 hover:text-white hover:shadow-[0_0_20px_rgba(74,222,128,0.6)]"
          @click=${this.handleClick}
        >
          <span class="purchase-sparkle-streak"></span>
          ${translateText("territory_patterns.purchase")}
          <span class="ml-1 text-white/50">(${this.product.price})</span>
        </button>
      </div>
    `;
  }
}
