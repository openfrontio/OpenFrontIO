import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("player-stats-grid")
export class PlayerStatsGrid extends LitElement {
  createRenderRoot() {
    return this;
  }

  @property({ type: Array }) titles: string[] = [];
  @property({ type: Array }) values: Array<string | number> = [];

  // Currently fixed to display 4 stats (can be changed if needed)
  private readonly VISIBLE_STATS_COUNT = 4;

  render() {
    return html`
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
        ${Array(this.VISIBLE_STATS_COUNT)
          .fill(0)
          .map(
            (_, i) => html`
              <div
                class="flex flex-col items-center justify-center p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
              >
                <div class="text-2xl font-bold text-white mb-1">
                  ${this.values[i] ?? ""}
                </div>
                <div
                  class="text-blue-200/60 text-xs font-bold uppercase tracking-widest"
                >
                  ${this.titles[i] ?? ""}
                </div>
              </div>
            `,
          )}
      </div>
    `;
  }
}
