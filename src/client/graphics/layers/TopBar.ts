import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { GameView } from "../../../core/game/GameView";
import { renderNumber, renderTroops } from "../../Utils";
import { Layer } from "./Layer";

@customElement("top-bar")
export class TopBar extends LitElement implements Layer {
  public game: GameView;
  private isVisible = false;
  private _population = 0;
  private _lastPopulationIncreaseRate = 0;
  private _popRateIsIncreasing = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    this.updatePopulationIncrease();
    this.requestUpdate();
  }

  private updatePopulationIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const popIncreaseRate = player.population() - this._population;
    if (this.game.ticks() % 5 === 0) {
      this._popRateIsIncreasing =
        popIncreaseRate >= this._lastPopulationIncreaseRate;
      this._lastPopulationIncreaseRate = popIncreaseRate;
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    const myPlayer = this.game?.myPlayer();
    if (!myPlayer?.isAlive() || this.game?.inSpawnPhase()) {
      return html``;
    }

    const popRate = this.game.config().populationIncreaseRate(myPlayer) * 10;
    const maxPop = this.game.config().maxPopulation(myPlayer);
    const goldPerSecond = this.game.config().goldAdditionRate(myPlayer) * 10n;

    return html`
      <div
        class="fixed top-0 z-50 bg-gray-800/70 text-white text-sm p-1 rounded-ee-sm lg:rounded grid grid-cols-1 sm:grid-cols-2 w-1/2 sm:w-2/3 md:w-1/2 lg:hidden backdrop-blur"
      >
        <!-- Pop section (takes 2 columns on desktop) -->
        <div
          class="sm:col-span-1 flex items-center space-x-1 overflow-x-auto whitespace-nowrap"
        >
          <span class="font-bold shrink-0"
            >${translateText("control_panel.pop")}:</span
          >
          <span translate="no"
            >${renderTroops(myPlayer.population())} /
            ${renderTroops(maxPop)}</span
          >
          <span
            translate="no"
            class="${this._popRateIsIncreasing
              ? "text-green-500"
              : "text-yellow-500"}"
            >(+${renderTroops(popRate)})</span
          >
        </div>
        <!-- Gold section (takes 1 column on desktop) -->
        <div
          class="flex items-center space-x-2 overflow-x-auto whitespace-nowrap"
        >
          <span class="font-bold shrink-0"
            >${translateText("control_panel.gold")}:</span
          >
          <span translate="no"
            >${renderNumber(myPlayer.gold())}
            (+${renderNumber(goldPerSecond)})</span
          >
        </div>
      </div>
    `;
  }
}
