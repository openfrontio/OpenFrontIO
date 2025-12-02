import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { GameType } from "../../../core/game/Game";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("heads-up-message")
export class HeadsUpMessage extends LitElement implements Layer {
  public game: GameView;

  @state()
  private isVisible = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    // Check if we should show the spawn message
    const shouldShowSpawnMessage = 
      this.game.inSpawnPhase() ||
      (this.game.config().gameConfig().gameType === GameType.Singleplayer &&
       !this.game.myPlayer()?.hasSpawned());
    
    if (!shouldShowSpawnMessage) {
      this.isVisible = false;
      this.requestUpdate();
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="flex items-center relative
                    w-full justify-evenly h-8 lg:h-10 md:top-[70px] left-0 lg:left-4 
                    bg-opacity-60 bg-gray-900 rounded-md lg:rounded-lg 
                    backdrop-blur-md text-white text-md lg:text-xl p-1 lg:p-2"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.game.config().isRandomSpawn()
          ? translateText("heads_up_message.random_spawn")
          : translateText("heads_up_message.choose_spawn")}
      </div>
    `;
  }
}
