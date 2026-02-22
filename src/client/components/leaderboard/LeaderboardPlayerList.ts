import { html, LitElement } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { PlayerLeaderboardEntry } from "../../../core/ApiSchemas";
import { RankedType } from "../../../core/game/Game";
import { fetchPlayerLeaderboard, getUserMe } from "../../Api";
import { translateText } from "../../Utils";

@customElement("leaderboard-player-list")
export class LeaderboardPlayerList extends LitElement {
  @state() private playerData: PlayerLeaderboardEntry[] = [];
  @state() private currentUserEntry: PlayerLeaderboardEntry | null = null;
  @state() private showStickyUser = false;
  @state() private isLoading = false;
  @state() private error: string | null = null;
  @state() private isLoadingMore = false;
  @state() private loadMoreError: string | null = null;
  @state() private playerHasMore = true;

  private hasLoadedPlayers = false;
  private readonly playerPageSize = 50;
  private currentPage = 1;
  private currentUserId: string | null = null;
  private currentUserIdLoaded = false;

  @query(".virtualizer-container") private virtualizerContainer?: HTMLElement;

  createRenderRoot() {
    return this;
  }

  public async ensureLoaded() {
    if (this.hasLoadedPlayers || this.isLoading) return;
    await this.loadPlayerLeaderboard(true);
  }

  public async loadPlayerLeaderboard(reset = false) {
    if (reset) {
      this.currentPage = 1;
      this.playerHasMore = true;
      this.loadMoreError = null;
      this.playerData = [];
      this.currentUserEntry = null;
      this.showStickyUser = false;
    } else if (!this.playerHasMore) {
      return;
    }

    if (this.isLoading || this.isLoadingMore) return;

    if (reset) {
      this.isLoading = true;
      this.error = null;
    } else {
      this.isLoadingMore = true;
      this.loadMoreError = null;
    }

    try {
      const result = await fetchPlayerLeaderboard(this.currentPage);

      if (result === false) {
        throw new Error("Failed to load player leaderboard");
      }

      if (result === "reached_limit") {
        this.playerHasMore = false;
        this.hasLoadedPlayers = true;
        return;
      }

      const nextPlayers: PlayerLeaderboardEntry[] = result[
        RankedType.OneVOne
      ].map((entry) => ({
        rank: entry.rank,
        playerId: entry.public_id,
        username: entry.username,
        clanTag: entry.clanTag ?? undefined,
        elo: entry.elo,
        games: entry.total,
        wins: entry.wins,
        losses: entry.losses,
        winRate: entry.total > 0 ? entry.wins / entry.total : 0,
      }));

      const receivedCount = nextPlayers.length;
      if (reset) {
        this.playerData = nextPlayers;
      } else {
        const existingIds = new Set(
          this.playerData.map((player) => player.playerId),
        );
        const deduped = nextPlayers.filter(
          (player) => !existingIds.has(player.playerId),
        );
        this.playerData = [...this.playerData, ...deduped];
      }

      if (receivedCount > 0) {
        this.currentPage++;
      }

      if (receivedCount < this.playerPageSize) {
        this.playerHasMore = false;
      }

      if (reset && !this.currentUserIdLoaded) {
        this.currentUserIdLoaded = true;
        const userMe = await getUserMe();
        this.currentUserId = userMe ? userMe.player.publicId : null;
      }

      if (this.currentUserId && !this.currentUserEntry) {
        this.currentUserEntry =
          nextPlayers.find(
            (player) => player.playerId === this.currentUserId,
          ) ?? null;
      }

      this.hasLoadedPlayers = true;
      this.scheduleStickyVisibilityCheck();
      this.schedulePlayerFillCheck();
    } catch (err) {
      console.error("loadPlayerLeaderboard: request failed", err);
      if (reset) {
        this.error = translateText("leaderboard_modal.error");
      } else {
        this.loadMoreError = translateText("leaderboard_modal.error");
      }
    } finally {
      if (reset) {
        this.isLoading = false;
      } else {
        this.isLoadingMore = false;
      }
    }
  }

  public handleTabActivated() {
    this.scheduleStickyVisibilityCheck();
    this.schedulePlayerFillCheck();
  }

  // TODO: consider IntersectionObserver for better visibility detection?
  private isVisible() {
    return this.isConnected && this.getClientRects().length > 0;
  }

  private updateStickyVisibility() {
    if (!this.currentUserEntry) {
      this.showStickyUser = false;
      return;
    }

    if (!this.virtualizerContainer || !this.isVisible()) {
      this.showStickyUser = false;
      return;
    }

    const currentRow = this.virtualizerContainer.querySelector(
      '[data-current-user="true"]',
    ) as HTMLElement | null;

    if (!currentRow) {
      this.showStickyUser = true;
      return;
    }

    const containerRect = this.virtualizerContainer.getBoundingClientRect();
    const rowRect = currentRow.getBoundingClientRect();
    const isVisible =
      rowRect.top >= containerRect.top &&
      rowRect.bottom <= containerRect.bottom;
    this.showStickyUser = !isVisible;
  }

  private scheduleStickyVisibilityCheck() {
    void this.updateComplete.then(() => {
      requestAnimationFrame(() => this.updateStickyVisibility());
    });
  }

  private handleScroll() {
    this.updateStickyVisibility();
    this.maybeLoadMorePlayers();
  }

  private maybeLoadMorePlayers() {
    if (this.isLoading || this.isLoadingMore) return;
    if (!this.playerHasMore || this.error || this.loadMoreError) return;
    if (!this.virtualizerContainer || !this.isVisible()) return;

    const threshold = 64 * 3;
    const scrollTop = this.virtualizerContainer.scrollTop;
    const containerHeight = this.virtualizerContainer.clientHeight;
    const scrollHeight = this.virtualizerContainer.scrollHeight;
    const nearBottom = scrollTop + containerHeight >= scrollHeight - threshold;

    if (containerHeight === 0 || scrollHeight === 0) return; // guard

    if (nearBottom) {
      void this.loadPlayerLeaderboard();
    }
  }

  private schedulePlayerFillCheck() {
    if (!this.playerHasMore || this.error || this.loadMoreError) return;
    void this.updateComplete.then(() => this.maybeLoadMorePlayers());
  }

  private renderPlayerRow(player: PlayerLeaderboardEntry) {
    const isCurrentUser = this.currentUserEntry?.playerId === player.playerId;
    const displayRank = player.rank;
    const winRate = player.games > 0 ? player.wins / player.games : 0;

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
      <tr
        data-current-user=${isCurrentUser ? "true" : "false"}
        class="border-b border-white/5 hover:bg-white/[0.07] transition-colors group ${isCurrentUser
          ? "bg-blue-500/15"
          : ""}"
      >
        <td class="py-3 px-4 text-center">
          <div
            class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg ${rankColor}"
          >
            ${rankIcon}
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-2">
            ${player.clanTag
              ? html`<div
                  class="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-300 shrink-0"
                >
                  ${player.clanTag.replace(/^\[|\]$/g, "")}
                </div>`
              : ""}
            <span class="font-bold text-blue-300 truncate text-base"
              >${player.clanTag
                ? player.username.replace(/^\[.*?\]\s*/, "")
                : player.username}</span
            >
          </div>
        </td>
        <td class="py-3 px-4 text-right">
          <span class="font-mono text-white font-medium">${player.elo}</span>
          <span class="text-[10px] text-white/30 ml-1"
            >${translateText("leaderboard_modal.elo")}</span
          >
        </td>
        <td class="py-3 px-4 text-right">
          <span class="font-mono text-white font-medium">${player.games}</span>
          <span class="text-[10px] text-white/30 uppercase ml-1"
            >${translateText("leaderboard_modal.games")}</span
          >
        </td>
        <td class="py-3 px-4 text-right pr-6">
          <div class="inline-flex flex-col items-end">
            <span
              class="font-mono font-bold ${winRate >= 0.5
                ? "text-green-400"
                : "text-red-400"}"
              >${(winRate * 100).toFixed(1)}%</span
            >
            <span
              class="text-[10px] uppercase text-white/30 font-bold tracking-wider"
              >${translateText("leaderboard_modal.ratio")}</span
            >
          </div>
        </td>
      </tr>
    `;
  }

  private renderPlayerFooter() {
    if (this.isLoadingMore) {
      return html`
        <div class="flex items-center justify-center py-4 text-white/50">
          <div
            class="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mr-2"
          ></div>
          <span class="text-[10px] font-bold uppercase tracking-widest">
            ${translateText("leaderboard_modal.loading")}
          </span>
        </div>
      `;
    }

    if (this.loadMoreError) {
      return html`
        <div class="flex items-center justify-center py-4">
          <button
            class="px-6 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-xl text-xs font-bold uppercase transition-all active:scale-95"
            @click=${() => this.loadPlayerLeaderboard()}
          >
            ${translateText("leaderboard_modal.try_again")}
          </button>
        </div>
      `;
    }

    return "";
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
          @click=${() => this.loadPlayerLeaderboard(true)}
        >
          ${translateText("leaderboard_modal.try_again")}
        </button>
      </div>
    `;
  }

  render() {
    if (this.isLoading && this.playerData.length === 0)
      return this.renderLoading();
    if (this.error) return this.renderError();

    return html`
      <div class="h-full">
        <div
          class="h-full overflow-y-auto overflow-x-auto border border-white/5 bg-black/20 relative"
        >
          <div
            class="virtualizer-container h-full overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 ${this
              .showStickyUser
              ? "pb-20"
              : "pb-0"}"
            @scroll=${() => this.handleScroll()}
          >
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr
                  class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-white/2"
                >
                  <th class="py-4 px-4 text-center font-bold w-16">
                    ${translateText("leaderboard_modal.rank")}
                  </th>
                  <th class="py-4 px-4 text-left font-bold">
                    ${translateText("leaderboard_modal.player")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText("leaderboard_modal.elo")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold">
                    ${translateText("leaderboard_modal.games")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold pr-6">
                    ${translateText("leaderboard_modal.win_loss_ratio")}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${this.playerData.map((player) => this.renderPlayerRow(player))}
              </tbody>
            </table>
            ${this.renderPlayerFooter()}
          </div>
          ${this.currentUserEntry
            ? html`
                <div class="absolute inset-x-0 bottom-0 z-20">
                  <div
                    class="bg-blue-600/90 backdrop-blur-md border-t border-blue-400/30 py-4 px-6 shadow-2xl flex items-center transition-all duration-200 ${this
                      .showStickyUser
                      ? "opacity-100 translate-y-0"
                      : "opacity-0 translate-y-3 pointer-events-none"}"
                    aria-hidden=${this.showStickyUser ? "false" : "true"}
                  >
                    <div class="w-10 text-center">
                      <div
                        class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg bg-white/20 text-white"
                      >
                        ${this.currentUserEntry.rank}
                      </div>
                    </div>
                    <div class="flex-1 flex flex-col ml-4">
                      <span
                        class="text-[10px] uppercase font-bold text-blue-200/60 leading-tight"
                        >${translateText(
                          "leaderboard_modal.your_ranking",
                        )}</span
                      >
                      <span class="font-bold text-white text-base"
                        >${this.currentUserEntry.username}</span
                      >
                    </div>
                    <div class="flex flex-col items-end w-20">
                      <div class="font-mono text-white font-bold text-lg">
                        ${this.currentUserEntry.elo}
                        <span class="text-[10px] text-white/60"
                          >${translateText("leaderboard_modal.elo")}</span
                        >
                      </div>
                    </div>
                  </div>
                </div>
              `
            : ""}
        </div>
      </div>
    `;
  }
}
