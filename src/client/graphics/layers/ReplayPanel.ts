import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import { translateText } from "../../Utils";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { Layer } from "./Layer";

export class ShowReplayPanelEvent {
  constructor(
    public visible = true,
    public isSingleplayer = false,
  ) {}
}

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @property({ type: Boolean })
  visible = false;

  @state()
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;

  @property({ type: Boolean })
  isSingleplayer = false;

  createRenderRoot() {
    return this; // Enable Tailwind CSS
  }

  init() {
    if (this.eventBus) {
      this.eventBus.on(ShowReplayPanelEvent, (event: ShowReplayPanelEvent) => {
        this.visible = event.visible;
        this.isSingleplayer = event.isSingleplayer;
      });
    }
  }

  tick() {
    if (!this.visible) return;
    if (!this.game) return;
    if (this.game.ticks() % 10 === 0) {
      this.requestUpdate();
    }
  }

  onReplaySpeedChange(value: ReplaySpeedMultiplier) {
    this._replaySpeedMultiplier = value;
    this.eventBus?.emit(new ReplaySpeedChangeEvent(value));
  }

  renderLayer(_ctx: CanvasRenderingContext2D) {}
  shouldTransform() {
    return false;
  }

  render() {
    if (!this.visible) return html``;

    return html`
      <div
        class="flex-shrink-0 bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-es-sm lg:rounded-lg backdrop-blur-md"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <label class="block mb-1 text-white" translate="no">
          ${
            this.isSingleplayer
              ? translateText("replay_panel.game_speed")
              : translateText("replay_panel.replay_speed")
          }
        </label>
        <div class="grid grid-cols-2 gap-1">
          ${this.renderSpeedButton(ReplaySpeedMultiplier.slow, "×0.5")}
          ${this.renderSpeedButton(ReplaySpeedMultiplier.normal, "×1")}
          ${this.renderSpeedButton(ReplaySpeedMultiplier.fast, "×2")}
          ${this.renderSpeedButton(
            ReplaySpeedMultiplier.fastest,
            translateText("replay_panel.fastest_game_speed"),
          )}
        </div>
      </div>
    `;
  }

  private renderSpeedButton(value: ReplaySpeedMultiplier, label: string) {
    const isActive = this._replaySpeedMultiplier === value;
    return html`
      <button
        class="text-white font-bold py-0 rounded border transition ${
          isActive ? "bg-blue-500 border-gray-400" : "border-gray-500"
        }"
        @click=${() => this.onReplaySpeedChange(value)}
      >
        ${label}
      </button>
    `;
  }
}
