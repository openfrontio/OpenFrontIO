import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { ReplayIntervalEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

export enum ReplaySpeeds {
  slow = 125,
  medium = 50,
  fast = 25,
  fastest = 5,
}

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @state()
  private _replayInterval: number = ReplaySpeeds.fastest;

  @state()
  private _isVisible = false;

  tick() {
    if (!this._isVisible && this.game?.config().isReplay()) {
      this.setVisible(true);
    }

    this.requestUpdate();
  }

  onReplayIntervalChange(value: number) {
    this._replayInterval = value;
    this.eventBus?.emit(new ReplayIntervalEvent(value));
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
    return html`
      <div
        class="${this._isVisible ? "" : "hidden"}"
        @contextmenu=${(e) => e.preventDefault()}
      >
        <label class="block mb-1 text-white" translate="no">
          ${translateText("replay_panel.replay_speed")}:
        </label>
        <div class="grid grid-cols-2 gap-1">
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replayInterval === ReplaySpeeds.slow
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplayIntervalChange(ReplaySpeeds.slow);
            }}
          >
            >
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replayInterval === ReplaySpeeds.medium
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplayIntervalChange(ReplaySpeeds.medium);
            }}
          >
            >>
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replayInterval === ReplaySpeeds.fast
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplayIntervalChange(ReplaySpeeds.fast);
            }}
          >
            >>>
          </button>
          <button
            class="text-white font-bold py-0 rounded border transition ${this
              ._replayInterval === ReplaySpeeds.fastest
              ? "bg-blue-500 border-gray-400"
              : "border-gray-500"}"
            @click=${() => {
              this.onReplayIntervalChange(ReplaySpeeds.fastest);
            }}
          >
            >>>>
          </button>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
