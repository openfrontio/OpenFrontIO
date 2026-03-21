import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Product } from "../../core/CosmeticSchemas";
import { translateText } from "../Utils";

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
          class="w-full px-4 py-2 bg-green-500/20 text-green-400 border border-green-500/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-pointer transition-all duration-200
           hover:bg-green-500/30 hover:shadow-[0_0_15px_rgba(74,222,128,0.2)]"
          @click=${this.handleClick}
        >
          ${translateText("territory_patterns.purchase")}
          <span class="ml-1 text-white/60">(${this.product.price})</span>
        </button>
      </div>
    `;
  }
}
