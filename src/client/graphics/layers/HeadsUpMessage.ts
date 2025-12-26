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

  createRenderRoot() {
    return this;
  }

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
        return translateText("pause.singleplayer_game_paused");
      } else {
        return translateText("pause.multiplayer_game_paused");
      }
    }
    return this.game.config().isRandomSpawn()
      ? translateText("heads_up_message.random_spawn")
      : translateText("heads_up_message.choose_spawn");
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const message = this.getMessage();

    return html`
      <div
        class="flex items-center relative
                    w-full justify-evenly h-8 lg:h-10 md:top-[70px] left-0 lg:left-4
                    bg-opacity-60 bg-gray-900 rounded-md lg:rounded-lg
                    backdrop-blur-md text-white text-md lg:text-xl p-1 lg:p-2"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${message}
      </div>
    `;
  }
}
