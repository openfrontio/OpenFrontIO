import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import "../../components/baseComponents/Button";
import { Controller } from "../../Controller";

/**
 * Always-on overlay button shown only during a skin preview. Clicking it ends
 * the preview by opening <preview-complete-modal>. The preview itself never
 * auto-ends, so this is the player's way out.
 */
@customElement("preview-finish-button")
export class PreviewFinishButton extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private isPreview = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isPreview = this.game?.config().isPreview() ?? false;
    this.requestUpdate();
  }

  tick() {}

  private onFinish() {
    const modal = document.querySelector("preview-complete-modal") as
      | (HTMLElement & { show?: () => void })
      | null;
    modal?.show?.();
  }

  render() {
    if (!this.isPreview) return html``;
    return html`
      <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10005]">
        <o-button
          variant="primary"
          translationKey="preview.finish"
          @click=${this.onFinish}
        ></o-button>
      </div>
    `;
  }
}
