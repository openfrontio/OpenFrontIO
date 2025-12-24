import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
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

  tick() {
    const updates = this.game.updatesSinceLastTick();
    if (updates && updates[GameUpdateType.GamePaused].length > 0) {
      const pauseUpdate = updates[GameUpdateType.GamePaused][0];
      this.isPaused = pauseUpdate.paused;
      this.requestUpdate();
    }
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
            ${this.game?.config()?.gameConfig()?.gameType ===
            GameType.Singleplayer
              ? translateText("pause.singleplayer_game_paused")
              : translateText("pause.multiplayer_game_paused")}
          </p>
        </div>
      </div>
    `;
  }
}
