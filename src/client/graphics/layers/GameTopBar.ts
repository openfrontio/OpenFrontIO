import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import goldCoinIcon from "../../../../resources/images/GoldCoinIcon.svg";
import populationIcon from "../../../../resources/images/PopulationIconSolidWhite.svg";
import troopIcon from "../../../../resources/images/TroopIconWhite.svg";
import workerIcon from "../../../../resources/images/WorkerIconWhite.svg";
import { EventBus } from "../../../core/EventBus";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { renderNumber, renderTroops } from "../../Utils";
import { Layer } from "./Layer";

@customElement("game-top-bar")
export class GameTopBar extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private _userSettings: UserSettings = new UserSettings();
  private _population = 0;
  private _troops = 0;
  private _workers = 0;
  private _lastPopulationIncreaseRate = 0;
  private _popRateIsIncreasing = false;
  private hasWinner = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.requestUpdate();
  }

  tick() {
    this.updatePopulationIncrease();
    const player = this.game?.myPlayer();
    if (!player) return;
    this._troops = player.troops();
    this._workers = player.workers();
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
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
    const popRate = myPlayer
      ? this.game.config().populationIncreaseRate(myPlayer) * 10
      : 0;
    const maxPop = myPlayer ? this.game.config().maxPopulation(myPlayer) : 0;
    const goldPerSecond = myPlayer
      ? this.game.config().goldAdditionRate(myPlayer) * 10n
      : 0n;

    return html`
      <div
        class="fixed top-4 left-1/2 transform -translate-x-1/2 flex justify-center items-center p-1 md:px-1.5 lg:px-4 z-[1100]"
      >
        <div class="flex justify-center items-center gap-1">
          ${myPlayer?.isAlive() && !this.game.inSpawnPhase()
            ? html`
                <div class="overflow-x-auto hide-scrollbar">
                  <div
                    class="grid gap-1 grid-cols-[80px_100px_80px] w-max md:gap-2 md:grid-cols-[90px_120px_90px]"
                  >
                    <div
                      class="flex flex-wrap gap-1 flex-col bg-gray-800/70 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex gap-2 items-center justify-between">
                        <img
                          src=${goldCoinIcon}
                          alt="gold"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        <span class="text-white"
                          >+${renderNumber(goldPerSecond)}</span
                        >
                      </div>
                      <div class="text-white">
                        ${renderNumber(myPlayer.gold())}
                      </div>
                    </div>
                    <div
                      class="flex flex-wrap gap-1 flex-col bg-gray-800/70 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex gap-2 items-center justify-between">
                        <img
                          src=${populationIcon}
                          alt="population"
                          width="20"
                          height="20"
                          style="vertical-align: middle;"
                        />
                        <span
                          class="${this._popRateIsIncreasing
                            ? "text-green-500"
                            : "text-yellow-500"}"
                          translate="no"
                        >
                          +${renderTroops(popRate)}
                        </span>
                      </div>
                      <div class="text-white">
                        ${renderTroops(myPlayer.population())} /
                        ${renderTroops(maxPop)}
                      </div>
                    </div>
                    <div
                      class="flex bg-gray-800/70 border border-slate-400 p-0.5 md:px-1 lg:px-2"
                    >
                      <div class="flex flex-col flex-grow gap-1 w-full ">
                        <div class="flex gap-1">
                          <img
                            src=${troopIcon}
                            alt="troops"
                            width="20"
                            height="20"
                            style="vertical-align: middle;"
                          />
                          <span class="text-white"
                            >${renderTroops(this._troops)}</span
                          >
                        </div>
                        <div class="flex gap-1">
                          <img
                            src=${workerIcon}
                            alt="gold"
                            width="20"
                            height="20"
                            style="vertical-align: middle;"
                          />
                          <span class="text-white"
                            >${renderTroops(this._workers)}</span
                          >
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              `
            : html`<div></div>`}
        </div>
      </div>
    `;
  }
}
