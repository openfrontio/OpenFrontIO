import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { Difficulty } from "../../../core/game/Game";
import { translateText } from "../../Utils";

@customElement("difficulty-controls")
export class DifficultyControls extends LitElement {
  @property({ type: String }) value: Difficulty = Difficulty.Medium;

  private keyOf(value: Difficulty) {
    return Object.keys(Difficulty).find((k) => Difficulty[k] === value) ?? "";
  }

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <div class="mb-1 flex items-center justify-between">
        <label class="ml-0.5 block text-xs text-zinc-400"
          >${translateText("difficulty.difficulty")}</label
        >
        <div class="h-10">
          <difficulty-display
            .difficultyKey=${this.keyOf(this.value)}
          ></difficulty-display>
        </div>
      </div>
      <difficulty-picker
        .value=${this.value}
        @change=${(e: CustomEvent<{ value: Difficulty }>) =>
          this.dispatchEvent(
            new CustomEvent("change", {
              detail: e.detail,
              bubbles: true,
              composed: true,
            }),
          )}
      ></difficulty-picker>
    `;
  }
}
