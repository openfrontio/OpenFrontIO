import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import "../../components/baseComponents/Button";
import "../../components/CosmeticButton";
import { Controller } from "../../Controller";
import {
  PaymentMethod,
  purchaseCosmetic,
  ResolvedCosmetic,
} from "../../Cosmetics";
import { getPreviewCosmetic } from "../../Preview";
import { translateText } from "../../Utils";

/**
 * Standalone end-of-preview popup. Mirrors the win/loss modal's look but shows
 * only the single cosmetic that was just previewed, alongside its buy button.
 * Shown when the user clicks "Finish preview" (see <preview-finish-button>).
 */
@customElement("preview-complete-modal")
export class PreviewCompleteModal extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {}

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private handleExit() {
    this.hide();
    // Navigate home; the reload clears the preview-mode body class.
    window.location.href = "/";
  }

  // Buy the previewed skin right here. `fromGame` keeps the purchase clean
  // inside the live preview: a successful buy navigates home (full teardown),
  // a Stripe purchase redirects out, and insufficient funds just shows the
  // "not enough currency" message and leaves the preview running.
  private handlePurchase = (
    resolved: ResolvedCosmetic,
    method: PaymentMethod,
  ) => {
    purchaseCosmetic(resolved, method, { fromGame: true });
  };

  render() {
    if (!this.isVisible) return html``;
    const resolved = getPreviewCosmetic();
    return html`
      <div
        class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800/70 p-6 shrink-0 rounded-lg z-[10010] shadow-2xl backdrop-blur-xs text-white w-87.5 max-w-[90%]"
      >
        <h2 class="m-0 mb-2 text-[26px] text-center text-white">
          ${translateText("preview.complete_title")}
        </h2>
        <p class="m-0 mb-4 text-center text-white/70">
          ${translateText("preview.complete_subtitle")}
        </p>
        ${resolved
          ? html`<div class="flex justify-center mb-4">
              <cosmetic-button
                .resolved=${resolved}
                .onPurchase=${this.handlePurchase}
              ></cosmetic-button>
            </div>`
          : nothing}
        <div class="flex justify-between gap-2.5">
          <o-button
            variant="primary"
            width="block"
            class="flex-1"
            translationKey="preview.exit"
            @click=${this.handleExit}
          ></o-button>
          <o-button
            variant="secondary"
            width="block"
            class="flex-1"
            translationKey="preview.keep_watching"
            @click=${this.hide}
          ></o-button>
        </div>
      </div>
    `;
  }
}
