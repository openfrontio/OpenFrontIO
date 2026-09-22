import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameMode, GameType, RankedType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { translateText } from "../../Utils";
import { GameView } from "../../view";

const COLLUSION_WARNING_CLOSED_KEY = "hasClosedCollusionWarning";

@customElement("heads-up-message")
export class HeadsUpMessage extends LitElement implements Controller {
  public game: GameView;

  @state()
  private isVisible = false;

  @state()
  private hasClosedCollusionWarning =
    localStorage.getItem(COLLUSION_WARNING_CLOSED_KEY) !== null;

  @state()
  private isPaused = false;

  @state()
  private isImmunityActive = false;

  @state()
  private isCatchingUp = false;
  private catchingUpTicks = 0;

  @state()
  private isOvertimeNotice = false;

  private static readonly CATCHING_UP_SHOW_THRESHOLD = 10;
  // How long the overtime announcement banner stays up after the start minute.
  private static readonly OVERTIME_NOTICE_SECONDS = 5;

  @state()
  private toastMessage: string | import("lit").TemplateResult | null = null;
  @state()
  private toastColor: "green" | "red" = "green";
  private toastTimeout: number | null = null;
  private toastPointerId: number | null = null;
  private toastDragStart = { x: 0, y: 0 };
  @state()
  private toastDragOffset = { x: 0, y: 0 };

  private static readonly TOAST_DISMISS_DISTANCE = 80;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener(
      "show-message",
      this.handleShowMessage as EventListener,
    );
    if (this.toastTimeout !== null) {
      clearTimeout(this.toastTimeout);
    }
  }

  private dismissToast = () => {
    if (this.toastTimeout !== null) {
      clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
    this.toastPointerId = null;
    this.toastDragOffset = { x: 0, y: 0 };
    this.toastMessage = null;
  };

  private handleShowMessage = (event: CustomEvent) => {
    const { message, duration, color } = event.detail ?? {};
    if (
      typeof message === "string" ||
      (message && typeof message.values === "object")
    ) {
      this.toastMessage = message;
      this.toastColor = color === "red" ? "red" : "green";
      this.toastPointerId = null;
      this.toastDragOffset = { x: 0, y: 0 };
      this.requestUpdate();
      if (this.toastTimeout !== null) {
        clearTimeout(this.toastTimeout);
      }
      this.toastTimeout = window.setTimeout(
        this.dismissToast,
        typeof duration === "number" ? (duration ?? 2000) : 2000,
      );
    }
  };

  private onToastPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || this.toastPointerId !== null) return;
    this.toastPointerId = event.pointerId;
    this.toastDragStart = { x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  private onToastPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.toastPointerId) return;
    this.toastDragOffset = {
      x: event.clientX - this.toastDragStart.x,
      y: event.clientY - this.toastDragStart.y,
    };
  };

  private onToastPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.toastPointerId) return;
    const distance = Math.hypot(this.toastDragOffset.x, this.toastDragOffset.y);
    if (distance >= HeadsUpMessage.TOAST_DISMISS_DISTANCE) {
      this.dismissToast();
      return;
    }
    this.toastPointerId = null;
    this.toastDragOffset = { x: 0, y: 0 };
  };

  private onToastPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== this.toastPointerId) return;
    this.toastPointerId = null;
    this.toastDragOffset = { x: 0, y: 0 };
  };

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    const pauseUpdates = updates?.[GameUpdateType.GamePaused];
    if (pauseUpdates && pauseUpdates.length > 0) {
      this.isPaused = pauseUpdates[pauseUpdates.length - 1].paused;
    }

    const showImmunityHudDuration = 10 * 10;
    const spawnEnd = this.game.config().numSpawnPhaseTurns();
    const ticksSinceSpawnEnd = this.game.ticks() - spawnEnd;

    this.isImmunityActive =
      this.game.config().hasExtendedSpawnImmunity() &&
      !this.game.inSpawnPhase() &&
      this.game.isSpawnImmunityActive() &&
      ticksSinceSpawnEnd < showImmunityHudDuration;

    const currentlyCatchingUp =
      !this.game.config().isReplay() && this.game.isCatchingUp();

    if (currentlyCatchingUp) {
      this.catchingUpTicks++;
    } else {
      this.catchingUpTicks = 0;
    }

    this.isCatchingUp =
      this.catchingUpTicks >= HeadsUpMessage.CATCHING_UP_SHOW_THRESHOLD;

    // Announce overtime in this banner (not the toast, which is a brief
    // notification slot). Window-based rather than a fired-once flag, so a
    // late joiner or replay seek doesn't get a stale announcement long after
    // the start minute.
    const overtime = this.game.config().overtimeConfig();
    const overtimeStart = overtime.startMinutes * 60;
    const elapsed = this.game.elapsedGameSeconds();
    this.isOvertimeNotice =
      overtime.enabled &&
      !this.game.inSpawnPhase() &&
      elapsed >= overtimeStart &&
      elapsed < overtimeStart + HeadsUpMessage.OVERTIME_NOTICE_SECONDS;

    this.isVisible =
      this.game.inSpawnPhase() ||
      this.isPaused ||
      this.isImmunityActive ||
      this.isCatchingUp ||
      this.isOvertimeNotice;
    this.requestUpdate();
  }

  private getMessage(): string {
    if (this.isCatchingUp) {
      return translateText("heads_up_message.catching_up");
    }
    if (this.isPaused) {
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        return translateText("heads_up_message.singleplayer_game_paused");
      } else {
        return translateText("heads_up_message.multiplayer_game_paused");
      }
    }
    if (this.isImmunityActive) {
      return translateText("heads_up_message.pvp_immunity_active", {
        seconds: Math.round(this.game.config().spawnImmunityDuration() / 10),
      });
    }
    if (this.isOvertimeNotice) {
      return translateText("overtime.started");
    }
    if (
      this.game.config().isReplay() ||
      this.game.config().isIntentionalSpectator()
    ) {
      return this.game.config().isRandomSpawn()
        ? translateText("heads_up_message.random_spawn_spectator")
        : translateText("heads_up_message.choose_spawn_spectator");
    }
    return this.game.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  }

  private onCloseCollusionWarning = (): void => {
    localStorage.setItem(COLLUSION_WARNING_CLOSED_KEY, "true");
    this.hasClosedCollusionWarning = true;
    this.requestUpdate();
  };

  render() {
    return html`
      <div style="pointer-events: none;">
        ${this.toastMessage
          ? html`
              <div
                data-game-toast
                class="fixed top-6 left-1/2 -translate-x-1/2 z-[1002]
                       max-w-[90vw] pointer-events-auto touch-none select-none
                       cursor-grab active:cursor-grabbing"
                @pointerdown=${this.onToastPointerDown}
                @pointermove=${this.onToastPointerMove}
                @pointerup=${this.onToastPointerUp}
                @pointercancel=${this.onToastPointerCancel}
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                <div
                  data-game-toast-content
                  class="px-6 py-4 rounded-xl animate-fade-in-out"
                  style="min-width: 200px; text-align: center;
                  transform: translate3d(${this.toastDragOffset.x}px, ${this
                    .toastDragOffset.y}px, 0);
                  transition: ${this.toastPointerId === null
                    ? "transform 180ms cubic-bezier(0.4, 0, 0.2, 1)"
                    : "none"};
                  background: ${this.toastColor === "red"
                    ? "rgba(239,68,68,0.1)"
                    : "rgba(34,197,94,0.1)"};
                  border: 1px solid ${this.toastColor === "red"
                    ? "rgba(239,68,68,0.5)"
                    : "rgba(34,197,94,0.5)"};
                  color: white;
                  box-shadow: 0 0 30px 0 ${this.toastColor === "red"
                    ? "rgba(239,68,68,0.3)"
                    : "rgba(34,197,94,0.3)"};
                  backdrop-filter: blur(12px);"
                >
                  ${typeof this.toastMessage === "string"
                    ? html`<span class="font-medium"
                        >${this.toastMessage}</span
                      >`
                    : this.toastMessage}
                </div>
              </div>
            `
          : null}
        ${this.isVisible
          ? html`
              <div
                class="fixed top-[15%] left-1/2 -translate-x-1/2 z-[799]
                            inline-flex items-center justify-center min-h-8 lg:min-h-10
                            w-fit max-w-[90vw]
                            bg-gray-800/70 rounded-md lg:rounded-lg
                            backdrop-blur-xs text-white text-md lg:text-xl px-3 lg:px-4 py-1
                            text-center break-words"
                style="word-wrap: break-word; hyphens: auto;"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                ${this.getMessage()}
              </div>
            `
          : null}
        ${this.game?.inSpawnPhase() &&
        !this.game.config().isReplay() &&
        !this.game.config().isIntentionalSpectator() &&
        this.game.config().gameConfig().rankedType !== RankedType.OneVOne &&
        this.game.config().gameConfig().gameMode === GameMode.FFA &&
        this.game.config().gameConfig().gameType === GameType.Public &&
        !this.hasClosedCollusionWarning
          ? html`
              <div
                class="fixed top-[25%] left-1/2 -translate-x-1/2 z-[799]
                            inline-flex flex-col items-center justify-center min-h-8 lg:min-h-10
                            w-fit max-w-[90vw]
                            bg-amber-500/70 rounded-md lg:rounded-lg
                            backdrop-blur-xs text-white text-md lg:text-xl px-3 lg:px-4 py-3
                            text-center break-words"
                style="word-wrap: break-word; hyphens: auto; pointer-events: auto;"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                <div>${translateText("heads_up_message.ffa_collusion")}</div>
                <button
                  class="mt-2 px-3 py-1 rounded bg-black/20 hover:bg-black/30 text-sm"
                  @click=${this.onCloseCollusionWarning}
                >
                  ${translateText("heads_up_message.dont_show_again")}
                </button>
              </div>
            `
          : null}
      </div>
    `;
  }
}
