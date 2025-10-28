import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { GameMode } from "../../../core/game/Game";

@customElement("game-mode-controls")
export class GameModeControls extends LitElement {
  @property({ type: Number }) value: GameMode = GameMode.FFA;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div>
        <label class="mb-1 ml-0.5 block text-xs text-zinc-400">
          ${translateText("host_modal.mode")}
        </label>
        <game-mode-picker
          .value=${this.value}
          @change=${(e: CustomEvent<{ value: GameMode }>) =>
            this.dispatchEvent(
              new CustomEvent("change", {
                detail: e.detail,
                bubbles: true,
                composed: true,
              }),
            )}
        ></game-mode-picker>
      </div>
    `;
  }
}
