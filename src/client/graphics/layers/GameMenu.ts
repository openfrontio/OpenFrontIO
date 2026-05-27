import { Colord } from "colord";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { GameMode, GameType, Team } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { Platform } from "../../Platform";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import { getTranslatedPlayerTeamLabel, translateText } from "../../Utils";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { Layer } from "./Layer";
import { Leaderboard } from "./Leaderboard";
import { ReplayPanel, ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
import { TeamStats } from "./TeamStats";

const exitIcon = assetUrl("images/ExitIconWhite.svg");
const FastForwardIconSolid = assetUrl("images/FastForwardIconSolidWhite.svg");
const leaderboardRegularIcon = assetUrl(
  "images/LeaderboardIconRegularWhite.svg",
);
const leaderboardSolidIcon = assetUrl("images/LeaderboardIconSolidWhite.svg");
const pauseIcon = assetUrl("images/PauseIconWhite.svg");
const playIcon = assetUrl("images/PlayIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const teamRegularIcon = assetUrl("images/TeamIconRegularWhite.svg");
const teamSolidIcon = assetUrl("images/TeamIconSolidWhite.svg");

@customElement("game-menu")
export class GameMenu extends LitElement implements Layer {
  @property({ attribute: false }) game: GameView;
  public eventBus: EventBus;

  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private timer: number = 0;

  @state()
  private isLeaderboardShow = false;

  @state()
  private isTeamLeaderboardShow = false;

  @state()
  private isPlayerTeamLabelVisible = false;

  @state()
  private playerTeam: Team | null = null;

  private get leaderboard(): Leaderboard | null {
    const el = this.querySelector("leader-board");
    return el instanceof Leaderboard ? el : null;
  }
  private get teamStats(): TeamStats | null {
    const el = this.querySelector("team-stats");
    return el instanceof TeamStats ? el : null;
  }
  private get replayPanel(): ReplayPanel | null {
    const el = this.querySelector("replay-panel");
    return el instanceof ReplayPanel ? el : null;
  }

  private playerColor: Colord = new Colord("#FFFFFF");
  private hasWinner = false;
  private isLobbyCreator = false;
  private spawnBarVisible = false;
  private immunityBarVisible = false;
  private _shownOnInit = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this._isVisible = true;

    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
      this.updateParentOffset();
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
      this.updateParentOffset();
    });

    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
      this.requestUpdate();
    });

    if (this.isTeamGame) {
      this.isPlayerTeamLabelVisible = true;
    }

    if (Platform.isDesktopWidth) {
      this._shownOnInit = true;
    }

    this.requestUpdate();
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    // Check if the player is the lobby creator
    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
      this.requestUpdate();
    }

    // Team color
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

    if (!this.game.inSpawnPhase() && this.isPlayerTeamLabelVisible) {
      this.isPlayerTeamLabelVisible = false;
      this.requestUpdate();
    }

    // Timer logic
    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    const spawnPhaseTurns = this.game.config().numSpawnPhaseTurns();
    const ticks = this.game.ticks();
    const gameTicks = Math.max(0, ticks - spawnPhaseTurns);
    const elapsedSeconds = Math.floor(gameTicks / 10); // 10 ticks per second

    const hasMaxTimer = maxTimerValue !== null && maxTimerValue !== undefined;

    if (this.game.inSpawnPhase()) {
      this.timer = hasMaxTimer ? maxTimerValue * 60 : 0;
      return;
    }

    if (this.hasWinner) {
      return;
    }

    if (hasMaxTimer) {
      this.timer = Math.max(0, maxTimerValue * 60 - elapsedSeconds);
    } else {
      this.timer = elapsedSeconds;
    }

    this.leaderboard?.tick();
    this.teamStats?.tick();
    this.replayPanel?.tick?.();
  }

  private updateParentOffset(): void {
    const offset =
      (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    const parent = this.parentElement as HTMLElement;
    if (parent) {
      parent.style.marginTop = `${offset}px`;
    }
  }

  private secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);

    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    if (h !== 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
      return `${pad(m)}:${pad(s)}`;
    }
  };

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      crazyGamesSDK.gameplayStop();
    } else {
      crazyGamesSDK.gameplayStart();
    }
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
  }

  private async onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    await crazyGamesSDK.requestMidgameAd();
    await crazyGamesSDK.gameplayStop();
    window.location.href = "/";
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
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
    if (this.game === undefined) return html``;

    const timerColor =
      this.game.config().gameConfig().maxTimerValue !== undefined &&
      this.timer < 60
        ? "text-red-400"
        : "";

    return html`
      <div class="relative">
        <aside
          class=${`flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-bl-lg min-[1200px]:rounded-lg transition-transform duration-300 ease-out transform text-white ${
            this._isVisible ? "translate-x-0" : "translate-x-full"
          }`}
          @contextmenu=${(e: Event) => e.preventDefault()}
        >
          <!-- Leaderboard button -->
          <div
            class="cursor-pointer p-0.5 bg-gray-700/50 hover:bg-gray-600 border rounded-md border-slate-500 transition-colors"
            @click=${this.toggleLeaderboard}
            role="button"
            tabindex="0"
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " " || e.code === "Space") {
                e.preventDefault();
                this.toggleLeaderboard();
              }
            }}
          >
            <img
              src=${this.isLeaderboardShow
                ? leaderboardSolidIcon
                : leaderboardRegularIcon}
              alt=${translateText("help_modal.icon_alt_player_leaderboard") ||
              "Player Leaderboard Icon"}
              width="20"
              height="20"
            />
          </div>

          <!-- Team leaderboard button -->
          ${this.isTeamGame
            ? html`
                <div
                  class="cursor-pointer p-0.5 bg-gray-700/50 hover:bg-gray-600 border rounded-md border-slate-500 transition-colors"
                  @click=${this.toggleTeamLeaderboard}
                  role="button"
                  tabindex="0"
                  @keydown=${(e: KeyboardEvent) => {
                    if (
                      e.key === "Enter" ||
                      e.key === " " ||
                      e.code === "Space"
                    ) {
                      e.preventDefault();
                      this.toggleTeamLeaderboard();
                    }
                  }}
                >
                  <img
                    src=${this.isTeamLeaderboardShow
                      ? teamSolidIcon
                      : teamRegularIcon}
                    alt=${translateText(
                      "help_modal.icon_alt_team_leaderboard",
                    ) || "Team Leaderboard Icon"}
                    width="20"
                    height="20"
                  />
                </div>
              `
            : null}

          <!-- In-game time -->
          <div class=${timerColor}>${this.secondsToHms(this.timer)}</div>

          <!-- Replay/pause buttons -->
          ${this.maybeRenderReplayButtons()}

          <div class="cursor-pointer" @click=${this.onSettingsButtonClick}>
            <img src=${settingsIcon} alt="settings" width="20" height="20" />
          </div>

          <div class="cursor-pointer" @click=${this.onExitButtonClick}>
            <img src=${exitIcon} alt="exit" width="20" height="20" />
          </div>
        </aside>

        <div class="absolute right-0 top-full flex flex-col items-end w-96">
          <replay-panel
            .game=${this.game}
            .eventBus=${this.eventBus}
          ></replay-panel>
          ${this.isPlayerTeamLabelVisible
            ? html`
                <div
                  class="flex items-center text-white px-3 text-sm"
                  @contextmenu=${(e: Event) => e.preventDefault()}
                >
                  ${translateText("help_modal.ui_your_team")}
                  <span
                    style="--color: ${this.playerColor.toRgbString()}"
                    class="text-(--color)"
                  >
                    &nbsp;${getTranslatedPlayerTeamLabel(this.playerTeam)}
                    &#10687;
                  </span>
                </div>
              `
            : null}
          <div
            class=${`flex flex-wrap justify-end overflow-x-auto min-w-0 w-full ${this.isLeaderboardShow && this.isTeamLeaderboardShow ? "gap-2" : ""}`}
          >
            <leader-board
              .game=${this.game}
              .eventBus=${this.eventBus}
              .visible=${this.isLeaderboardShow}
            ></leader-board>
            <team-stats
              .game=${this.game}
              .eventBus=${this.eventBus}
              .visible=${this.isTeamLeaderboardShow && this.isTeamGame}
            ></team-stats>
          </div>
        </div>
      </div>
    `;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton = isReplayOrSingleplayer || this.isLobbyCreator;

    return html`
      ${isReplayOrSingleplayer
        ? html`
            <div class="cursor-pointer" @click=${this.toggleReplayPanel}>
              <img
                src=${FastForwardIconSolid}
                alt="replay"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
      ${showPauseButton
        ? html`
            <div class="cursor-pointer" @click=${this.onPauseButtonClick}>
              <img
                src=${this.isPaused ? playIcon : pauseIcon}
                alt="play/pause"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
    `;
  }
}
