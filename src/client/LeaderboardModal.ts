import { virtualize } from "@lit-labs/virtualizer/virtualize.js";
import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  ClanLeaderboardEntry,
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
  PlayerLeaderboardEntry,
  RankedLeaderboardResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase, getUserMe } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  @state() private activeTab: "players" | "clans" = "players";
  @state() private isLoading: boolean = false;
  @state() private error: string | null = null;

  // Clan data
  @state() private clanData: ClanLeaderboardResponse | null = null;
  @state() private clanSortBy: "rank" | "games" | "wins" | "losses" | "ratio" =
    "rank";
  @state() private clanSortOrder: "asc" | "desc" = "asc";

  // Player data
  @state() private playerData: PlayerLeaderboardEntry[] = [];
  @state() private currentUserEntry: PlayerLeaderboardEntry | null = null;
  @state() private showStickyUser: boolean = false;

  // Set this to true to pick a random player as the current user for testing sticky bars/highlighting
  private testRandomUser: boolean = false;

  private hasLoadedClans = false;
  private hasLoadedPlayers = false;

  @query(".virtualizer-container") private virtualizerContainer?: HTMLElement;

  protected onOpen(): void {
    this.loadActiveTabData();
  }

  private loadActiveTabData() {
    if (this.activeTab === "clans" && !this.hasLoadedClans) {
      void this.loadClanLeaderboard();
    } else if (this.activeTab === "players" && !this.hasLoadedPlayers) {
      void this.loadPlayerLeaderboard();
    }
  }

  private async loadClanLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`Unexpected status ${res.status}`);

      const json = await res.json();
      const parsed = ClanLeaderboardResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Invalid response format");

      this.clanData = parsed.data;
      this.hasLoadedClans = true;
    } catch {
      this.error = translateText("leaderboard_modal.error");
    } finally {
      this.isLoading = false;
    }
  }

  private async loadPlayerLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      const res = await fetch(`${getApiBase()}/leaderboard/ranked`, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`Unexpected status ${res.status}`);

      const json = await res.json();
      const parsed = RankedLeaderboardResponseSchema.safeParse(json);
      if (!parsed.success) throw new Error("Invalid response format");

      this.playerData = parsed.data["1v1"].map((entry) => {
        const games = entry.total;
        return {
          rank: Number.parseInt(entry.rank, 10),
          playerId: entry.public_id,
          username: entry.username,
          clanTag: entry.clanTag ?? undefined,
          elo: entry.elo,
          games,
          wins: entry.wins,
          losses: entry.losses,
          winRate: games > 0 ? entry.wins / games : 0,
        };
      });

      this.currentUserEntry = null;
      const userMe = await getUserMe();
      if (userMe) {
        const myId = userMe.player.publicId;
        this.currentUserEntry =
          this.playerData.find((player) => player.playerId === myId) ?? null;
      }

      // If test mode is enabled, override the current user with a random player from the list
      if (this.testRandomUser && this.playerData.length > 0) {
        const randomIndex = Math.floor(Math.random() * this.playerData.length);
        this.currentUserEntry = { ...this.playerData[randomIndex] };
        console.log(
          `[LeaderboardTest] Selected random user: ${this.currentUserEntry.username} (Rank ${this.currentUserEntry.rank})`,
        );
      }

      this.hasLoadedPlayers = true;
      this.updateStickyVisibility();
    } catch {
      this.error = translateText("leaderboard_modal.error");
    } finally {
      this.isLoading = false;
    }
  }

  private handleTabChange(tab: "clans" | "players") {
    this.activeTab = tab;
    this.error = null;
    this.loadActiveTabData();
  }

  private handleClanSort(
    column: "rank" | "games" | "wins" | "losses" | "ratio",
  ) {
    if (this.clanSortBy === column) {
      this.clanSortOrder = this.clanSortOrder === "asc" ? "desc" : "asc";
    } else {
      this.clanSortBy = column;
      this.clanSortOrder = column === "rank" ? "asc" : "desc";
    }
  }

  private getSortedClans(clans: ClanLeaderboardEntry[]) {
    const sorted = [...clans];
    sorted.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (this.clanSortBy) {
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
        default:
          return 0;
      }
      return this.clanSortOrder === "asc" ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }

  private updateStickyVisibility() {
    if (!this.currentUserEntry || this.activeTab !== "players") {
      this.showStickyUser = false;
      return;
    }

    if (!this.virtualizerContainer) {
      this.showStickyUser = true;
      return;
    }

    const index = this.playerData.findIndex(
      (p) => p.playerId === this.currentUserEntry?.playerId,
    );
    if (index === -1) {
      this.showStickyUser = true;
      return;
    }

    const scrollTop = this.virtualizerContainer.scrollTop;
    const containerHeight = this.virtualizerContainer.clientHeight;
    // Row height is roughly 64px (py-3 (12px * 2) + font height + borders)
    const rowHeight = 64;
    const myPos = index * rowHeight;

    const isVisible =
      myPos >= scrollTop && myPos + rowHeight <= scrollTop + containerHeight;
    this.showStickyUser = !isVisible;
  }

  private handleScroll() {
    this.updateStickyVisibility();
  }

  private renderTabs() {
    const tabClass = (active: boolean) => `
      px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wider transition-all cursor-pointer select-none
      ${active ? "bg-blue-600 text-white" : "text-white/40 hover:text-white/60 hover:bg-white/5"}
    `;

    return html`
      <div
        class="flex gap-2 p-1 bg-white/5 rounded-full border border-white/10 mb-6 w-fit mx-auto mt-4"
      >
        <div
          class="${tabClass(this.activeTab === "players")}"
          @click=${() => this.handleTabChange("players")}
        >
          ${translateText("leaderboard_modal.ranked_tab")}
        </div>
        <div
          class="${tabClass(this.activeTab === "clans")}"
          @click=${() => this.handleTabChange("clans")}
        >
          ${translateText("leaderboard_modal.clans_tab")}
        </div>
      </div>
    `;
  }

  private renderClanLeaderboard() {
    if (this.isLoading) return this.renderLoading();
    if (this.error) return this.renderError();
    if (!this.clanData || this.clanData.clans.length === 0)
      return this.renderNoData();

    const { clans } = this.clanData;
    const sorted = this.getSortedClans(clans);
    const maxGames = Math.max(...clans.map((c) => c.games), 1);

    return html`
      <div
        class="overflow-x-auto rounded-xl border border-white/5 bg-black/20 mx-6 mb-6"
      >
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr
              class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-white/[0.02]"
            >
              <th class="py-4 px-4 text-center font-bold w-16">
                ${translateText("leaderboard_modal.rank")}
              </th>
              <th class="py-4 px-4 text-left font-bold">
                ${translateText("leaderboard_modal.clan")}
              </th>
              <th
                @click=${() => this.handleClanSort("games")}
                class="py-4 px-4 text-right font-bold w-32 cursor-pointer hover:text-white/60 transition-colors"
              >
                ${translateText("leaderboard_modal.games")}
                ${this.clanSortBy === "games"
                  ? this.clanSortOrder === "asc"
                    ? "↑"
                    : "↓"
                  : "↕"}
              </th>
              <th
                @click=${() => this.handleClanSort("wins")}
                class="py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors"
                title=${translateText("leaderboard_modal.win_score_tooltip")}
              >
                ${translateText("leaderboard_modal.win_score")}
                ${this.clanSortBy === "wins"
                  ? this.clanSortOrder === "asc"
                    ? "↑"
                    : "↓"
                  : "↕"}
              </th>
              <th
                @click=${() => this.handleClanSort("losses")}
                class="py-4 px-4 text-right font-bold hidden md:table-cell cursor-pointer hover:text-white/60 transition-colors"
                title=${translateText("leaderboard_modal.loss_score_tooltip")}
              >
                ${translateText("leaderboard_modal.loss_score")}
                ${this.clanSortBy === "losses"
                  ? this.clanSortOrder === "asc"
                    ? "↑"
                    : "↓"
                  : "↕"}
              </th>
              <th
                @click=${() => this.handleClanSort("ratio")}
                class="py-4 px-4 text-right font-bold pr-6 cursor-pointer hover:text-white/60 transition-colors"
              >
                ${translateText("leaderboard_modal.win_loss_ratio")}
                ${this.clanSortBy === "ratio"
                  ? this.clanSortOrder === "asc"
                    ? "↑"
                    : "↓"
                  : "↕"}
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
                        class="font-mono font-bold ${clan.weightedWLRatio >= 1
                          ? "text-green-400"
                          : "text-red-400"}"
                        >${clan.weightedWLRatio}</span
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
    `;
  }

  private renderPlayerRow(player: PlayerLeaderboardEntry) {
    const isCurrentUser = this.currentUserEntry?.playerId === player.playerId;
    const displayRank = player.rank;

    const rankColor =
      {
        1: "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20",
        2: "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20",
        3: "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20",
      }?.[displayRank] ?? "text-white/40 bg-white/5";

    const rankIcon =
      {
        1: "👑",
        2: "🥈",
        3: "🥉",
      }?.[displayRank] ?? String(displayRank);

    return html`
      <div
        class="flex items-center border-b border-white/5 py-3 px-6 hover:bg-white/[0.07] transition-colors w-full ${isCurrentUser
          ? "bg-blue-500/15 border-l-4 border-l-blue-500 pl-5"
          : ""}"
      >
        <div class="w-16 shrink-0 text-center">
          <div
            class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg ${rankColor}"
          >
            ${rankIcon}
          </div>
        </div>
        <div class="flex-1 flex items-center gap-3 overflow-hidden ml-4">
          <span class="font-bold text-blue-300 truncate text-base"
            >${player.username}</span
          >
          ${player.clanTag
            ? html`<div
                class="px-2.5 py-1 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-300 shrink-0"
              >
                ${player.clanTag}
              </div>`
            : ""}
        </div>
        <div class="flex flex-col items-end gap-1 w-32">
          <div class="text-right font-mono text-white font-medium">
            ${player.elo}
            <span class="text-[10px] text-white/30 truncate"
              >${translateText("leaderboard_modal.elo")}</span
            >
          </div>
        </div>
        <div class="flex-col items-end gap-1 w-32 hidden md:flex">
          <div class="text-right font-mono text-white font-medium">
            ${player.games}
            <span class="text-[10px] text-white/30 uppercase"
              >${translateText("leaderboard_modal.games")}</span
            >
          </div>
        </div>
        <div class="inline-flex flex-col items-end pr-6 w-32">
          <span
            class="font-mono font-bold ${player.winRate >= 0.5
              ? "text-green-400"
              : "text-red-400"}"
            >${(player.winRate * 100).toFixed(1)}%</span
          >
          <span
            class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
            >${translateText("leaderboard_modal.ratio")}</span
          >
        </div>
      </div>
    `;
  }

  private renderPlayerLeaderboard() {
    if (this.isLoading) return this.renderLoading();
    if (this.error) return this.renderError();

    return html`
      <div class="flex flex-col h-full overflow-hidden">
        <div
          class="flex items-center text-[10px] uppercase tracking-wider text-white/40 font-bold px-6 py-4 border-b border-white/5 bg-white/2"
        >
          <div class="w-16 text-center">
            ${translateText("leaderboard_modal.rank")}
          </div>
          <div class="flex-1 ml-4">
            ${translateText("leaderboard_modal.player")}
          </div>
          <div class="w-32 text-right">
            ${translateText("leaderboard_modal.elo")}
          </div>
          <div class="w-32 text-right hidden md:block">
            ${translateText("leaderboard_modal.games")}
          </div>
          <div class="w-32 text-right pr-6">
            ${translateText("leaderboard_modal.win_loss_ratio")}
          </div>
        </div>
        <div
          class="virtualizer-container flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20"
          @scroll=${() => this.handleScroll()}
        >
          ${virtualize({
            items: this.playerData,
            renderItem: (p) => this.renderPlayerRow(p),
            scroller: true,
          })}
        </div>
        ${this.showStickyUser && this.currentUserEntry
          ? html`
              <div
                class="bg-blue-600/90 backdrop-blur-md border-t border-blue-400/30 py-4 px-6 shadow-2xl flex items-center animate-in slide-in-from-bottom duration-300"
              >
                <div class="w-16 text-center">
                  <div
                    class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg bg-white/20 text-white"
                  >
                    ${this.currentUserEntry.rank}
                  </div>
                </div>
                <div class="flex-1 flex flex-col ml-4">
                  <span
                    class="text-[10px] uppercase font-bold text-blue-200/60 leading-tight"
                    >${translateText("leaderboard_modal.your_ranking")}</span
                  >
                  <span class="font-bold text-white text-base"
                    >${this.currentUserEntry.username}</span
                  >
                </div>
                <div class="flex flex-col items-end w-32">
                  <div class="font-mono text-white font-bold text-lg">
                    ${this.currentUserEntry.elo}
                    <span class="text-[10px] text-white/60"
                      >${translateText("leaderboard_modal.elo")}</span
                    >
                  </div>
                </div>
              </div>
            `
          : ""}
      </div>
    `;
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
          ${this.error}
        </p>
        <button
          class="px-8 py-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-sm font-bold uppercase transition-all active:scale-95"
          @click=${() => this.loadActiveTabData()}
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
    let dateRange = html``;
    if (this.clanData) {
      const start = new Date(this.clanData.start).toLocaleDateString();
      const end = new Date(this.clanData.end).toLocaleDateString();
      dateRange = html`<span
        class="text-sm font-normal text-white/40 ml-2 wrap-break-words"
        >(${start} - ${end})</span
      >`;
    }

    const content = html`
      <div
        class="h-full flex flex-col bg-black/80 backdrop-blur-xl rounded-2xl border border-white/10 overflow-hidden shadow-2xl"
      >
        ${modalHeader({
          titleContent: html`
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="text-white text-xl sm:text-2xl font-bold uppercase tracking-widest"
              >
                ${translateText("leaderboard_modal.title_plural")}
              </span>
              ${this.activeTab === "clans" ? dateRange : ""}
            </div>
          `,
          onBack: this.close,
          ariaLabel: translateText("common.close"),
        })}

        <div class="flex-1 flex flex-col min-h-0">
          ${this.renderTabs()}
          <div class="flex-1 min-h-0">
            ${this.activeTab === "players"
              ? this.renderPlayerLeaderboard()
              : this.renderClanLeaderboard()}
          </div>
        </div>
      </div>
    `;

    if (this.inline) return content;

    return html`
      <o-modal
        id="leaderboard-modal"
        ?inline=${this.inline}
        hideCloseButton
        hideHeader
      >
        ${content}
      </o-modal>
    `;
  }
}
