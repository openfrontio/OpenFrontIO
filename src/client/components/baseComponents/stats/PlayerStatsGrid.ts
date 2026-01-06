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
      <div class="grid grid-cols-2 gap-4 mb-2">
        ${Array(this.VISIBLE_STATS_COUNT)
          .fill(0)
          .map(
            (_, i) => html`
              <div class="text-center text-white text-base">
                <div class="text-xl font-bold">${this.values[i] ?? ""}</div>
                <div class="text-[#bbb] text-sm">${this.titles[i] ?? ""}</div>
              </div>
            `,
          )}
      </div>
    `;
  }
}
