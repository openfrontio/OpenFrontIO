import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { translateText } from "../../Utils";

@customElement("game-mode-picker")
export class GameModePicker extends LitElement {
  @property({ type: Number }) value: GameMode = GameMode.FFA;

  createRenderRoot() {
    return this;
  }

  private pick(mode: GameMode) {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const keys = Object.keys(GameMode) as Array<keyof typeof GameMode>;
    // Explicit mapping from enum key to translation id suffix
    const labelIdByKey: Record<keyof typeof GameMode, string> = {
      FFA: "ffa",
      Team: "teams",
    };
    return html`
      <div
        class="inline-flex overflow-hidden rounded-xl border border-white/15"
      >
        ${keys.map((key) => {
          const mode = GameMode[key];
          return html` <button
            class=${`h-10 px-4 transition-colors ${
              this.value === mode
                ? "bg-blue-500/25 text-blue-50"
                : "bg-transparent hover:bg-white/5"
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60`}
            @click=${() => this.pick(mode)}
          >
            ${translateText(`game_mode.${labelIdByKey[key]}`)}
          </button>`;
        })}
      </div>
    `;
  }
}
