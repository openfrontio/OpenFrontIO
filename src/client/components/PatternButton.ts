// components/PatternButton.ts
import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Pattern } from "../../core/CosmeticSchemas";
import { generatePreviewDataUrl } from "../TerritoryPatternsModal";
import { translateText } from "../Utils";

export const BUTTON_WIDTH = 150;

@customElement("pattern-button")
export class PatternButton extends LitElement {
  @property({ type: Object })
  pattern: Pattern | null = null;

  @property({ type: Function })
  onSelect?: (pattern: Pattern | null) => void;

  @property({ type: Function })
  onPurchase?: (priceId: string) => void;

  // Override to prevent shadow DOM creation (matching WinModal)
  createRenderRoot() {
    return this;
  }

  private renderPatternPreview(pattern: string): TemplateResult {
    const dataUrl = generatePreviewDataUrl(pattern, BUTTON_WIDTH, BUTTON_WIDTH);
    return html`<img
      src="${dataUrl}"
      alt="Pattern preview"
      class="w-full h-full object-contain"
      style="image-rendering: pixelated; image-rendering: -moz-crisp-edges; image-rendering: crisp-edges;"
    />`;
  }

  private renderBlankPreview(): TemplateResult {
    return html`<div
      class="w-full h-full bg-gray-100 border border-gray-300 rounded"
    ></div>`;
  }

  private translatePatternName(prefix: string, patternName: string): string {
    const translation = translateText(`${prefix}.${patternName}`);
    if (translation.startsWith(prefix)) {
      return patternName[0].toUpperCase() + patternName.substring(1);
    }
    return translation;
  }

  private handleClick() {
    const isDefaultPattern = this.pattern === null;
    if (isDefaultPattern || this.pattern?.product === null) {
      this.onSelect?.(this.pattern);
    }
  }

  private handlePurchase(e: Event) {
    e.stopPropagation();
    if (this.pattern?.product) {
      this.onPurchase?.(this.pattern.product.priceId);
    }
  }

  render() {
    const isDefaultPattern = this.pattern === null;
    const isPurchasable = !isDefaultPattern && this.pattern?.product !== null;

    return html`
      <div
        class="flex flex-col items-center gap-2 p-3 bg-white/10 rounded-lg max-w-[200px]"
      >
        <button
          class="bg-white/90 border-2 border-black/10 rounded-lg p-2 cursor-pointer transition-all duration-200 w-full
                 hover:bg-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
          ?disabled=${isPurchasable}
          @click=${this.handleClick}
        >
          <div class="text-sm font-bold text-gray-800 mb-2 text-center">
            ${isDefaultPattern
              ? translateText("territory_patterns.pattern.default")
              : this.translatePatternName(
                  "territory_patterns.pattern",
                  this.pattern!.name,
                )}
          </div>
          <div
            class="w-[120px] h-[120px] flex items-center justify-center bg-white rounded p-1 mx-auto"
          >
            ${isDefaultPattern
              ? this.renderBlankPreview()
              : this.renderPatternPreview(this.pattern!.pattern)}
          </div>
        </button>

        ${isPurchasable
          ? html`
              <button
                class="w-full px-4 py-2 bg-green-500 text-white border-0 rounded-md text-sm font-semibold cursor-pointer transition-colors duration-200
                   hover:bg-green-600"
                @click=${this.handlePurchase}
              >
                ${translateText("territory_patterns.purchase")}
                (${this.pattern!.product!.price})
              </button>
            `
          : null}
      </div>
    `;
  }
}
