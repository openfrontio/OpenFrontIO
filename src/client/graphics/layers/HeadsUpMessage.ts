import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("heads-up-message")
export class HeadsUpMessage extends LitElement implements Layer {
  public game: GameView;

  @state()
  private isVisible = false;

  @state()
  private isPaused = false;

  @state()
  private toastMessage: string | import("lit").TemplateResult | null = null;
  @state()
  private toastColor: "green" | "red" = "green";
  private toastTimeout: number | null = null;

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
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
  }

  private handleShowMessage = (event: CustomEvent) => {
    const { message, duration, color } = event.detail ?? {};
    if (
      typeof message === "string" ||
      (message && typeof message.values === "object")
    ) {
      this.toastMessage = message;
      this.toastColor = color === "red" ? "red" : "green";
      this.requestUpdate();
      if (this.toastTimeout) {
        clearTimeout(this.toastTimeout);
      }
      this.toastTimeout = window.setTimeout(
        () => {
          this.toastMessage = null;
          this.requestUpdate();
        },
        typeof duration === "number" ? (duration ?? 2000) : 2000,
      );
    }
  };

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.GamePaused].length > 0) {
      const pauseUpdate = updates[GameUpdateType.GamePaused][0];
      this.isPaused = pauseUpdate.paused;
    }

    this.isVisible = this.game.inSpawnPhase() || this.isPaused;
    this.requestUpdate();
  }

  private getMessage(): string {
    if (this.isPaused) {
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        return translateText("heads_up_message.singleplayer_game_paused");
      } else {
        return translateText("heads_up_message.multiplayer_game_paused");
      }
    }
    return this.game.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  }

  render() {
    return html`
      <div style="pointer-events: none;">
        ${this.toastMessage
          ? html`
              <div
                class="fixed top-6 left-1/2 -translate-x-1/2 z-[11001] px-6 py-4 rounded-xl transition-all duration-300 animate-fade-in-out"
                style="max-width: 90vw; min-width: 200px; text-align: center;
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
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                ${typeof this.toastMessage === "string"
                  ? html`<span class="font-medium">${this.toastMessage}</span>`
                  : this.toastMessage}
              </div>
            `
          : null}
        ${this.isVisible
          ? html`
              <div
                class="fixed top-[15%] left-1/2 -translate-x-1/2 z-[11000]
                            inline-flex items-center justify-center h-8 lg:h-10
                            w-fit max-w-[90vw]
                            bg-gray-900/60 rounded-md lg:rounded-lg
                            backdrop-blur-md text-white text-md lg:text-xl px-3 lg:px-4
                            text-center break-words"
                style="word-wrap: break-word; hyphens: auto;"
                @contextmenu=${(e: MouseEvent) => e.preventDefault()}
              >
                ${this.getMessage()}
              </div>
            `
          : null}
      </div>
    `;
  }
}
