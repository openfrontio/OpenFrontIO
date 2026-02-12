import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { BaseModal } from "./components/BaseModal";
import "./components/leaderboard/LeaderboardClanTable";
import type { LeaderboardClanTable } from "./components/leaderboard/LeaderboardClanTable";
import "./components/leaderboard/LeaderboardPlayerList";
import type { LeaderboardPlayerList } from "./components/leaderboard/LeaderboardPlayerList";
import "./components/leaderboard/LeaderboardTabs";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  @state() private activeTab: "players" | "clans" = "players";
  @state()
  private clanDateRange: { start: string; end: string } | null = null;

  @query("leaderboard-player-list")
  private playerList?: LeaderboardPlayerList;
  @query("leaderboard-clan-table")
  private clanTable?: LeaderboardClanTable;

  private loadToken = 0;

  protected onOpen(): void {
    this.loadActiveTabData();
  }

  private loadActiveTabData() {
    const token = ++this.loadToken;

    const run = async () => {
      if (token !== this.loadToken) return;

      if (this.activeTab === "players") {
        await this.playerList?.ensureLoaded();
        if (token !== this.loadToken) return;
        this.playerList?.handleTabActivated();
      } else {
        await this.clanTable?.ensureLoaded();
      }

      queueMicrotask(() => {
        if (token !== this.loadToken) return;
        if (this.activeTab === "players") void this.clanTable?.ensureLoaded();
        else void this.playerList?.ensureLoaded();
      });
    };

    void (async () => {
      if (!(this.activeTab === "players" ? this.playerList : this.clanTable)) {
        await this.updateComplete;
      }
      await run();
    })();
  }

  private handleTabChange(tab: "clans" | "players") {
    this.activeTab = tab;
    this.loadActiveTabData();
  }

  private handleClanDateRangeChange(
    event: CustomEvent<{ start: string; end: string }>,
  ) {
    this.clanDateRange = event.detail;
  }

  render() {
    let dateRange = html``;
    if (this.clanDateRange) {
      const start = new Date(this.clanDateRange.start).toLocaleDateString();
      const end = new Date(this.clanDateRange.end).toLocaleDateString();
      dateRange = html`<span
        class="text-sm font-normal text-white/40 ml-2 wrap-break-words"
        >(${start} - ${end})</span
      >`;
    }
    const refreshTime = html`<span
      class="text-sm font-normal text-white/40 ml-2 wrap-break-words italic"
      >(${translateText("leaderboard_modal.refresh_time")})</span
    >`;

    const content = html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          titleContent: html`
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="text-white text-xl sm:text-2xl font-bold uppercase tracking-widest"
              >
                ${translateText("leaderboard_modal.title")}
              </span>
              ${this.activeTab === "clans" ? dateRange : ""}
              ${this.activeTab === "players" ? refreshTime : ""}
            </div>
          `,
          onBack: () => this.close(),
          ariaLabel: translateText("common.close"),
        })}

        <div class="flex-1 flex flex-col min-h-0">
          <leaderboard-tabs
            .activeTab=${this.activeTab}
            @tab-change=${(event: CustomEvent<"players" | "clans">) =>
              this.handleTabChange(event.detail)}
          ></leaderboard-tabs>
          <div class="flex-1 min-h-0">
            <leaderboard-player-list
              class=${this.activeTab === "players" ? "h-full" : "hidden"}
            ></leaderboard-player-list>
            <leaderboard-clan-table
              class=${this.activeTab === "clans" ? "h-full" : "hidden"}
              @date-range-change=${(
                event: CustomEvent<{ start: string; end: string }>,
              ) => this.handleClanDateRangeChange(event)}
            ></leaderboard-clan-table>
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
