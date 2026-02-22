import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  ClanLeaderboardEntry,
  ClanLeaderboardResponse,
} from "../../../core/ApiSchemas";
import { fetchClanLeaderboard } from "../../Api";
import { translateText } from "../../Utils";

export type ClanSortColumn =
  | "rank"
  | "games"
  | "winScore"
  | "lossScore"
  | "ratio";
export type ClanSortOrder = "asc" | "desc";

@customElement("leaderboard-clan-table")
export class LeaderboardClanTable extends LitElement {
  @state() private clanData: ClanLeaderboardResponse | null = null;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private sortBy: ClanSortColumn = "rank";
  @state() private sortOrder: ClanSortOrder = "asc";

  private hasLoaded = false;

  createRenderRoot() {
    return this;
  }

  public async ensureLoaded() {
    if (this.hasLoaded || this.isLoading) return;
    await this.loadClanLeaderboard();
  }

  public async loadClanLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      const data = await fetchClanLeaderboard();
      if (!data) throw new Error("Failed to load clan leaderboard");

      this.clanData = data;
      this.hasLoaded = true;
      this.dispatchEvent(
        new CustomEvent<{ start: string; end: string }>("date-range-change", {
          detail: { start: data.start, end: data.end },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      console.error("loadClanLeaderboard: request failed", error);
      this.error = translateText("leaderboard_modal.error");
    } finally {
      this.isLoading = false;
    }
  }

  private handleSort(column: ClanSortColumn) {
    if (this.sortBy === column) {
      this.sortOrder = this.sortOrder === "asc" ? "desc" : "asc";
    } else {
      this.sortBy = column;
      this.sortOrder = column === "rank" ? "asc" : "desc";
    }
  }

  private getSortedClans(clans: ClanLeaderboardEntry[]) {
    if (this.sortBy === "rank") {
      const base = [...clans];
      return this.sortOrder === "asc" ? base : base.reverse();
    }

    const sorted = [...clans];
    sorted.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (this.sortBy) {
        case "games":
          aVal = a.games;
          bVal = b.games;
          break;
        case "winScore":
          aVal = a.weightedWins;
          bVal = b.weightedWins;
          break;
        case "lossScore":
          aVal = a.weightedLosses;
          bVal = b.weightedLosses;
          break;
        case "ratio":
          aVal = a.weightedWLRatio;
          bVal = b.weightedWLRatio;
          break;
        default:
          return 0;
      }
      return this.sortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }

  private renderLoading() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div
          class="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mb-6"
        ></div>
        <p class="text-blue-200/80 text-sm font-bold tracking-widest uppercase">
          ${translateText("leaderboard_modal.loading")}
        </p>
      </div>
    `;
  }

  private renderError() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white h-full"
      >
        <div
          class="bg-red-500/10 p-6 rounded-full mb-6 border border-red-500/20 shadow-lg shadow-red-500/10"
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
        <p class="mb-8 text-center text-red-100/80 font-medium">
          ${this.error ?? translateText("leaderboard_modal.error")}
        </p>
        <button
          class="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-sm font-bold uppercase transition-all active:scale-95"
          @click=${() => this.loadClanLeaderboard()}
        >
          ${translateText("leaderboard_modal.try_again")}
        </button>
      </div>
    `;
  }

  private renderNoData() {
    return html`
      <div
        class="flex flex-col items-center justify-center p-12 text-white/40 h-full"
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
          ${translateText("leaderboard_modal.no_data_yet")}
        </h3>
        <p class="text-white/30 text-sm">
          ${translateText("leaderboard_modal.no_stats")}
        </p>
      </div>
    `;
  }

  render() {
    if (this.isLoading) return this.renderLoading();
    if (this.error) return this.renderError();
    if (!this.clanData || this.clanData.clans.length === 0)
      return this.renderNoData();

    const { clans } = this.clanData;
    const sorted = this.getSortedClans(clans);
    const maxGames = Math.max(...clans.map((c) => c.games), 1);

    return html`
      <div class="h-full">
        <div class="h-full border border-white/5 bg-black/20">
          <div
            class="h-full overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/20"
          >
            <table class="w-full text-sm border-collapse table-fixed">
              <colgroup>
                <col style="width: 4rem" />
                <col />
                <col style="width: 8rem" />
                <col style="width: 6rem" />
                <col style="width: 6rem" />
                <col style="width: 6rem" />
              </colgroup>
              <thead class="sticky top-0 z-10">
                <tr
                  class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-[#1e2433]"
                >
                  <th class="py-4 px-4 text-center font-bold">
                    ${translateText("leaderboard_modal.rank")}
                  </th>
                  <th class="py-4 px-4 text-left font-bold">
                    ${translateText("leaderboard_modal.clan")}
                  </th>
                  <th
                    class="py-4 px-4 text-right font-bold cursor-pointer hover:text-white/60 transition-colors"
                  >
                    <button
                      class="whitespace-nowrap uppercase"
                      @click=${() => this.handleSort("games")}
                      aria-sort=${this.sortBy === "games"
                        ? this.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"}
                    >
                      ${translateText("leaderboard_modal.games")}
                      ${this.sortBy === "games"
                        ? this.sortOrder === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </button>
                  </th>
                  <th
                    class="py-4 px-4 text-right font-bold cursor-pointer hover:text-white/60 transition-colors"
                    title=${translateText(
                      "leaderboard_modal.win_score_tooltip",
                    )}
                  >
                    <button
                      class="whitespace-nowrap uppercase"
                      @click=${() => this.handleSort("winScore")}
                      aria-sort=${this.sortBy === "winScore"
                        ? this.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"}
                    >
                      ${translateText("leaderboard_modal.win_score")}
                      ${this.sortBy === "winScore"
                        ? this.sortOrder === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </button>
                  </th>
                  <th
                    class="py-4 px-4 text-right font-bold cursor-pointer hover:text-white/60 transition-colors"
                    title=${translateText(
                      "leaderboard_modal.loss_score_tooltip",
                    )}
                  >
                    <button
                      class="whitespace-nowrap uppercase"
                      @click=${() => this.handleSort("lossScore")}
                      aria-sort=${this.sortBy === "lossScore"
                        ? this.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"}
                    >
                      ${translateText("leaderboard_modal.loss_score")}
                      ${this.sortBy === "lossScore"
                        ? this.sortOrder === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </button>
                  </th>
                  <th
                    class="py-4 px-4 text-right font-bold pr-6 cursor-pointer hover:text-white/60 transition-colors"
                  >
                    <button
                      class="whitespace-nowrap uppercase"
                      @click=${() => this.handleSort("ratio")}
                      aria-sort=${this.sortBy === "ratio"
                        ? this.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"}
                    >
                      ${translateText("leaderboard_modal.win_loss_ratio")}
                      ${this.sortBy === "ratio"
                        ? this.sortOrder === "asc"
                          ? "↑"
                          : "↓"
                        : "↕"}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                ${sorted.map((clan, index) => {
                  const displayRank = index + 1;
                  const rankColor =
                    displayRank === 1
                      ? "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20"
                      : displayRank === 2
                        ? "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20"
                        : displayRank === 3
                          ? "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20"
                          : "text-white/40 bg-white/5";
                  const rankIcon =
                    displayRank === 1
                      ? "👑"
                      : displayRank === 2
                        ? "🥈"
                        : displayRank === 3
                          ? "🥉"
                          : String(displayRank);

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
                      <td class="py-3 px-4 font-bold text-blue-300">
                        <div
                          class="px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 inline-block"
                        >
                          ${clan.clanTag}
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
                        class="py-3 px-4 text-right font-mono text-green-400/90"
                      >
                        ${clan.weightedWins.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                      <td
                        class="py-3 px-4 text-right font-mono text-red-400/90"
                      >
                        ${clan.weightedLosses.toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}
                      </td>
                      <td class="py-3 px-4 text-right pr-6">
                        <div class="inline-flex flex-col items-end">
                          <span
                            class="font-mono font-bold ${clan.weightedWLRatio >=
                            1
                              ? "text-green-400"
                              : "text-red-400"}"
                            >${clan.weightedWLRatio.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}</span
                          >
                          <span
                            class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
                            >${translateText("leaderboard_modal.ratio")}</span
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
      </div>
    `;
  }
}
