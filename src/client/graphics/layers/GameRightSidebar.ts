import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import pauseIcon from "../../../../resources/images/PauseIconWhite.svg";
import playIcon from "../../../../resources/images/PlayIconWhite.svg";
import replayRegularIcon from "../../../../resources/images/ReplayRegularIconWhite.svg";
import replaySolidIcon from "../../../../resources/images/ReplaySolidIconWhite.svg";
import settingsIcon from "../../../../resources/images/SettingIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { PauseGameEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Layer {
  public game: GameView;
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

  private hasWinner = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this._isVisible = true;
    this.game.inSpawnPhase();
    this.requestUpdate();
  }

  tick() {
    // Timer logic
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== undefined) {
      if (this.game.inSpawnPhase()) {
        this.timer = maxTimerValue * 60;
      } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
        this.timer = Math.max(0, this.timer - 1);
      }
    } else {
      if (this.game.inSpawnPhase()) {
        this.timer = 0;
      } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
        this.timer++;
      }
    }
  }

  private secondsToHms = (d: number): string => {
    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);
    let time = d === 0 ? "-" : `${s}s`;
    if (m > 0) time = `${m}m` + time;
    if (h > 0) time = `${h}h` + time;
    return time;
  };

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus.emit(new PauseGameEvent(this.isPaused));
  }

  private onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = "/";
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  render() {
    if (this.game === undefined) return html``;

    return html`
      <aside
        class=${`flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-gray-800/70 backdrop-blur-sm shadow-xs rounded-tl-lg rounded-bl-lg transition-transform duration-300 ease-out transform ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class=${`flex justify-end items-center gap-2 text-white ${
            this._isReplayVisible ? "mb-2" : ""
          }`}
        >
          ${this.maybeRenderReplayButtons()}
          <div
            class="w-6 h-6 cursor-pointer"
            @click=${this.onSettingsButtonClick}
          >
            <img
              src=${settingsIcon}
              alt="settings"
              width="20"
              height="20"
              style="vertical-align: middle;"
            />
          </div>
          <div class="w-6 h-6 cursor-pointer" @click=${this.onExitButtonClick}>
            <img src=${exitIcon} alt="exit" width="20" height="20" />
          </div>
        </div>
        <!-- Timer display below buttons -->
        <div class="flex justify-center items-center mt-2">
          <div
            class="w-[70px] h-8 lg:w-24 lg:h-10 border border-slate-400 p-0.5 text-xs md:text-sm lg:text-base flex items-center justify-center text-white px-1"
            style="${this.game.config().gameConfig().maxTimerValue !==
              undefined && this.timer < 60
              ? "color: #ff8080;"
              : ""}"
          >
            ${this.secondsToHms(this.timer)}
          </div>
        </div>
      </aside>
    `;
  }

  maybeRenderReplayButtons() {
    if (this._isSinglePlayer || this.game?.config()?.isReplay()) {
      return html` <div
          class="w-6 h-6 cursor-pointer"
          @click=${this.toggleReplayPanel}
        >
          <img
            src=${this._isReplayVisible ? replaySolidIcon : replayRegularIcon}
            alt="replay"
            width="20"
            height="20"
            style="vertical-align: middle;"
          />
        </div>
        <div class="w-6 h-6 cursor-pointer" @click=${this.onPauseButtonClick}>
          <img
            src=${this.isPaused ? playIcon : pauseIcon}
            alt="play/pause"
            width="20"
            height="20"
            style="vertical-align: middle;"
          />
        </div>`;
    } else {
      return html``;
    }
  }
}
