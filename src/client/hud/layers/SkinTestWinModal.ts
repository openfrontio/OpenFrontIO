import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ColorPalette, Pattern } from "../../../core/CosmeticSchemas";
import "../../components/CosmeticButton";
import {
  fetchCosmetics,
  purchaseCosmetic,
  ResolvedCosmetic,
} from "../../Cosmetics";
import { translateText } from "../../Utils";

@customElement("skin-test-win-modal")
export class SkinTestWinModal extends LitElement {
  @state() isVisible = false;
  @state() private pattern: Pattern | null = null;
  @state() private colorPalette: ColorPalette | null = null;
  @state() private rated: "up" | "down" | null = null;

  createRenderRoot() {
    return this;
  }

  /** Show by pattern name — fetches the full Pattern object from the cosmetics API. */
  async showByName(
    patternName: string,
    colorPalette: ColorPalette | null,
  ): Promise<void> {
    const cosmetics = await fetchCosmetics();
    const pattern = cosmetics?.patterns[patternName];
    if (!pattern) {
      console.error("Skin test: pattern not found", patternName);
      return;
    }
    this.show(pattern, colorPalette);
  }

  show(pattern: Pattern, colorPalette: ColorPalette | null): void {
    this.pattern = pattern;
    this.colorPalette = colorPalette;
    this.isVisible = true;
  }

  hide(): void {
    this.isVisible = false;
    this.rated = null;
  }

  private exit(): void {
    this.hide();
    window.location.href = "/";
  }

  private rate(rating: "up" | "down"): void {
    this.rated = rating;
    // TODO: send rating event to the server
  }

  private renderRateButton(rating: "up" | "down") {
    const isSelected = this.rated === rating;
    const selectedClass =
      rating === "up"
        ? "bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]"
        : "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]";
    const path =
      rating === "up"
        ? "M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
        : "M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5";
    return html`
      <button
        @click=${() => this.rate(rating)}
        aria-label=${translateText(`skin_test_modal.rate_${rating}`)}
        class="p-3 rounded-full transition-all duration-200 hover:scale-110 flex items-center justify-center overflow-visible ${isSelected
          ? selectedClass
          : "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"}"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-8 w-8 block"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d=${path}
          />
        </svg>
      </button>
    `;
  }

  private renderCosmetic() {
    if (!this.pattern) return nothing;
    const resolved: ResolvedCosmetic = {
      type: "pattern",
      cosmetic: this.pattern,
      colorPalette: this.colorPalette,
      relationship: "purchasable",
      key: `pattern:${this.pattern.name}${this.colorPalette ? `:${this.colorPalette.name}` : ""}`,
    };
    return html`
      <div class="scale-110">
        <cosmetic-button
          .resolved=${resolved}
          .onPurchase=${purchaseCosmetic}
        ></cosmetic-button>
      </div>
    `;
  }

  render() {
    if (!this.isVisible) return nothing;
    return html`
      <div
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/90 p-6 shrink-0 rounded-lg z-[10000] shadow-2xl backdrop-blur-md text-white w-96 animate-fadeIn border border-white/10"
      >
        <h2
          class="m-0 mb-6 text-2xl font-bold text-center text-white uppercase tracking-wider"
        >
          ${translateText("skin_test_modal.title")}
        </h2>

        <div class="flex flex-col items-center gap-6 mb-6">
          <div class="text-center">
            <h3 class="text-lg font-semibold text-white/90 mb-2">
              ${translateText("skin_test_modal.rate_skin")}
            </h3>
            <div class="flex gap-4 justify-center">
              ${this.renderRateButton("up")} ${this.renderRateButton("down")}
            </div>
          </div>
          ${this.renderCosmetic()}
        </div>

        <button
          @click=${this.exit}
          class="w-full py-3 text-sm font-bold uppercase tracking-wider cursor-pointer bg-white/10 text-white border border-white/10 rounded-lg transition-all duration-200 hover:bg-white/20 hover:border-white/30"
        >
          ${translateText("win_modal.exit")}
        </button>
      </div>

      <style>
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }
      </style>
    `;
  }
}
