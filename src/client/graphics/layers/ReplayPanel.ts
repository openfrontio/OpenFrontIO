import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @state()
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;

  @state()
  private _isVisible = false;

  init() {
    if (this.game?.config().gameConfig().gameType === GameType.Singleplayer) {
      this.setVisible(true);
    }
  }

  tick() {
    if (!this._isVisible && this.game?.config().isReplay()) {
      this.setVisible(true);
    }

    this.requestUpdate();
  }

  onReplaySpeedChange(value: ReplaySpeedMultiplier) {
    this._replaySpeedMultiplier = value;
    this.eventBus?.emit(new ReplaySpeedChangeEvent(value));
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisible(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  render() {
    if (!this._isVisible) {
      return html``;
    }

    return html`
      <div
        class="bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-es-sm lg:rounded-lg backdrop-blur-md"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <label class="block mb-1 text-white" translate="no">
          ${translateText("replay_panel.replay_speed")}
        </label>
        <div class="grid grid-cols-2 gap-1">
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replaySpeedMultiplier === ReplaySpeedMultiplier.slow
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplaySpeedChange(ReplaySpeedMultiplier.slow);
            }}
          >
            ×0.5
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replaySpeedMultiplier === ReplaySpeedMultiplier.normal
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplaySpeedChange(ReplaySpeedMultiplier.normal);
            }}
          >
            ×1
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replaySpeedMultiplier === ReplaySpeedMultiplier.fast
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplaySpeedChange(ReplaySpeedMultiplier.fast);
            }}
          >
            ×2
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replaySpeedMultiplier === ReplaySpeedMultiplier.fastest
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplaySpeedChange(ReplaySpeedMultiplier.fastest);
            }}
          >
            max
          </button>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
