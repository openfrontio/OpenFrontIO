import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("player-stats-grid")
export class PlayerStatsGrid extends LitElement {
  static styles = css`
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
    }
    @media (min-width: 640px) {
      .grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .stat {
      text-align: center;
      color: white;
      font-size: 1rem;
    }
    .stat-title {
      color: #bbb;
      font-size: 0.9rem;
    }
    .stat-value {
      font-size: 1.25rem;
      font-weight: bold;
    }
  `;

  @property({ type: Array }) titles: string[] = [];
  @property({ type: Array }) values: Array<string | number> = [];

  // Currently fixed to display 4 stats (can be changed if needed)
  private readonly VISIBLE_STATS_COUNT = 4;

  render() {
    return html`
      <div class="grid mb-2">
        ${Array(this.VISIBLE_STATS_COUNT)
          .fill(0)
          .map(
            (_, i) => html`
              <div class="stat">
                <div class="stat-value">${this.values[i] ?? ""}</div>
                <div class="stat-title">${this.titles[i] ?? ""}</div>
              </div>
            `,
          )}
      </div>
    `;
  }
}
