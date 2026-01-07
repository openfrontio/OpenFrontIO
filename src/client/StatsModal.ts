import { html, LitElement } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import {
  ClanLeaderboardResponse,
  ClanLeaderboardResponseSchema,
} from "../core/ApiSchemas";
import { getApiBase } from "./Api";
import { translateText } from "./Utils";

@customElement("stats-modal")
export class StatsModal extends LitElement {
  @property({ type: Boolean }) inline = false;
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
    if (this.inline) {
      if ((window as any).showPage) {
        (window as any).showPage("page-play");
      }
    } else {
      this.modalEl?.close();
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
            Try Again
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
          <h3 class="text-xl font-bold text-white/60 mb-2">No Data Yet</h3>
          <p class="text-white/30 text-sm max-w-[200px]">
            ${translateText("stats_modal.no_stats")}
          </p>
        </div>
      `;
    }

    const { clans } = this.data;
    const maxGames = Math.max(...clans.map((c) => c.games), 1);

    return html`
      <div class="w-full">
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
                <th class="py-4 px-4 text-right font-bold w-32">
                  ${translateText("stats_modal.games")}
                </th>
                <th
                  class="py-4 px-4 text-right font-bold hidden md:table-cell"
                  title=${translateText("stats_modal.win_score_tooltip")}
                >
                  ${translateText("stats_modal.win_score")}
                </th>
                <th
                  class="py-4 px-4 text-right font-bold hidden md:table-cell"
                  title=${translateText("stats_modal.loss_score_tooltip")}
                >
                  ${translateText("stats_modal.loss_score")}
                </th>
                <th class="py-4 px-4 text-right font-bold pr-6">
                  ${translateText("stats_modal.win_loss_ratio")}
                </th>
              </tr>
            </thead>
            <tbody>
              ${clans.map((clan, index) => {
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
                        : "#" + (index + 1);

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
                          >Ratio</span
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
    let summaryTags = html``;
    if (this.data) {
      const start = new Date(this.data.start).toLocaleDateString();
      const end = new Date(this.data.end).toLocaleDateString();
      dateRange = html`<span class="text-sm font-normal text-white/40 ml-2"
        >(${start} - ${end})</span
      >`;
      summaryTags = html`
        <div class="flex flex-row gap-6 items-center ml-auto">
          <span class="text-xs text-white/40 uppercase tracking-wider font-bold"
            >Total Clans</span
          >
          <span class="text-xl font-bold text-white font-mono"
            >${this.data.clans.length}</span
          >
        </div>
      `;
    }

    const content = html`
      <div
        class="h-full flex flex-col ${this.inline
          ? "bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shadow-xl"
          : ""}"
      >
        <div
          class="flex items-center mb-6 pb-2 border-b border-white/10 gap-2 shrink-0 p-6"
        >
          <div class="flex items-center gap-4 flex-1">
            <button
              @click=${this.close}
              class="group flex items-center justify-center w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 transition-all border border-white/10"
              aria-label="Back"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-5 h-5 text-gray-400 group-hover:text-white transition-colors"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <div class="flex items-center gap-2">
              <span
                class="text-white text-xl sm:text-2xl md:text-3xl font-bold uppercase tracking-widest"
              >
                ${translateText("stats_modal.clan_stats")}
              </span>
              ${dateRange}
            </div>
          </div>
          ${summaryTags}
        </div>

        <div
          class="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-white/20 scrollbar-track-transparent px-6 pb-6"
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
