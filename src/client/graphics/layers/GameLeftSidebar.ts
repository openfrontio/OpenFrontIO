import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import "../icons/LeaderboardRegularIcon";
import "../icons/LeaderboardSolidIcon";
import "../icons/TeamRegularIcon";
import "../icons/TeamSolidIcon";
import { Layer } from "./Layer";

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Layer {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  private isVisible = false;
  public game: GameView;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  private toggleLeaderboard(): void {
    this.isLeaderboardShow = !this.isLeaderboardShow;
  }

  private toggleTeamLeaderboard(): void {
    this.isTeamLeaderboardShow = !this.isTeamLeaderboardShow;
  }

  private get isTeamGame(): boolean {
    return this.game?.config().gameConfig().gameMode === GameMode.Team;
  }

  render() {
    return html`
      <aside
        class=${`fixed top-[70px] left-0 z-[1000] flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-sm shadow-xs rounded-tr-lg rounded-br-lg transition-transform duration-300 ease-out transform ${
          this.isVisible ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div class="flex items-center gap-2 space-x-2 text-white mb-2">
          <div class="w-6 h-6 cursor-pointer" @click=${this.toggleLeaderboard}>
            ${this.isLeaderboardShow
              ? html` <leaderboard-solid-icon></leaderboard-solid-icon>`
              : html` <leaderboard-regular-icon></leaderboard-regular-icon>`}
          </div>
          ${this.isTeamGame
            ? html`
                <div
                  class="w-6 h-6 cursor-pointer"
                  @click=${this.toggleTeamLeaderboard}
                >
                  ${this.isTeamLeaderboardShow
                    ? html` <team-solid-icon></team-solid-icon>`
                    : html` <team-regular-icon></team-regular-icon>`}
                </div>
              `
            : null}
        </div>
        <div>
          <leader-board
            class="block mb-2"
            .visible=${this.isLeaderboardShow}
          ></leader-board>
          <team-stats
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
