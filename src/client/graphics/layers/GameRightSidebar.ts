import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";
import { PauseGameEvent } from "../../Transport";
import { ReplayDataUpdateEvent } from "../../../client/LocalServer";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import pauseIcon from "../../../../resources/images/PauseIconWhite.svg";
import playIcon from "../../../../resources/images/PlayIconWhite.svg";
import replayRegularIcon from "../../../../resources/images/ReplayRegularIconWhite.svg";
import replaySolidIcon from "../../../../resources/images/ReplaySolidIconWhite.svg";
import settingsIcon from "../../../../resources/images/SettingIconWhite.svg";
import { translateText } from "../../Utils";

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @state()
  private _isSinglePlayer = false;

  @state()
  private _isReplay = false;

  @state()
  private _isReplayVisible = false;

  @state()
  private _isVisible = true;

  @state()
  private isPaused = false;

  @state()
  private _totalTurns = 0;

  @state()
  private _spawnPhaseTurns = 0;

  @state()
  private timer = 0;

  private hasWinner = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer = this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer;
    this._isReplay = this.game?.config()?.isReplay() ?? false;
    this._spawnPhaseTurns = this.game?.numSpawnPhaseTurns() ?? 0;
    this._isVisible = true;
    this.requestUpdate();

    if (this.eventBus && this._isReplay) {
      this.eventBus.on(ReplayDataUpdateEvent, (event: ReplayDataUpdateEvent) => {
        this._totalTurns = event.totalTurns;
      });
    }
  }

  tick() {
    if (!this.game) throw new Error("Not initialized");
    // Timer logic
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
      this.timer++;
    }
  }

  private readonly secondsToHms = (d: number): string => {
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
    this.eventBus?.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus?.emit(new PauseGameEvent(this.isPaused));
  }

  private onExitButtonClick() {
    const isAlive = this.game?.myPlayer()?.isAlive();
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
    this.eventBus?.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  render() {
    if (this.game === undefined) return html``;

    return html`
      <aside
        class=${`flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2
          bg-gray-800/70 backdrop-blur-sm shadow-xs rounded-tl-lg rounded-bl-lg
          transition-transform duration-300 ease-out transform
          ${this._isVisible ? "translate-x-0" : "translate-x-full"}`}
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
            class="w-[70px] h-8 lg:w-24 lg:h-10 border border-slate-400 p-0.5
            text-xs md:text-sm lg:text-base flex items-center justify-center
            text-white px-1"
          >
            ${this.secondsToHms(this.timer)}
          </div>
        </div>

        ${this.maybeRenderReplayProgressBar()}
      </aside>
    `;
  }

  maybeRenderReplayButtons() {
    if (this._isSinglePlayer || this._isReplay) {
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

  maybeRenderReplayProgressBar() {
    if (!this.game || !this._isReplay || this._totalTurns === 0) return html``;

    const turnsSinceSpawn = Math.max(0, this.game.ticks() - this._spawnPhaseTurns);
    const totalTurnsSinceSpawn = Math.max(0, this._totalTurns - this._spawnPhaseTurns);
    const ratio = totalTurnsSinceSpawn === 0 ? 0 : turnsSinceSpawn / totalTurnsSinceSpawn;
    const progress = Math.min(100, Math.max(0, Math.floor(ratio * 100)));

    return html`
      <div class="progress-container mt-2 mx-2.5">
        <div class="w-full bg-gray-600 rounded-sm h-2 overflow-hidden">
          <div
            class="bg-blue-500 h-2 transition-all duration-200"
            style="width: ${progress}%"
          ></div>
        </div>
      </div>
    `;
  }
}
