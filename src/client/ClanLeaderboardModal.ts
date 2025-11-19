import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
} from "../core/ApiSchemas";

@customElement("clan-leaderboard-modal")
export class ClanLeaderboardModal extends LitElement {
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
      const res = await fetch(
        "https://api.openfront.io/public/clans/leaderboard",
        {
          headers: {
            Accept: "application/json",
          },
        },
      );

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
      this.error = "Failed to load stats, please try again.";
    } finally {
      this.isLoading = false;
      this.requestUpdate();
    }
  }

  private renderBody() {
    if (this.isLoading) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-2 text-lg font-semibold">Loading stats...</p>
          <div
            class="w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"
          ></div>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div class="flex flex-col items-center justify-center p-6 text-white">
          <p class="mb-4 text-center">${this.error}</p>
          <button
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
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
          <p class="text-lg font-semibold mb-2">No clan stats available.</p>
          <p class="text-sm text-gray-400">
            Once clans start playing games, their stats will appear here.
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
            <h2 class="text-xl font-semibold">Clan Leaderboard</h2>
            <p class="text-xs text-gray-400 mt-1">
              Stats window: ${startDate.toLocaleDateString()} &middot;
              ${endDate.toLocaleDateString()}
            </p>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full text-xs md:text-sm">
            <thead>
              <tr class="border-b border-gray-700 text-gray-300">
                <th class="py-2 pr-3 text-left">Clan</th>
                <th class="py-2 px-2 text-right">Games</th>
                <th class="py-2 px-2 text-right">Sessions</th>
                <th class="py-2 px-2 text-right">Weighted Wins</th>
                <th class="py-2 px-2 text-right">Weighted Losses</th>
                <th class="py-2 pl-2 text-right">Ratio</th>
              </tr>
            </thead>
            <tbody>
              ${clans.map(
                (clan) => html`
                  <tr class="border-b border-gray-800 last:border-b-0">
                    <td class="py-2 pr-3 font-semibold text-left">
                      ${clan.clanTag}
                    </td>
                    <td class="py-2 px-2 text-right">
                      ${clan.games.toLocaleString()}
                    </td>
                    <td class="py-2 px-2 text-right">
                      ${clan.playerSessions.toLocaleString()}
                    </td>
                    <td class="py-2 px-2 text-right">
                      ${clan.weightedWins.toFixed(2)}
                    </td>
                    <td class="py-2 px-2 text-right">
                      ${clan.weightedLosses.toFixed(2)}
                    </td>
                    <td class="py-2 pl-2 text-right">
                      ${clan.weightedRatio.toFixed(2)}
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
      <o-modal id="clan-leaderboard-modal" title="Clan Stats">
        ${this.renderBody()}
      </o-modal>
    `;
  }
}
