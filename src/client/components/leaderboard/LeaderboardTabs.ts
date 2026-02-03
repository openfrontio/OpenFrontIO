import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { translateText } from "../../Utils";

export type LeaderboardTab = "players" | "clans";

@customElement("leaderboard-tabs")
export class LeaderboardTabs extends LitElement {
  @property({ type: String }) activeTab: LeaderboardTab = "players";

  createRenderRoot() {
    return this;
  }

  private baseTabClass =
    "px-6 py-2 rounded-full text-sm font-bold uppercase tracking-wider transition-all cursor-pointer select-none";
  private activeTabClass = "bg-blue-600 text-white";
  private inactiveTabClass =
    "text-white/40 hover:text-white/60 hover:bg-white/5";

  private getTabClass(active: boolean) {
    return [
      this.baseTabClass,
      active ? this.activeTabClass : this.inactiveTabClass,
    ].join(" ");
  }

  @state()
  private playerClass = this.getTabClass(this.activeTab === "players");
  @state()
  private clanClass = this.getTabClass(this.activeTab === "clans");

  private handleTabChange(tab: LeaderboardTab) {
    this.dispatchEvent(
      new CustomEvent<LeaderboardTab>("tab-change", {
        detail: tab,
        bubbles: true,
        composed: true,
      }),
    );

    this.playerClass = this.getTabClass(tab === "players");
    this.clanClass = this.getTabClass(tab === "clans");
  }

  render() {
    return html`
      <div
        role="tablist"
        class="flex gap-2 p-1 bg-white/5 rounded-full border border-white/10 mb-6 w-fit mx-auto mt-4"
      >
        <button
          type="button"
          role="tab"
          class="${this.playerClass}"
          @click=${() => this.handleTabChange("players")}
          id="player-leaderboard-tab"
          aria-selected=${this.activeTab === "players"}
        >
          ${translateText("leaderboard_modal.ranked_tab")}
        </button>
        <button
          type="button"
          role="tab"
          class="${this.clanClass}"
          @click=${() => this.handleTabChange("clans")}
          id="clan-leaderboard-tab"
          aria-selected=${this.activeTab === "clans"}
        >
          ${translateText("leaderboard_modal.clans_tab")}
        </button>
      </div>
    `;
  }
}
