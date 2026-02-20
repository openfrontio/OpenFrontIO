import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import {
  TimelineGoLiveEvent,
  TimelineRangeEvent,
  TimelineRangeRequestEvent,
  TimelineSeekEvent,
} from "../../timeline/TimelineEvents";
import { Layer } from "./Layer";

@customElement("timeline-panel")
export class TimelinePanel extends LitElement implements Layer {
  public eventBus: EventBus | undefined;
  public game: GameView | undefined;

  @property({ type: Boolean })
  visible: boolean = true;

  @state() private liveTick = 0;
  @state() private displayTick = 0;
  @state() private isLive = true;
  @state() private isSeeking = false;
  @state() private storageError: string | null = null;
  @state() private isDragging = false;
  @state() private dragTick: number | null = null;

  createRenderRoot() {
    return this; // Enable Tailwind CSS
  }

  init() {
    this.eventBus?.on(TimelineRangeEvent, (e) => {
      this.liveTick = e.liveTick;
      this.displayTick = e.displayTick;
      this.isLive = e.isLive;
      this.isSeeking = e.isSeeking;
      this.storageError = e.storageError;
      if (!this.isDragging) {
        this.dragTick = null;
      }
      this.requestUpdate();
    });

    this.eventBus?.emit(new TimelineRangeRequestEvent());
  }

  getTickIntervalMs() {
    return 0;
  }

  tick() {
    // Render is driven by events.
  }

  shouldTransform() {
    return false;
  }

  renderLayer(_ctx: CanvasRenderingContext2D) {}

  private onSeekInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const t = Number.parseInt(input.value, 10);
    if (!Number.isFinite(t)) return;
    this.dragTick = t;
    this.eventBus?.emit(new TimelineSeekEvent(t));
  }

  private onSeekPointerDown() {
    this.isDragging = true;
    this.dragTick = this.displayTick;
  }

  private onSeekPointerUp() {
    this.isDragging = false;
    this.dragTick = null;
  }

  private onGoLive() {
    this.eventBus?.emit(new TimelineGoLiveEvent());
  }

  render() {
    if (!this.visible) return html``;

    const shownTick = this.isDragging
      ? (this.dragTick ?? this.displayTick)
      : this.displayTick;

    const delta = this.liveTick - shownTick;
    const status = this.isLive ? "Live" : `Rewinding (-${delta})`;

    return html`
      <div
        class="pointer-events-auto p-2 bg-gray-800/70 backdrop-blur-xs shadow-xs min-[1200px]:rounded-lg rounded-l-lg w-[320px]"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="flex items-center justify-between mb-2">
          <div class="text-white text-sm" translate="no">
            ${status}${this.isSeeking ? " (seeking...)" : ""}
          </div>
          <button
            class="py-0.5 px-2 text-sm text-white rounded-sm border transition border-gray-500 hover:border-gray-200 ${this
              .isLive
              ? "opacity-50 cursor-not-allowed"
              : ""}"
            ?disabled=${this.isLive}
            @click=${this.onGoLive}
          >
            Live
          </button>
        </div>

        <div class="text-xs text-gray-200 mb-1" translate="no">
          Tick ${shownTick} / ${this.liveTick}
        </div>

        <input
          class="w-full"
          type="range"
          min="0"
          max=${this.liveTick}
          .value=${String(shownTick)}
          @input=${this.onSeekInput}
          @pointerdown=${this.onSeekPointerDown}
          @pointerup=${this.onSeekPointerUp}
        />

        ${this.storageError
          ? html`<div class="mt-2 text-xs text-amber-200" translate="no">
              ${this.storageError}
            </div>`
          : html``}
      </div>
    `;
  }
}
