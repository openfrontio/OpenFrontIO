import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import exitIcon from "../../../../resources/images/ExitIconWhite.svg";
import pauseIcon from "../../../../resources/images/PauseIconWhite.svg";
import playIcon from "../../../../resources/images/PlayIconWhite.svg";
import replayRegularIcon from "../../../../resources/images/ReplayRegularIconWhite.svg";
import replaySolidIcon from "../../../../resources/images/ReplaySolidIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { PauseGameEvent } from "../../Transport";
import { Layer } from "./Layer";

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
  private isExistButtonVisible: boolean = true;

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
    if (!this.game.inSpawnPhase()) {
      this.isExistButtonVisible = false;
    }
  }

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus.emit(new PauseGameEvent(this.isPaused));
  }

  private onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm("Are you sure you want to exit the game?");
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = "/";
  }

  render() {
    return html`
      <aside
        class=${`fixed top-[90px] right-0 z-[1000] flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-sm shadow-xs rounded-tl-lg rounded-bl-lg transition-transform duration-300 ease-out transform ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div
          class=${`flex justify-end items-center gap-2 text-white ${
            this._isReplayVisible ? "mb-2" : ""
          }`}
        >
          ${this._isSinglePlayer || this.game?.config()?.isReplay()
            ? html`
                <div
                  class="w-6 h-6 cursor-pointer"
                  @click=${this.toggleReplayPanel}
                >
                  <img
                    src=${this._isReplayVisible
                      ? replaySolidIcon
                      : replayRegularIcon}
                    alt="replay"
                    width="20"
                    height="20"
                    style="vertical-align: middle;"
                  />
                </div>
                <div
                  class="w-6 h-6 cursor-pointer"
                  @click=${this.onPauseButtonClick}
                >
                  <img
                    src=${this.isPaused ? playIcon : pauseIcon}
                    alt="play/pause"
                    width="20"
                    height="20"
                    style="vertical-align: middle;"
                  />
                </div>
                ${this.isExistButtonVisible
                  ? html`
                      <div
                        class="w-6 h-6 cursor-pointer"
                        @click=${this.onExitButtonClick}
                      >
                        <img
                          src=${exitIcon}
                          alt="exit"
                          width="20"
                          height="20"
                        />
                      </div>
                    `
                  : null}
              `
            : null}
        </div>
        <div class="block lg:flex flex-wrap gap-2">
          <replay-panel
            .isSingleplayer="${this._isSinglePlayer}"
            .visible="${this._isReplayVisible}"
          ></replay-panel>
        </div>
      </aside>
    `;
  }
}
