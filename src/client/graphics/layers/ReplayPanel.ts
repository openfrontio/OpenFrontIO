import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { ReplaySpeedChangeEvent } from "../../InputHandler";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

export class ShowReplayPanelEvent {
  constructor(
    public visible: boolean = true,
    public isSingleplayer: boolean = false,
  ) {}
}

@customElement("replay-panel")
export class ReplayPanel extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;

  @property({ type: Boolean })
  visible: boolean = false;

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
    if (this.game!.ticks() % 10 === 0) {
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
        class="p-2 bg-gray-800/70 backdrop-blur-sm shadow-xs rounded-lg"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <label class="block mb-2 text-white" translate="no">
          ${this.game?.config()?.isReplay()
            ? translateText("replay_panel.replay_speed")
            : translateText("replay_panel.game_speed")}
        </label>
        <div class="grid grid-cols-4 gap-2">
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
    const backgroundColor =
      this._replaySpeedMultiplier === value ? "bg-blue-400" : "";

    return html`
      <button
        class="py-0.5 px-1 text-sm text-white rounded border transition border-gray-500 ${backgroundColor} hover:border-gray-200"
        @click=${() => this.onReplaySpeedChange(value)}
      >
        ${label}
      </button>
    `;
  }
}
