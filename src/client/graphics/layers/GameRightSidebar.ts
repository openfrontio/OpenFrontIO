import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import replayRegularIcon from "../../../../resources/images/ReplayRegularIconWhite.svg";
import replaySolidIcon from "../../../../resources/images/ReplaySolidIconWhite.svg";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Layer {
  public game: GameView;
  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  createRenderRoot() {
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config().gameConfig().gameType === GameType.Singleplayer;
    this._isVisible = true;
    this.requestUpdate();
  }

  tick() {}

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
  }

  render() {
    return html`
      <aside
        class=${`fixed top-[90px] right-0 z-[1000] flex flex-col max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-slate-800/40 backdrop-blur-sm shadow-xs rounded-tl-lg rounded-bl-lg transition-transform duration-300 ease-out transform ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex justify-end items-center gap-2 text-white mb-2">
          ${this._isSinglePlayer || this.game?.config().isReplay()
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
              `
            : null}
        </div>
        <div class="block lg:flex flex-wrap gap-2">
          <replay-panel .visible="${this._isReplayVisible}"></replay-panel>
        </div>
      </aside>
    `;
  }
}
