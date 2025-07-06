import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

@customElement("game-starting-modal")
export class GameStartingModal extends LitElement {
  @state()
  isVisible = false;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div
        class="${this.isVisible
          ? "fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 background-panel p-6 z-[9999] text-textLight w-[300px] text-center opacity-100 font-title"
          : "hidden opacity-0"}"
      >
        <h2 class="mb-4 text-large text-textLight">
          ${translateText("game_starting_modal.title")}
        </h2>
        <p class="mb-5 text-small bg-backgroundDarkLighter p-2.5">
          ${translateText("game_starting_modal.desc")}
        </p>
      </div>
    `;
  }

  show() {
    this.isVisible = true;
    this.requestUpdate();
  }

  hide() {
    this.isVisible = false;
    this.requestUpdate();
  }
}
