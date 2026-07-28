import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { TribeLeaderboardResponse } from "../../../core/ApiSchemas";
import { fetchTribeLeaderboard } from "../../Api";
import { translateText } from "../../Utils";
import "../PlayerName";

// "2026-06-27" → "Jun 27". Date-only strings parse as UTC midnight, so
// formatting one straight through toLocaleDateString shifts the day back for
// browsers west of UTC; build the Date from the parts so it stays local.
// Returns null when the API serves something this can't read, letting the
// caller drop the caption rather than render "Invalid Date".
export function formatWindowDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [year, month, day] = [match[1], match[2], match[3]].map(Number);
  const date = new Date(year, month - 1, day);
  // Out-of-range parts roll over silently (month 13 becomes next January), so
  // check the parts survived rather than just that the date is not NaN.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function rankStyle(rank: number): { color: string; icon: string } {
  if (rank === 1) {
    return {
      color: "text-yellow-400 bg-yellow-400/10 ring-1 ring-yellow-400/20",
      icon: "👑",
    };
  }
  if (rank === 2) {
    return {
      color: "text-slate-300 bg-slate-400/10 ring-1 ring-slate-400/20",
      icon: "🥈",
    };
  }
  if (rank === 3) {
    return {
      color: "text-amber-600 bg-amber-600/10 ring-1 ring-amber-600/20",
      icon: "🥉",
    };
  }
  return { color: "text-white/40 bg-white/5", icon: String(rank) };
}

@customElement("leaderboard-tribe-table")
export class LeaderboardTribeTable extends LitElement {
  @state() private tribeData: TribeLeaderboardResponse | null = null;
  @state() private isLoading = false;
  @state() private error: string | null = null;

  private hasLoaded = false;

  createRenderRoot() {
    return this;
  }

  public async ensureLoaded() {
    if (this.hasLoaded || this.isLoading) return;
    await this.loadTribeLeaderboard();
  }

  public async loadTribeLeaderboard() {
    this.isLoading = true;
    this.error = null;

    try {
      const data = await fetchTribeLeaderboard();
      if (!data) throw new Error("Failed to load tribe leaderboard");

      this.tribeData = data;
      this.hasLoaded = true;
    } catch (error) {
      console.error("loadTribeLeaderboard: request failed", error);
      this.error = translateText("leaderboard_modal.error");
    } finally {
      this.isLoading = false;
    }
  }

  // Same handoff the ranked tab uses: the profile modal's back button reopens
  // the leaderboard.
  private openProfile(publicId: string) {
    document
      .querySelector<
        HTMLElement & { openFromLeaderboard(publicId: string): void }
      >("player-profile-modal")
      ?.openFromLeaderboard(publicId);
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
          @click=${() => this.loadTribeLeaderboard()}
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
          ${translateText("leaderboard_modal.tribes_no_stats")}
        </p>
      </div>
    `;
  }

  // "Rolling 30-day window (Jun 27 – Jul 27)" — the figures mean nothing
  // without the span they cover. Dropped entirely if the dates are unreadable.
  private renderWindow(data: TribeLeaderboardResponse) {
    const start = formatWindowDate(data.start);
    const end = formatWindowDate(data.end);
    if (start === null || end === null) return nothing;

    return html`
      <div
        class="px-4 py-2 text-[11px] text-white/40 border-b border-white/5 bg-black/20"
      >
        ${translateText("leaderboard_modal.tribes_window", {
          days: data.windowDays,
          start,
          end,
        })}
      </div>
    `;
  }

  render() {
    if (this.isLoading) return this.renderLoading();
    if (this.error) return this.renderError();
    if (!this.tribeData || this.tribeData.tribes.length === 0)
      return this.renderNoData();

    const { tribes } = this.tribeData;
    const maxReach = Math.max(...tribes.map((t) => t.playerReach), 1);

    return html`
      <div class="h-full">
        <div class="h-full border border-white/5 bg-black/20 flex flex-col">
          ${this.renderWindow(this.tribeData)}
          <div
            class="flex-1 min-h-0 overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-thumb-white/20"
          >
            <table class="w-full text-sm border-collapse table-fixed">
              <!-- Sized to keep Player Reach — the column the board is
                   ranked by — on screen at mobile widths rather than behind
                   a horizontal scroll. -->
              <colgroup>
                <col style="width: 3.5rem" />
                <col style="width: 8rem" />
                <col style="width: 4.5rem" />
                <col style="width: 7rem" />
              </colgroup>
              <thead class="sticky top-0 z-10">
                <tr
                  class="text-white/40 text-[10px] uppercase tracking-wider border-b border-white/5 bg-[#1e2433]"
                >
                  <th class="py-4 px-4 text-center font-bold">
                    ${translateText("leaderboard_modal.rank")}
                  </th>
                  <th class="py-4 px-4 text-left font-bold">
                    ${translateText("leaderboard_modal.tribes_name")}
                  </th>
                  <th class="py-4 px-4 text-right font-bold whitespace-nowrap">
                    ${translateText("leaderboard_modal.games")}
                  </th>
                  <th
                    class="py-4 px-4 text-right font-bold pr-6 whitespace-nowrap"
                    title=${translateText(
                      "leaderboard_modal.tribes_reach_tooltip",
                    )}
                  >
                    ${translateText("leaderboard_modal.tribes_reach")}
                  </th>
                </tr>
              </thead>
              <tbody>
                ${tribes.map((tribe) => {
                  const { color, icon } = rankStyle(tribe.rank);

                  return html`
                    <tr
                      class="border-b border-white/5 hover:bg-white/[0.07] transition-colors group"
                    >
                      <td class="py-3 px-4 text-center">
                        <div
                          class="w-10 h-10 mx-auto flex items-center justify-center rounded-lg font-bold font-mono text-lg ${color}"
                        >
                          ${icon}
                        </div>
                      </td>
                      <!-- Tribe name is primary, buyer secondary beneath it:
                           an Owner column would push Player Reach back off
                           screen on mobile. <player-name> owns the
                           username-or-publicId fallback. -->
                      <td class="py-3 px-4 wrap-break-words">
                        <div class="flex flex-col gap-0.5 min-w-0">
                          <span class="font-bold text-white">
                            ${tribe.name}
                          </span>
                          <player-name
                            class="min-w-0"
                            .username=${tribe.ownerUsername}
                            .publicId=${tribe.ownerPublicId}
                            .nameClass=${"text-[11px] text-white/50 hover:text-white/80 hover:underline transition-colors truncate text-left"}
                            .onNameClick=${() =>
                              this.openProfile(tribe.ownerPublicId)}
                          ></player-name>
                        </div>
                      </td>
                      <td
                        class="py-3 px-4 text-right font-mono text-white/80"
                        title=${translateText(
                          "leaderboard_modal.tribes_games_tooltip",
                          { count: tribe.gamesAppeared.toLocaleString() },
                        )}
                      >
                        ${tribe.gamesAppeared.toLocaleString()}
                      </td>
                      <td class="py-3 px-4 text-right pr-6">
                        <div class="flex flex-col items-end gap-1">
                          <span
                            class="text-white font-mono font-medium"
                            title=${translateText(
                              "leaderboard_modal.tribes_reach_value_tooltip",
                              { count: tribe.playerReach.toLocaleString() },
                            )}
                            >${tribe.playerReach.toLocaleString()}</span
                          >
                          <div
                            class="w-24 h-1 bg-white/10 rounded-full overflow-hidden"
                          >
                            <div
                              class="h-full bg-blue-500/50 rounded-full"
                              style="width: ${(tribe.playerReach / maxReach) *
                              100}%"
                            ></div>
                          </div>
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
