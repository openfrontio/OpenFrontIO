import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { Duos, GameMode, Quads, Trios } from "../../../core/game/Game";
import { TeamCountConfig } from "../../../core/Schemas";

@customElement("team-count-picker")
export class TeamCountPicker extends LitElement {
  @property({ type: Number }) mode: GameMode = GameMode.FFA;
  @property({ type: Number }) value: TeamCountConfig = 2;
  @property({ type: Array }) numbers: TeamCountConfig[] = [2, 3, 4, 5, 6, 7];
  @property({ type: Array }) named: TeamCountConfig[] = [Duos, Trios, Quads];

  private isSel = (v: TeamCountConfig) => this.value === v;
  createRenderRoot() {
    return this;
  }

  render() {
    if (this.mode !== GameMode.Team) return null;
    const group =
      "inline-flex items-center overflow-hidden rounded-xl border border-white/15 bg-white/5 backdrop-blur";
    const btn =
      "h-9 px-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60";
    const on = "border border-blue-500/40 bg-blue-600/20 text-blue-50";
    const off = "text-zinc-200 hover:bg-white/10";

    return html`
      <div class="mt-3">
        <label class="mb-1 ml-0.5 block text-xs text-zinc-400">
          ${translateText("host_modal.team_count")}
        </label>
        <div class="flex flex-wrap gap-2" role="group" aria-label="Teams">
          <div class=${group}>
            ${this.numbers.map(
              (n) =>
                html` <button
                  class="${btn} ${this.isSel(n) ? on : off}"
                  aria-pressed=${String(this.isSel(n))}
                  @click=${() => this.emit(n)}
                >
                  ${n}
                </button>`,
            )}
          </div>
          <div class=${group}>
            ${this.named.map(
              (v) =>
                html` <button
                  class="${btn} ${this.isSel(v) ? on : off}"
                  aria-pressed=${String(this.isSel(v))}
                  @click=${() => this.emit(v)}
                >
                  ${translateText(`public_lobby.teams_${v}`)}
                </button>`,
            )}
          </div>
        </div>
      </div>
    `;
  }

  private emit(v: TeamCountConfig) {
    this.dispatchEvent(
      new CustomEvent("change", {
        detail: { value: v },
        bubbles: true,
        composed: true,
      }),
    );
  }
}
