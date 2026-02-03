import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";
import leaderboardRegularIcon from "/images/LeaderboardIconRegularWhite.svg?url";
import leaderboardSolidIcon from "/images/LeaderboardIconSolidWhite.svg?url";
import teamRegularIcon from "/images/TeamIconRegularWhite.svg?url";
import teamSolidIcon from "/images/TeamIconSolidWhite.svg?url";

@customElement("game-left-sidebar")
export class GameLeftSidebar extends LitElement implements Layer {
  @state()
  private isLeaderboardShow = false;
  @state()
  private isTeamLeaderboardShow = false;
  private isVisible = false;
  private isPlayerTeamLabelVisible = false;
  private playerTeam: string | null = null;

  private playerColor: Colord = new Colord("#FFFFFF");
  public game: GameView;
  private _shownOnInit = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }
    // Make it visible by default on large screens
    if (window.innerWidth >= 1024) {
      // lg breakpoint
      this._shownOnInit = true;
    }
    this.requestUpdate();
  }

  tick() {
    if (!this.playerTeam && this.game.myPlayer()?.team()) {
      this.playerTeam = this.game.myPlayer()!.team();
      if (this.playerTeam) {
        this.playerColor = this.game
          .config()
          .theme()
          .teamColor(this.playerTeam);
        this.requestUpdate();
      }
    }

    if (this._shownOnInit && !this.game.inSpawnPhase()) {
      this._shownOnInit = false;
      this.isLeaderboardShow = true;
      this.requestUpdate();
    }

    if (!this.game.inSpawnPhase()) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }
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

  private getTranslatedPlayerTeamLabel(): string {
    if (!this.playerTeam) return "";
    const translationKey = `team_colors.${this.playerTeam.toLowerCase()}`;
    const translated = translateText(translationKey);
    return translated === translationKey ? this.playerTeam : translated;
  }

  render() {
    return html`
      <aside
        class=${`fixed top-4 left-4 z-1000 flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-xs shadow-xs rounded-lg transition-transform duration-300 ease-out transform ${
          this.isVisible ? "translate-x-0" : "hidden"
        }`}
      >
        ${this.isPlayerTeamLabelVisible
          ? html`
              <div
                class="flex items-center w-full h-8 lg:h-10 text-white py-1 lg:p-2"
                @contextmenu=${(e: Event) => e.preventDefault()}
              >
                ${translateText("help_modal.ui_your_team")}
                <span
                  style="--color: ${this.playerColor.toRgbString()}"
                  class="text-(--color)"
                >
                  &nbsp;${this.getTranslatedPlayerTeamLabel()} &#10687;
                </span>
              </div>
            `
          : null}
        <div
          class=${`flex items-center gap-4 lg:gap-6 xl:gap-8 text-white ${this.isTeamGame ? "ml-8" : ""} ${
            this.isLeaderboardShow || this.isTeamLeaderboardShow ? "mb-2" : ""
          }`}
        >
          <div class="cursor-pointer" @click=${this.toggleLeaderboard}>
            <img
              src=${this.isLeaderboardShow
                ? leaderboardSolidIcon
                : leaderboardRegularIcon}
              alt="treeIcon"
              width="20"
              height="20"
            />
          </div>
          ${this.isTeamGame
            ? html`
                <div
                  class="cursor-pointer"
                  @click=${this.toggleTeamLeaderboard}
                >
                  <img
                    src=${this.isTeamLeaderboardShow
                      ? teamSolidIcon
                      : teamRegularIcon}
                    alt="treeIcon"
                    width="20"
                    height="20"
                  />
                </div>
              `
            : null}
        </div>
        <div class="block lg:flex flex-wrap gap-2">
          <leader-board .visible=${this.isLeaderboardShow}></leader-board>
          <team-stats
            class="flex-1"
            .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
          ></team-stats>
        </div>
        <slot></slot>
      </aside>
    `;
  }
}
