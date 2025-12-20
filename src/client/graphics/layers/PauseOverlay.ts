import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { GamePausedEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("pause-overlay")
export class PauseOverlay extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private isPaused = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(GamePausedEvent, (e) => {
      this.isPaused = e.paused;
      this.requestUpdate();
    });
  }

  render() {
    // Don't show overlay for replays - just pause without blocking the view
    if (!this.isPaused || this.game?.config()?.isReplay()) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 flex items-center justify-center
                    bg-black bg-opacity-50  z-50"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-900 bg-opacity-90 rounded-lg p-8
                      text-white text-2xl  lg:text-4xl font-bold
                      border-2 border-gray-600"
        >
          <p class="mx-auto max-w-sm text-center">
            ${this.game?.config().gameConfig().gameType === "Singleplayer"
              ? translateText("pause.singleplayer_game_paused")
              : translateText("pause.multiplayer_game_paused")}
          </p>
        </div>
      </div>
    `;
  }
}
