import { html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { RankedType } from "../core/game/Game";
import { BaseModal } from "./components/BaseModal";
import "./components/leaderboard/LeaderboardClanTable";
import type { LeaderboardClanTable } from "./components/leaderboard/LeaderboardClanTable";
import "./components/leaderboard/LeaderboardPlayerList";
import type { LeaderboardPlayerList } from "./components/leaderboard/LeaderboardPlayerList";
import "./components/leaderboard/LeaderboardTribeTable";
import type { LeaderboardTribeTable } from "./components/leaderboard/LeaderboardTribeTable";
import { modalHeader } from "./components/ui/ModalHeader";
import { translateText } from "./Utils";

const TAB_KEYS = ["players", "players2v2", "clans", "tribes"] as const;

// Tab key -> ladder. "players" predates the 2v2 ladder and stays the 1v1 tab
// so existing `#modal=leaderboard&tab=players` links keep working. Both tabs
// share one <leaderboard-player-list>: a page fetch returns both ladders.
const PLAYER_TABS: Record<string, RankedType> = {
  players: RankedType.OneVOne,
  players2v2: RankedType.TwoVTwo,
};

@customElement("leaderboard-modal")
export class LeaderboardModal extends BaseModal {
  protected routerName = "leaderboard";

  @state()
  private clanDateRange: { start: string; end: string } | null = null;

  @query("leaderboard-player-list")
  private playerList?: LeaderboardPlayerList;
  @query("leaderboard-clan-table")
  private clanTable?: LeaderboardClanTable;
  @query("leaderboard-tribe-table")
  private tribeTable?: LeaderboardTribeTable;

  private loadToken = 0;
  private lastRankedType: RankedType = RankedType.OneVOne;

  protected modalConfig() {
    return {
      tabs: [
        {
          key: "players",
          label: translateText("leaderboard_modal.ranked_tab"),
        },
        {
          key: "players2v2",
          label: translateText("leaderboard_modal.ranked_2v2_tab"),
        },
        { key: "clans", label: translateText("leaderboard_modal.clans_tab") },
        { key: "tribes", label: translateText("leaderboard_modal.tribes_tab") },
      ],
    };
  }

  private rankedTypeFor(tab: string): RankedType | null {
    return PLAYER_TABS[tab] ?? null;
  }

  private tabComponent(tab: string) {
    if (this.rankedTypeFor(tab) !== null) return this.playerList;
    if (tab === "clans") return this.clanTable;
    return this.tribeTable;
  }

  protected onOpen(): void {
    this.loadActiveTabData();
  }

  protected onTabEnter(): void {
    // The player list is one element shared by both ladder tabs, so it needs a
    // ranked type even while another tab is up: keep showing the last one.
    this.lastRankedType =
      this.rankedTypeFor(this.activeTab) ?? this.lastRankedType;
    this.loadActiveTabData();
  }

  private loadActiveTabData() {
    const token = ++this.loadToken;

    const active = this.activeTab;

    const run = async () => {
      if (token !== this.loadToken) return;

      if (this.rankedTypeFor(active) !== null) {
        await this.playerList?.ensureLoaded();
        if (token !== this.loadToken) return;
        this.playerList?.handleTabActivated();
      } else {
        await this.tabComponent(active)?.ensureLoaded();
      }

      queueMicrotask(() => {
        if (token !== this.loadToken) return;
        for (const key of TAB_KEYS) {
          if (key !== active) void this.tabComponent(key)?.ensureLoaded();
        }
      });
    };

    void (async () => {
      if (!this.tabComponent(active)) {
        await this.updateComplete;
      }
      await run();
    })();
  }

  private handleClanDateRangeChange(
    event: CustomEvent<{ start: string; end: string }>,
  ) {
    this.clanDateRange = event.detail;
  }

  protected renderHeaderSlot() {
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

    return modalHeader({
      titleContent: html`
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-white text-xl sm:text-2xl font-bold uppercase tracking-widest"
          >
            ${translateText("leaderboard_modal.title")}
          </span>
          ${this.activeTab === "clans" ? dateRange : ""}
          ${this.rankedTypeFor(this.activeTab) !== null ||
          this.activeTab === "tribes"
            ? refreshTime
            : ""}
        </div>
      `,
      onBack: () => this.close(),
      ariaLabel: translateText("common.close"),
    });
  }

  protected renderBody() {
    return html`
      <div class="flex-1 min-h-0 h-full">
        <leaderboard-player-list
          class=${this.rankedTypeFor(this.activeTab) !== null
            ? "h-full"
            : "hidden"}
          .rankedType=${this.rankedTypeFor(this.activeTab) ??
          this.lastRankedType}
        ></leaderboard-player-list>
        <leaderboard-clan-table
          class=${this.activeTab === "clans" ? "h-full" : "hidden"}
          @date-range-change=${(
            event: CustomEvent<{ start: string; end: string }>,
          ) => this.handleClanDateRangeChange(event)}
        ></leaderboard-clan-table>
        <leaderboard-tribe-table
          class=${this.activeTab === "tribes" ? "h-full" : "hidden"}
        ></leaderboard-tribe-table>
      </div>
    `;
  }
}
