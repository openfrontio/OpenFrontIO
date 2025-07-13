import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { Layer } from "./Layer";

@customElement("game-top-bar")
export class GameTopBar extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private hasWinner = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.requestUpdate();
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (!this.game || !myPlayer || this.game.inSpawnPhase()) {
      return null;
    }

    const isAlt = this.game.config().isReplay();
    if (isAlt) {
      return html`
        <div
          class="absolute top-4 left-1/2 transform -translate-x-1/2 flex justify-center items-center p-2"
        ></div>
      `;
    }

    return html`
      <div
        class="fixed top-4 left-1/2 transform -translate-x-1/2 flex justify-center items-center p-1 md:px-1.5 lg:px-4 z-[1100]"
      >
        <div class="flex justify-center items-center gap-1">
          ${myPlayer?.isAlive() && !this.game.inSpawnPhase()
            ? html`<div></div>`
            : html`<div></div>`}
        </div>
      </div>
    `;
  }
}
