import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameView } from "../../../core/game/GameView";
import { renderNumber, renderTroops } from "../../Utils";
import { Layer } from "./Layer";

import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import emojisIcon from "../../../../resources/images/PopulationIconWhite.svg";
import swordIcon from "../../../../resources/images/TroupIconWhite.svg";
import buildIcon from "../../../../resources/images/WorkerIconWhite.svg";

@customElement("country-stats")
export class CountryStats extends LitElement implements Layer {
  @property({ type: Object })
  public game!: GameView;

  @state()
  private _gold: number;

  @state()
  private _goldPerSecond: number;

  @state()
  private _population: number;

  @state()
  private _maxPopulation: number;

  @state()
  private popRate: number;

  @state()
  private _troops: number;

  @state()
  private _workers: number;

  @state()
  private _isVisible = false;

  private _lastPopulationIncreaseRate: number;

  private _popRateIsIncreasing: boolean = true;

  init() {}

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player == null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    this._gold = player.gold();
    this._goldPerSecond = this.game.config().goldAdditionRate(player) * 10;

    const popIncreaseRate = player.population() - this._population;
    if (this.game.ticks() % 5 == 0) {
      this._popRateIsIncreasing =
        popIncreaseRate >= this._lastPopulationIncreaseRate;
      this._lastPopulationIncreaseRate = popIncreaseRate;
    }

    this._population = player.population();
    this._maxPopulation = this.game.config().maxPopulation(player);
    this._troops = player.troops();
    this._workers = player.workers();
    this.popRate = this.game.config().populationIncreaseRate(player) * 10;

    this.requestUpdate();
  }

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  private renderIcon(src: string) {
    return html`<img class="p-2 w-10 h-10" src="${src}" />`;
  }

  private renderBadge(children: TemplateResult) {
    return html`
      <div
        class="flex flex-row items-center justify-between gap-2 w-full p-2 bg-opacity-60 bg-gray-900 rounded-lg shadow-lg backdrop-blur-sm  text-white text-lg md:text-base"
        translate="no"
      >
        ${children}
      </div>
    `;
  }

  render() {
    if (!this._isVisible) return html``;

    return html`
      <div
        class="w-full z-50 hidden lg:block"
        @contextmenu=${(e) => e.preventDefault()}
        xmlns="http://www.w3.org/1999/html"
      >
        <div class="flex flex-col gap-2">
          <div class="flex flex-row gap-2">
            ${this.renderBadge(html`
              ${this.renderIcon(goldCoinIcon)}
              <span> ${renderNumber(this._gold)} </span>
              <span class="pr-2">
                ( +${renderNumber(this._goldPerSecond)} )
              </span>
            `)}
          </div>
          <div class="flex flex-row gap-2">
            ${this.renderBadge(html`
              ${this.renderIcon(emojisIcon)}
              <span>
                ${renderTroops(this._population)} /
                ${renderTroops(this._maxPopulation)}
              </span>
              <span
                class="pr-2 ${this._popRateIsIncreasing
                  ? "text-green-500"
                  : "text-yellow-500"}"
              >
                ( +${renderTroops(this.popRate)} )
              </span>
            `)}
          </div>
          <div class="flex flex-row gap-2">
            ${this.renderBadge(html`
              ${this.renderIcon(swordIcon)}
              <span class="py-2 pr-2"> ${renderTroops(this._troops)} </span>
            `)}
            ${this.renderBadge(html`
              ${this.renderIcon(buildIcon)}
              <span class="py-2 pr-2"> ${renderTroops(this._workers)} </span>
            `)}
          </div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
