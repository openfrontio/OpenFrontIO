import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { Gold, UnitType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";

@customElement("control-panel")
export class ControlPanel extends LitElement implements Layer {
  public game: GameView;
  public clientID: ClientID;
  public eventBus: EventBus;
  public uiState: UIState;

  @state()
  private attackRatio: number = 0.2;

  @state()
  private _maxTroops: number;

  @state()
  private _maxTroopsTerritory: number = 0;

  @state()
  private _maxTroopsCity: number = 0;

  @state()
  private _troopsTerritory: number = 0;

  @state()
  private _troopsCity: number = 0;

  @state()
  private troopRate: number;

  @state()
  private _troops: number;

  @state()
  private _isVisible = false;

  @state()
  private _gold: Gold;

  @state()
  private _troopsOnMission: number = 0;

  @state()
  private _playerColor: string = "";

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio =
        (parseInt(
          (document.getElementById("attack-ratio") as HTMLInputElement).value,
        ) +
          event.attackRatio) /
        100;

      if (newAttackRatio < 0.01) {
        newAttackRatio = 0.01;
      }

      if (newAttackRatio > 1) {
        newAttackRatio = 1;
      }

      if (newAttackRatio === 0.11 && this.attackRatio === 0.01) {
        // If we're changing the ratio from 1%, then set it to 10% instead of 11% to keep a consistency
        newAttackRatio = 0.1;
      }

      this.attackRatio = newAttackRatio;
      this.onAttackRatioChange(this.attackRatio);
    });
  }

  tick() {
    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this.setVisibile(true);
    }

    const player = this.game.myPlayer();
    if (player === null || !player.isAlive()) {
      this.setVisibile(false);
      return;
    }

    if (this.game.ticks() % 5 === 0) {
      this.updateTroopIncrease();
    }

    this._gold = player.gold();
    this._troops = player.troops();
    this.troopRate = this.game.config().troopIncreaseRate(player) * 10;

    const outgoingAttacks = player.outgoingAttacks();

    const attackTroops = outgoingAttacks.reduce(
      (sum, attack) => sum + attack.troops,
      0,
    );

    const boatTroops = player
      .units(UnitType.TransportShip)
      .reduce((sum, boat) => sum + boat.troops(), 0);

    this._troopsOnMission = attackTroops + boatTroops;

    try {
      const config = this.game.config();
      this._maxTroopsTerritory = Math.round(config.maxTroopsTerritory(player));
      this._maxTroopsCity = Math.round(config.maxTroopsCity(player));
      this._maxTroops = Math.round(config.maxTroops(player));

      // Get estimated breakdown of current troops
      this._troopsTerritory = config.estimatedTroopsTerritory(player);
      this._troopsCity = config.estimatedTroopsCity(player);
    } catch (e) {
      console.warn("Failed to calculate capacity breakdown:", e);
      this._maxTroopsTerritory = 0;
      this._maxTroopsCity = 0;
      this._maxTroops = 0;
      this._troopsTerritory = 0;
      this._troopsCity = 0;
    }

    this._playerColor =
      player.territoryColor()?.toRgbString() ??
      this.game.config().theme().neutralColor().toRgbString();

    this.requestUpdate();
  }

  private updateTroopIncrease() {
    const player = this.game?.myPlayer();
    if (player === null) return;
    const troopIncreaseRate = this.game.config().troopIncreaseRate(player);
    this._troopRateIsIncreasing =
      troopIncreaseRate >= this._lastTroopIncreaseRate;
    this._lastTroopIncreaseRate = troopIncreaseRate;
  }

  onAttackRatioChange(newRatio: number) {
    this.uiState.attackRatio = newRatio;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    // Render any necessary canvas elements
  }

  shouldTransform(): boolean {
    return false;
  }

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  render() {
    const playerColor = this._playerColor;

    return html`
      <style>
        input[type="range"] {
          -webkit-appearance: none;
          background: transparent;
          outline: none;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: white;
          border-width: 2px;
          border-style: solid;
          border-radius: 50%;
          cursor: pointer;
        }
        .targetTroopRatio::-webkit-slider-thumb {
          border-color: rgb(59 130 246);
        }
        .targetTroopRatio::-moz-range-thumb {
          border-color: rgb(59 130 246);
        }
        .attackRatio::-webkit-slider-thumb {
          border-color: rgb(239 68 68);
        }
        .attackRatio::-moz-range-thumb {
          border-color: rgb(239 68 68);
        }
      </style>
      <div
        class="${this._isVisible
          ? "w-full sm:max-w-[320px] text-sm sm:text-base bg-gray-800/70 p-2 pr-3 sm:p-4 shadow-lg sm:rounded-lg backdrop-blur"
          : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="block bg-black/30 text-white mb-4 p-2 rounded">
          <div class="flex justify-between mb-1">
            <span class="font-bold"
              >${translateText("control_panel.troops")}:</span
            >
            <span translate="no"
              >${renderTroops(this._troops)} / ${renderTroops(this._maxTroops)}
              <span
                class="${this._troopRateIsIncreasing
                  ? "text-green-500"
                  : "text-yellow-500"}"
                translate="no"
                >(+${renderTroops(this.troopRate)})</span
              ></span
            >
          </div>
          <!-- Max troops breakdown bar -->
          <div
            role="progressbar"
            aria-valuenow="${this._troops + this._troopsOnMission}"
            aria-valuemin="0"
            aria-valuemax="${this._maxTroops}"
            aria-label="Troop capacity: ${this._troops} available, ${this
              ._troopsOnMission} on mission, ${this._maxTroops} maximum"
            aria-describedby="troop-capacity-description"
            class="h-1 bg-black/50 rounded-full overflow-hidden mt-2 mb-3"
          >
            <div
              class="flex h-full"
              style="width: ${this._maxTroops > 0
                ? Math.min(
                    ((this._troops + this._troopsOnMission) / this._maxTroops) *
                      100,
                    100,
                  )
                : 0}%"
            >
              <!-- Available troops (territory + cities) -->
              <div class="flex" style="flex-grow: ${this._troops}">
                <div
                  class="h-full opacity-60"
                  style="background-color: ${playerColor}; flex-grow: ${this
                    ._troopsTerritory}"
                ></div>
                ${this._troopsCity > 0
                  ? html`<div
                      class="h-full opacity-80"
                      style="background-color: ${playerColor}; flex-grow: ${this
                        ._troopsCity}"
                    ></div>`
                  : ""}
              </div>
              <!-- Troops on mission -->
              ${this._troopsOnMission > 0
                ? html`<div
                    class="h-full bg-red-600 opacity-50"
                    style="flex-grow: ${this._troopsOnMission}"
                  ></div>`
                : ""}
            </div>
          </div>
          <span id="troop-capacity-description" class="sr-only">
            Colored bar segments represent territory capacity (lighter shade)
            and city capacity (darker shade). Red segment shows troops currently
            on mission.
          </span>
          <div class="flex justify-between">
            <span class="font-bold"
              >${translateText("control_panel.gold")}:</span
            >
            <span translate="no">${renderNumber(this._gold)}</span>
          </div>
        </div>

        <div class="relative mb-0 sm:mb-4">
          <label class="block text-white mb-1" translate="no"
            >${translateText("control_panel.attack_ratio")}:
            ${(this.attackRatio * 100).toFixed(0)}%
            (${renderTroops(
              (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
            )})</label
          >
          <div class="relative h-8">
            <!-- Background track -->
            <div
              class="absolute left-0 right-0 top-3 h-2 bg-white/20 rounded"
            ></div>
            <!-- Fill track -->
            <div
              class="absolute left-0 top-3 h-2 bg-red-500/60 rounded transition-all duration-300"
              style="width: ${this.attackRatio * 100}%"
            ></div>
            <!-- Range input - exactly overlaying the visual elements -->
            <input
              id="attack-ratio"
              type="range"
              min="1"
              max="100"
              .value=${(this.attackRatio * 100).toString()}
              @input=${(e: Event) => {
                this.attackRatio =
                  parseInt((e.target as HTMLInputElement).value) / 100;
                this.onAttackRatioChange(this.attackRatio);
              }}
              class="absolute left-0 right-0 top-2 m-0 h-4 cursor-pointer attackRatio"
            />
          </div>
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
