import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { ReplaySeekEvent, ReplaySpeedChangeEvent } from "../../InputHandler";
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

  /** Total number of turns in the replay. Set externally by ClientGameRunner. */
  public totalReplayTurns: number = 0;

  @property({ type: Boolean })
  visible: boolean = false;

  @state()
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;

  @property({ type: Boolean })
  isSingleplayer = false;

  @state()
  private _isSeeking: boolean = false;

  @state()
  private _seekTarget: number = 0;

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

  getTickIntervalMs() {
    return 100; // Update more frequently for smooth seek bar movement
  }

  tick() {
    if (!this.visible) return;
    this.requestUpdate();
  }

  onReplaySpeedChange(value: ReplaySpeedMultiplier) {
    this._replaySpeedMultiplier = value;
    this.eventBus?.emit(new ReplaySpeedChangeEvent(value));
  }

  private onSeekInput(e: Event) {
    const input = e.target as HTMLInputElement;
    this._seekTarget = parseInt(input.value, 10);
    this._isSeeking = true;
  }

  private onSeekChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const targetTurn = parseInt(input.value, 10);
    this._isSeeking = false;
    this.eventBus?.emit(new ReplaySeekEvent(targetTurn));
  }

  private formatTurn(turn: number): string {
    // 10 ticks per second
    const totalSeconds = Math.floor(turn / 10);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  renderLayer(_ctx: CanvasRenderingContext2D) {}
  shouldTransform() {
    return false;
  }

  render() {
    if (!this.visible) return html``;

    const currentTick = this.game?.ticks() ?? 0;
    const totalTurns = this.totalReplayTurns;
    const isReplay = this.game?.config()?.isReplay();
    const displayTick = this._isSeeking ? this._seekTarget : currentTick;

    return html`
      <div
        class="p-2 bg-gray-800/70 backdrop-blur-xs shadow-xs rounded-lg"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <label class="block mb-2 text-white" translate="no">
          ${isReplay
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
        ${isReplay && totalTurns > 0
          ? html`
              <div class="mt-3">
                <div class="flex justify-between text-xs text-gray-300 mb-1">
                  <span>${this.formatTurn(displayTick)}</span>
                  <span>${this.formatTurn(totalTurns)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max=${totalTurns}
                  .value=${String(displayTick)}
                  class="w-full h-2 rounded-lg appearance-none cursor-pointer accent-blue-400 bg-gray-600"
                  @input=${this.onSeekInput}
                  @change=${this.onSeekChange}
                />
              </div>
            `
          : ""}
      </div>
    `;
  }

  private renderSpeedButton(value: ReplaySpeedMultiplier, label: string) {
    const backgroundColor =
      this._replaySpeedMultiplier === value ? "bg-blue-400" : "";

    return html`
      <button
        class="py-0.5 px-1 text-sm text-white rounded-sm border transition border-gray-500 ${backgroundColor} hover:border-gray-200"
        @click=${() => this.onReplaySpeedChange(value)}
      >
        ${label}
      </button>
    `;
  }
}
