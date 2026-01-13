import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  ClanLeaderboardEntry,
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase } from "./Api";
import { translateText } from "./Utils";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";

@customElement("stats-modal")
export class StatsModal extends BaseModal {
  @state() private isLoading: boolean = false;
  @state() private error: string | null = null;
  @state() private data: ClanLeaderboardResponse | null = null;
  @state() private sortBy: "rank" | "games" | "wins" | "losses" | "ratio" =
    "rank";
  @state() private sortOrder: "asc" | "desc" = "asc";

  private hasLoaded = false;

  private handleSort(column: "rank" | "games" | "wins" | "losses" | "ratio") {
    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = column;
      this.sortOrder = column === "rank" ? "asc" : "desc";
    }
    this.requestUpdate();
  }

  private getSortedClans(clans: ClanLeaderboardEntry[]) {
    const sorted = [...clans];
    sorted.sort((a, b) => {
      let aVal: number, bVal: number;

      switch (this.sortBy) {
        case "games":
          aVal = a.games;
          bVal = b.games;
          break;
        case "wins":
          aVal = a.weightedWins;
          bVal = b.weightedWins;
          break;
        case "losses":
          aVal = a.weightedLosses;
          bVal = b.weightedLosses;
          break;
        case "ratio":
          aVal = a.weightedWLRatio;
          bVal = b.weightedWLRatio;
          break;
        case "rank":
        default:
          // Original order
          return 0;
      }

      return this.sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });

    return sorted;
  }

  protected onOpen(): void {
    if (!this.hasLoaded && !this.isLoading) {
      void this.loadLeaderboard();
    }
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
        <div
          class="flex flex-col items-center justify-center p-12 text-white h-full"
        >
          <div
            class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-6"
          ></div>
          <p
            class="text-blue-200/80 text-sm font-bold tracking-[0.2em] uppercase"
          >
            ${translateText("stats_modal.loading")}
          </p>
        </div>
      `;
    }

    if (this.error) {
      return html`
        <div
          class="flex flex-col items-center justify-center p-12 text-white h-full"
        >
          <div
            class="bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-12 w-12 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <p class="mb-8 text-center text-red-100/80 max-w-xs font-medium">
            ${this.error}
          </p>
          <button
            class="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 text-red-200 rounded-xl text-sm font-bold uppercase tracking-wider transition-all cursor-pointer hover:shadow-lg hover:shadow-red-500/10 active:scale-95"
            @click=${() => this.loadLeaderboard()}
          >
            ${translateText("stats_modal.try_again")}
          </button>
        </div>
      `;
    }

    if (!this.data || this.data.clans.length === 0) {
      return html`
        <div
          class="p-12 text-center text-white/40 flex flex-col items-center h-full justify-center"
        >
          <div class="bg-white/5 p-6 rounded-full mb-6 border border-white/5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-16 w-16 text-white/20"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1"
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <h3 class="text-xl font-bold text-white/60 mb-2">
            ${translateText("stats_modal.no_data_yet")}
          </h3>
          <p class="text-white/30 text-sm max-w-[200px]">
            ${translateText("stats_modal.no_stats")}
          </p>
        </div>
      `;
    }

    const { clans } = this.data;
    const maxGames = Math.max(...clans.map((c) => c.games), 1);

    return html`
      <div class="w-full pt-2">
        <div
          class="overflow-x-auto rounded-xl border border-white/5 bg-black/20"
        >
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr
                class="text-white/40 text-xs uppercase tracking-wider border-b border-white/5 bg-white/[0.02]"
              >
                <th class="py-4 px-4 text-center font-bold w-16">
                  ${translateText("stats_modal.rank")}
                </th>
                <th class="py-4 px-4 text-left font-bold">
                  ${translateText("stats_modal.clan")}
                </th>
                <th
                  @click=${() => this.handleSort("games")}
                  class="py-4 px-4 text-right font-bold w-32 cursor-pointer hover:text-white/60 transition-colors select-none"
                >
                  <div class="flex items-center justify-end gap-1">
                    ${translateText("stats_modal.games")}
                    ${this.sortBy === "games"
                      ? this.sortOrder === "asc"
                        ? html`<span class="text-blue-400">↑</span>`
                        : html`<span class="text-blue-400">↓</span>`
                      : html`<span class="text-white/20">↕</span>`}
                  </div>
                </th>
                <th
                  @click=${() => this.handleSort("wins")}
                  class="py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors select-none"
                  title=${translateText("stats_modal.win_score_tooltip")}
                >
                  <div class="flex items-center justify-end gap-1">
                    ${translateText("stats_modal.win_score")}
                    ${this.sortBy === "wins"
                      ? this.sortOrder === "asc"
                        ? html`<span class="text-blue-400">↑</span>`
                        : html`<span class="text-blue-400">↓</span>`
                      : html`<span class="text-white/20">↕</span>`}
                  </div>
                </th>
                <th
                  @click=${() => this.handleSort("losses")}
                  class="py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors select-none"
                  title=${translateText("stats_modal.loss_score_tooltip")}
                >
                  <div class="flex items-center justify-end gap-1">
                    ${translateText("stats_modal.loss_score")}
                    ${this.sortBy === "losses"
                      ? this.sortOrder === "asc"
                        ? html`<span class="text-blue-400">↑</span>`
                        : html`<span class="text-blue-400">↓</span>`
                      : html`<span class="text-white/20">↕</span>`}
                  </div>
                </th>
                <th
                  @click=${() => this.handleSort("ratio")}
                  class="py-4 px-4 text-right font-bold pr-6 cursor-pointer hover:text-white/60 transition-colors select-none"
                >
                  <div class="flex items-center justify-end gap-1">
                    ${translateText("stats_modal.win_loss_ratio")}
                    ${this.sortBy === "ratio"
                      ? this.sortOrder === "asc"
                        ? html`<span class="text-blue-400">↑</span>`
                        : html`<span class="text-blue-400">↓</span>`
                      : html`<span class="text-white/20">↕</span>`}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              ${this.getSortedClans(clans).map((clan, index) => {
                const rankColor =
                  index === 0
                    ? "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20"
                    : index === 1
                      ? "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20"
                      : index === 2
                        ? "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20"
                        : "text-white/40 bg-white/5";

                const rankIcon =
                  index === 0
                    ? "👑"
                    : index === 1
                      ? "🥈"
                      : index === 2
                        ? "🥉"
                        : String(index + 1);

                return html`
                  <tr
                    class="border-b border-white/5 hover:bg-white/[0.07] transition-colors group"
                  >
                    <td class="py-3 px-4 text-center">
                      <div
                        class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg ${rankColor}"
                      >
                        ${rankIcon}
                      </div>
                    </td>
                    <td class="py-3 px-4">
                      <div class="flex items-center gap-3">
                        <div
                          class="px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 font-bold text-xs tracking-wide group-hover:bg-blue-500/20 transition-colors"
                        >
                          ${clan.clanTag}
                        </div>
                      </div>
                    </td>
                    <td class="py-3 px-4 text-right">
                      <div class="flex flex-col items-end gap-1">
                        <span class="text-white font-mono font-medium"
                          >${clan.games.toLocaleString()}</span
                        >
                        <div
                          class="w-24 h-1 bg-white/10 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500/50 rounded-full"
                            style="width: ${(clan.games / maxGames) * 100}%"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td
                      class="py-3 px-4 text-right font-mono text-green-400/90 hidden md:table-cell"
                    >
                      ${clan.weightedWins}
                    </td>
                    <td
                      class="py-3 px-4 text-right font-mono text-red-400/90 hidden md:table-cell"
                    >
                      ${clan.weightedLosses}
                    </td>
                    <td class="py-3 px-4 text-right pr-6">
                      <div class="inline-flex flex-col items-end">
                        <span
                          class="font-mono font-bold ${Number(
                            clan.weightedWLRatio,
                          ) >= 1
                            ? "text-green-400"
                            : "text-red-400"}"
                        >
                          ${clan.weightedWLRatio}
                        </span>
                        <span
                          class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
                          >${translateText("stats_modal.ratio")}</span
                        >
                      </div>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  render() {
    let dateRange = html``;
    if (this.data) {
      const start = new Date(this.data.start).toLocaleDateString();
      const end = new Date(this.data.end).toLocaleDateString();
      dateRange = html`<span
        class="text-sm font-normal text-white/40 ml-2 break-words"
        >(${start} - ${end})</span
      >`;
    }

    const content = html`
      <div
        class="h-full flex flex-col bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden"
      >
        ${modalHeader({
          titleContent: html`
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest break-words hyphens-auto"
              >
                ${translateText("stats_modal.clan_stats")}
              </span>
              ${dateRange}
            </div>
          `,
          onBack: this.close,
          ariaLabel: translateText("common.close"),
          leftClassName: "flex flex-wrap items-center gap-4 flex-1",
        })}

        <div
          class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent px-6 pb-6 mr-1"
        >
          ${this.renderBody()}
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal
        id="stats-modal"
        title="${translateText("stats_modal.clan_stats")}"
        ?inline=${this.inline}
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }
}
