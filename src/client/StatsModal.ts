import { css, html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase } from "./Api";
import { translateText } from "./Utils";

@customElement("stats-modal")
export class StatsModal extends LitElement {
  @query("o-modal")
  private modalEl!: HTMLElement & {
    open: () => void;
    close: () => void;
  };

  @state() private isLoading: boolean = false;
  @state() private error: string | null = null;
  @state() private data: ClanLeaderboardResponse | null = null;

  private hasLoaded = false;

  createRenderRoot() {
    return this;
  }

  public open() {
    this.modalEl?.open();
    if (!this.hasLoaded && !this.isLoading) {
      void this.loadLeaderboard();
    }
  }

  public close() {
    this.modalEl?.close();
  }

  private async loadLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status}`);
      }

      const json = await res.json();
      const parsed = ClanLeaderboardResponseSchema.safeParse(json);
      if (!parsed.success) {
        console.warn(
          "ClanLeaderboardModal: invalid response schema",
          parsed.error,
        );
        throw new Error("Invalid response format");
      }

      this.data = parsed.data;
      this.hasLoaded = true;
    } catch (err) {
      console.warn("ClanLeaderboardModal: failed to load leaderboard", err);
      this.error = translateText("stats_modal.error");
    } finally {
      this.isLoading = false;
      this.requestUpdate();
    }
  }

  private renderBody() {
    if (this.isLoading) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2 text-lg font-semibold">
            ${translateText("stats_modal.loading")}
          </p>
          <div
            class="w-6 h-6 border-4 border-red-500 border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-4 text-center">${this.error}</p>
          <button
            class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm font-medium"
            @click=${() => this.loadLeaderboard()}
          >
            Retry
          </button>
        </div>
      `;
    }

    if (!this.data || this.data.clans.length === 0) {
      return html`
        <div class="p-6 text-center text-gray-200">
          <p class="text-lg font-semibold mb-2">
            ${translateText("stats_modal.no_stats")}
          </p>
        </div>
      `;
    }

    const { start, end, clans } = this.data;
    const startDate = new Date(start);
    const endDate = new Date(end);

    return html`
      <div class="p-4 md:p-6 text-gray-200">
        <div
          class="flex flex-col md:flex-row md:items-center md:justify-between mb-4 gap-2"
        >
          <div>
            <h2 class="text-xl font-semibold">
              ${translateText("stats_modal.clan_stats")}
            </h2>
            <p class="text-xs text-gray-400 mt-1">
              ${startDate.toLocaleDateString()} &middot;
              ${endDate.toLocaleDateString()}
            </p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full text-xs md:text-sm">
            <thead>
              <tr class="border-b border-gray-700 text-gray-300">
                <th class="py-2 pr-3 text-left">
                  ${translateText("stats_modal.rank")}
                </th>
                <th class="py-2 pr-3 text-left">
                  ${translateText("stats_modal.clan")}
                </th>
                <th class="py-2 px-2 text-right">
                  ${translateText("stats_modal.games")}
                </th>
                <th class="py-2 px-2 text-right">
                  ${translateText("stats_modal.win_score")}
                </th>
                <th class="py-2 px-2 text-right">
                  ${translateText("stats_modal.loss_score")}
                </th>
                <th class="py-2 pl-2 text-right">
                  ${translateText("stats_modal.win_loss_ratio")}
                </th>
              </tr>
            </thead>
            <tbody>
              ${clans.map(
                (clan, index) => html`
                  <tr class="border-b border-gray-800 last:border-b-0">
                    <td class="py-2 pr-3 text-center">
                      ${(index + 1).toLocaleString()}
                    </td>
                    <td class="py-2 pr-3 font-semibold text-left">
                      ${clan.clanTag}
                    </td>
                    <td class="py-2 px-2 text-right">
                      ${clan.games.toLocaleString()}
                    </td>
                    <td class="py-2 px-2 text-right">${clan.weightedWins}</td>
                    <td class="py-2 px-2 text-right">${clan.weightedLosses}</td>
                    <td class="py-2 pl-2 text-right">
                      ${clan.weightedWLRatio}
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <o-modal id="stats-modal" title="${translateText("stats_modal.title")}">
        ${this.renderBody()}
      </o-modal>
    `;
  }
}

@customElement("stats-button")
export class StatsButton extends LitElement {
  @query("stats-modal") private statsModal: StatsModal;
  @state() private isVisible: boolean = true;

  static styles = css`
    :host {
      display: block;
    }
  `;

  constructor() {
    super();
  }

  createRenderRoot() {
    return this;
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div class="fixed top-20 right-4 z-[9998]">
        <button
          @click="${this.open}"
          class="w-12 h-12 bg-red-600 hover:bg-red-700 text-white rounded-full shadow-2xl hover:shadow-2xl transition-all duration-200 flex items-center justify-center text-xl focus:outline-none focus:ring-4 focus:ring-red-500 focus:ring-offset-4"
          title="${translateText("stats_modal.title")}"
        >
          <img src="/icons/stats.svg" alt="Stats" class="w-6 h-6" />
        </button>
      </div>
      <stats-modal></stats-modal>
    `;
  }

  private open() {
    this.isVisible = true;
    this.requestUpdate();
    this.statsModal?.open();
  }

  public close() {
    this.statsModal?.close();
    this.isVisible = false;
    this.requestUpdate();
  }
}
