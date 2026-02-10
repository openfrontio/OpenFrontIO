import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Gold } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import goldCoinIcon from "/images/GoldCoinIcon.svg?url";
import soldierIcon from "/images/SoldierIcon.svg?url";
import swordIcon from "/images/SwordIcon.svg?url";

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
  private troopRate: number;

  @state()
  private _troops: number;

  @state()
  private _isVisible = false;

  @state()
  private _gold: Gold;

  @state()
  private _attackingTroops: number = 0;

  @state()
  private _touchDragging = false;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;

  getTickIntervalMs() {
    return 100;
  }

  init() {
    this.attackRatio = Number(
      localStorage.getItem("settings.attackRatio") ?? "0.2",
    );
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(AttackRatioEvent, (event) => {
      let newAttackRatio = this.attackRatio + event.attackRatio / 100;

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

    this.updateTroopIncrease();

    this._maxTroops = this.game.config().maxTroops(player);
    this._gold = player.gold();
    this._troops = player.troops();
    this._attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    this.troopRate = this.game.config().troopIncreaseRate(player) * 10;
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

  private _outsideTouchHandler: ((ev: Event) => void) | null = null;

  private handleAttackTouchStart(e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (this._touchDragging) {
      this.closeAttackBar();
      return;
    }

    this._touchDragging = true;

    setTimeout(() => {
      this._outsideTouchHandler = () => {
        this.closeAttackBar();
      };
      document.addEventListener("touchstart", this._outsideTouchHandler);
    }, 0);
  }

  private closeAttackBar() {
    this._touchDragging = false;
    if (this._outsideTouchHandler) {
      document.removeEventListener("touchstart", this._outsideTouchHandler);
      this._outsideTouchHandler = null;
    }
  }

  private handleBarTouch(e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();

    this.setRatioFromTouch(e.touches[0]);

    const onMove = (ev: TouchEvent) => {
      ev.preventDefault();
      this.setRatioFromTouch(ev.touches[0]);
    };

    const onEnd = () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };

    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }

  private setRatioFromTouch(touch: Touch) {
    const barEl = this.querySelector(".attack-drag-bar");
    if (!barEl) return;

    const rect = barEl.getBoundingClientRect();
    const ratio = (rect.bottom - touch.clientY) / (rect.bottom - rect.top);
    this.attackRatio =
      Math.round(Math.max(1, Math.min(100, ratio * 100))) / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private handleRatioSliderInput(e: Event) {
    const value = Number((e.target as HTMLInputElement).value);
    this.attackRatio = value / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private renderTroopBar() {
    const base = Math.max(this._maxTroops, 1);
    const greenPercentRaw = (this._troops / base) * 100;
    const orangePercentRaw = (this._attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full h-6 lg:h-8 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full bg-green-500 transition-[width] duration-200"
                style="width: ${greenPercent}%;"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-orange-400 transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 lg:px-2 text-xs lg:text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._troops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${renderTroops(this._maxTroops)}</span
          >
        </div>
        <div
          class="absolute inset-0 flex items-center justify-center gap-0.5 pointer-events-none"
          translate="no"
        >
          <img
            src=${soldierIcon}
            alt=""
            aria-hidden="true"
            width="12"
            height="12"
            class="lg:w-4 lg:h-4 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
          />
          <span
            class="text-[10px] lg:text-xs font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] ${this
              ._troopRateIsIncreasing
              ? "text-green-400"
              : "text-orange-400"}"
            >+${renderTroops(this.troopRate)}/s</span
          >
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div
        class="pointer-events-auto ${this._isVisible
          ? "relative z-[60] w-full max-lg:landscape:fixed max-lg:landscape:bottom-0 max-lg:landscape:left-0 max-lg:landscape:w-1/2 max-lg:landscape:z-50 lg:max-w-[400px] text-sm lg:text-base bg-gray-800/70 p-1.5 pr-2 lg:p-5 shadow-lg lg:rounded-tr-xl min-[1200px]:rounded-xl backdrop-blur-sm"
          : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex gap-2 lg:gap-3 items-center">
          <!-- Gold: 1/4 -->
          <div
            class="flex items-center justify-center p-1 lg:p-1.5 lg:gap-1 border rounded-md border-yellow-400 font-bold text-yellow-400 text-xs lg:text-sm w-1/5 lg:w-auto shrink-0"
            translate="no"
          >
            <img
              src=${goldCoinIcon}
              width="13"
              height="13"
              class="lg:w-4 lg:h-4"
            />
            <span class="px-0.5">${renderNumber(this._gold)}</span>
          </div>
          <!-- Troop bar: 2/4 -->
          <div class="w-3/5 lg:flex-1">${this.renderTroopBar()}</div>
          <!-- Attack ratio: 1/4 -->
          <div
            class="relative w-1/5 shrink-0 flex items-center justify-center gap-1 cursor-pointer lg:hidden"
            @touchstart=${(e: TouchEvent) => this.handleAttackTouchStart(e)}
          >
            <div class="flex flex-col items-center w-10 shrink-0">
              <div
                class="flex items-center gap-0.5 text-white text-xs font-bold tabular-nums"
                translate="no"
              >
                <img
                  src=${swordIcon}
                  alt=""
                  aria-hidden="true"
                  width="10"
                  height="10"
                  class="brightness-0 invert sepia saturate-[10000%] hue-rotate-[0deg]"
                  style="filter: brightness(0) saturate(100%) invert(36%) sepia(95%) saturate(5500%) hue-rotate(350deg) brightness(95%) contrast(95%);"
                />
                ${(this.attackRatio * 100).toFixed(0)}%
              </div>
              <div class="text-[10px] text-red-400 tabular-nums" translate="no">
                (${renderTroops(
                  (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
                )})
              </div>
            </div>
            <!-- Small red vertical bar indicator -->
            <div class="relative shrink-0">
              <div
                class="w-1.5 h-8 bg-white/20 rounded-full relative overflow-hidden"
              >
                <div
                  class="absolute bottom-0 w-full bg-red-500 rounded-full transition-all duration-200"
                  style="height: ${this.attackRatio * 100}%"
                ></div>
              </div>
              ${this._touchDragging
                ? html`
                    <div
                      class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 flex flex-col items-center pointer-events-auto z-[10000] bg-gray-800/80 backdrop-blur-sm rounded-lg p-2 w-12"
                      style="height: 50vh;"
                      @touchstart=${(e: TouchEvent) => this.handleBarTouch(e)}
                    >
                      <span
                        class="text-red-400 text-sm font-bold mb-1"
                        translate="no"
                        >${(this.attackRatio * 100).toFixed(0)}%</span
                      >
                      <div
                        class="attack-drag-bar flex-1 w-3 bg-white/20 rounded-full relative overflow-hidden"
                      >
                        <div
                          class="absolute bottom-0 w-full bg-red-500 rounded-full"
                          style="height: ${this.attackRatio * 100}%"
                        ></div>
                      </div>
                    </div>
                  `
                : ""}
            </div>
          </div>
        </div>
        <!-- Attack ratio bar (desktop, always visible) -->
        <div class="hidden lg:block mt-2">
          <div
            class="flex items-center justify-between text-sm font-bold mb-1"
            translate="no"
          >
            <span class="text-white flex items-center gap-1"
              ><img
                src=${swordIcon}
                alt=""
                aria-hidden="true"
                width="14"
                height="14"
                style="filter: brightness(0) saturate(100%) invert(36%) sepia(95%) saturate(5500%) hue-rotate(350deg) brightness(95%) contrast(95%);"
              />Attack Ratio</span
            >
            <span class="text-white tabular-nums"
              >${(this.attackRatio * 100).toFixed(0)}%
              (${renderTroops(
                (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
              )})</span
            >
          </div>
          <input
            type="range"
            min="1"
            max="100"
            .value=${String(Math.round(this.attackRatio * 100))}
            @input=${(e: Event) => this.handleRatioSliderInput(e)}
            class="w-full h-2 accent-red-500 cursor-pointer"
          />
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
