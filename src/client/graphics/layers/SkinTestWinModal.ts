import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ColorPalette, Pattern } from "../../../core/CosmeticSchemas";
import { EventBus } from "../../../core/EventBus";
import { fetchCosmetics, handlePurchase } from "../../Cosmetics";
import { translateText } from "../../Utils";
import "../../components/PatternButton";
import { Layer } from "./Layer";

export class ShowSkinTestModalEvent {
  constructor(
    public patternName: string,
    public colorPalette: ColorPalette | null,
  ) {}
}

@customElement("skin-test-win-modal")
export class SkinTestWinModal extends LitElement implements Layer {
  private _eventBus?: EventBus;
  public set eventBus(eb: EventBus | undefined) {
    this._eventBus = eb;
    if (!this._eventBus) return;

    // Subscribe to show requests and handle fetch/display logic here so
    // ClientGameRunner doesn't need to know implementation details.
    this._eventBus.on(
      ShowSkinTestModalEvent,
      async (e: ShowSkinTestModalEvent) => {
        try {
          const cosmetics = await fetchCosmetics();
          if (!cosmetics) {
            console.error("Failed to fetch cosmetics");
            return;
          }
          const pattern = cosmetics.patterns[e.patternName];
          if (pattern) {
            this.show(pattern, e.colorPalette ?? null);
          } else {
            console.error("Pattern not found in cosmetics:", e.patternName);
          }
        } catch (err) {
          console.error("Error showing skin test modal", err);
        }
      },
    );
  }

  public get eventBus(): EventBus | undefined {
    return this._eventBus;
  }

  @state()
  isVisible = false;

  @state()
  private pattern: Pattern | null = null;
  @state()
  private colorPalette: ColorPalette | null = null;

  @state()
  private rated: "up" | "down" | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    // Layer interface implementation - LitElement handles its own rendering
  }

  show(pattern: Pattern, colorPalette: ColorPalette | null) {
    this.pattern = pattern;
    this.colorPalette = colorPalette;
    this.isVisible = true;
  }

  hide() {
    this.isVisible = false;
    this.rated = null;
  }

  private _handleExit() {
    this.hide();
    window.location.href = "/";
  }

  private _handleRate(rating: "up" | "down") {
    this.rated = rating;
    // Here we could send an event to the server to record the rating
  }

  render() {
    if (!this.isVisible) return html``;

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
              <button
                @click=${() => this._handleRate("up")}
                aria-label=${translateText("skin_test_modal.rate_up")}
                class="p-3 rounded-full transition-all duration-200 hover:scale-110 flex items-center justify-center overflow-visible ${this
                  .rated === "up"
                  ? "bg-green-500 text-white shadow-[0_0_15px_rgba(34,197,94,0.5)]"
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
                    d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"
                  />
                </svg>
              </button>
              <button
                @click=${() => this._handleRate("down")}
                aria-label=${translateText("skin_test_modal.rate_down")}
                class="p-3 rounded-full transition-all duration-200 hover:scale-110 flex items-center justify-center overflow-visible ${this
                  .rated === "down"
                  ? "bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.5)]"
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
                    d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"
                  />
                </svg>
              </button>
            </div>
          </div>

          <!-- Reuse pattern button for visual and purchase actions if needed, or custom buy button -->
          ${this.pattern
            ? html`
                <div class="scale-110">
                  <pattern-button
                    .pattern=${this.pattern}
                    .colorPalette=${this.colorPalette}
                    .requiresPurchase=${true}
                    .onPurchase=${(p: Pattern, c: ColorPalette | null) =>
                      handlePurchase(p, c)}
                  ></pattern-button>
                </div>
              `
            : html``}
        </div>

        <button
          @click=${this._handleExit}
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
