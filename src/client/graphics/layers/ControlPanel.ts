import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Gold } from "../../../core/game/Game";
import {
  BonusEventUpdate,
  DisplayMessageUpdate,
  GameUpdateType,
} from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { ClientID } from "../../../core/Schemas";
import { AttackRatioEvent } from "../../InputHandler";
import { renderNumber, renderTroops } from "../../Utils";
import { UIState } from "../UIState";
import { Layer } from "./Layer";
import donateGoldIconWhite from "/images/DonateGoldIconWhite.svg?url";
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

  @state() private regenPct: number = 0;
  @state() private _tradeAndTrainGoldPerMinute: bigint = 0n;

  private _cachedOptimalMaxTroops: number | null = null;
  private _cachedOptimalRegen: number = 0;
  private _cachedOptimalTroops: number = 0;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;
  private _lastProcessedIncomeTick: number = -1;
  private _incomeWindow: Array<{ atMs: number; amount: bigint }> = [];
  private readonly panelBottomSpacerPx: number = 10;
  private readonly classicSplitBottomSpacerPx: number = 8;

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
      this.uiState.attackRatio = this.attackRatio;
      localStorage.setItem("settings.attackRatio", String(this.attackRatio));
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
    this.updateTradeAndTrainGoldPerMinute();
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

  setVisibile(isVisible: boolean) {
    this._isVisible = isVisible;
    this.requestUpdate();
  }

  private handleRatioSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const newRatio = Number(input.value) / 100;
    this.attackRatio = newRatio;
    localStorage.setItem("settings.attackRatio", String(this.attackRatio));
    this.onAttackRatioChange(this.attackRatio);
    this.requestUpdate();
  }

  private handleAttackTouchStart(e: TouchEvent) {
    // toggle touch-drag UI
    if (this.game?.isRunning() === false) return;
    this._touchDragging = !this._touchDragging;
    e.preventDefault();
    this.requestUpdate();
  }

  private handleBarTouch(e: TouchEvent) {
    // original touch-drag handler (keep existing behavior)
    const touch = e.touches[0];
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const y = touch.clientY - rect.top;
    const ratio = 1 - y / rect.height;
    const clamped = Math.min(1, Math.max(0.01, ratio));
    this.attackRatio = clamped;
    localStorage.setItem("settings.attackRatio", String(this.attackRatio));
    this.onAttackRatioChange(this.attackRatio);
    this.requestUpdate();
    e.preventDefault();
  }

  private predictedTroopIncreaseRate(troops: number, maxTroops: number): number {
    if (maxTroops <= 0) return 0;
    const t = Math.max(0, Math.min(maxTroops, troops));
    let toAdd = 10 + Math.pow(t, 0.73) / 4;
    toAdd *= 1 - t / maxTroops;
    return Math.max(0, Math.min(toAdd, maxTroops - t));
  }

  private getOptimalRegenPoint(maxTroops: number): {
    troops: number;
    regen: number;
  } {
    if (maxTroops <= 1) {
      return { troops: 0, regen: 0 };
    }

    if (this._cachedOptimalMaxTroops === maxTroops) {
      return {
        troops: this._cachedOptimalTroops,
        regen: this._cachedOptimalRegen,
      };
    }

    // Unimodal enough for ternary search on [0, maxTroops].
    let lo = 0;
    let hi = maxTroops;
    for (let i = 0; i < 45; i++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      const f1 = this.predictedTroopIncreaseRate(m1, maxTroops);
      const f2 = this.predictedTroopIncreaseRate(m2, maxTroops);
      if (f1 < f2) {
        lo = m1;
      } else {
        hi = m2;
      }
    }

    const optimalTroops = (lo + hi) / 2;
    const optimalRegen = this.predictedTroopIncreaseRate(
      optimalTroops,
      maxTroops,
    );

    this._cachedOptimalMaxTroops = maxTroops;
    this._cachedOptimalTroops = optimalTroops;
    this._cachedOptimalRegen = optimalRegen;

    return { troops: optimalTroops, regen: optimalRegen };
  }

  private lerpChannel(from: number, to: number, t: number): number {
    return Math.round(from + (to - from) * t);
  }

  private lerpColor(
    from: [number, number, number],
    to: [number, number, number],
    t: number,
  ): string {
    const p = Math.max(0, Math.min(1, t));
    const r = this.lerpChannel(from[0], to[0], p);
    const g = this.lerpChannel(from[1], to[1], p);
    const b = this.lerpChannel(from[2], to[2], p);
    return `rgb(${r}, ${g}, ${b})`;
  }

  private troopFillColor(troops: number, maxTroops: number): string {
    const { troops: optimalTroops } = this.getOptimalRegenPoint(maxTroops);
    const t = Math.max(0, Math.min(maxTroops, troops));

    // too low -> optimal: red to green
    if (t <= optimalTroops) {
      const ratio = optimalTroops <= 0 ? 0 : t / optimalTroops;
      return this.lerpColor([185, 28, 28], [34, 197, 94], ratio);
    }

    // optimal -> near full: green to blue
    const tail = Math.max(1, maxTroops - optimalTroops);
    const ratio = (t - optimalTroops) / tail;
    return this.lerpColor([34, 197, 94], [37, 99, 235], ratio);
  }

  private sumBigInts(values: bigint[]): bigint {
    return values.reduce((sum, v) => sum + v, 0n);
  }

  private updateTradeAndTrainGoldPerMinute() {
    const myPlayer = this.game?.myPlayer();
    if (!myPlayer) {
      this.pruneIncomeWindow();
      return;
    }

    const currentTick = this.game.ticks();
    if (currentTick === this._lastProcessedIncomeTick) {
      this.pruneIncomeWindow();
      return;
    }

    this._lastProcessedIncomeTick = currentTick;

    const updates = this.game.updatesSinceLastTick();
    if (!updates) {
      this.pruneIncomeWindow();
      return;
    }

    const myId = myPlayer.id();

    const tradeDisplayGolds: bigint[] = [];
    const displayEvents = (updates[GameUpdateType.DisplayEvent] ??
      []) as DisplayMessageUpdate[];
    for (const event of displayEvents) {
      if (event.playerID !== myId || event.goldAmount === undefined) continue;
      if (
        event.message === "events_display.received_gold_from_trade" ||
        event.message === "events_display.received_gold_from_captured_ship"
      ) {
        tradeDisplayGolds.push(event.goldAmount);
      }
    }

    const bonusGolds: bigint[] = [];
    const bonusEvents = (updates[GameUpdateType.BonusEvent] ??
      []) as BonusEventUpdate[];
    for (const event of bonusEvents) {
      if (event.player !== myId || event.gold <= 0) continue;
      bonusGolds.push(BigInt(Math.max(0, Math.floor(event.gold))));
    }

    // BonusEvent includes train and some ship gains (destination/captured).
    // Remove bonus entries that match ship display messages, keep remaining as train gain.
    const tradeCounts = new Map<string, number>();
    for (const g of tradeDisplayGolds) {
      const key = g.toString();
      tradeCounts.set(key, (tradeCounts.get(key) ?? 0) + 1);
    }

    let trainGold = 0n;
    for (const bg of bonusGolds) {
      const key = bg.toString();
      const remaining = tradeCounts.get(key) ?? 0;
      if (remaining > 0) {
        tradeCounts.set(key, remaining - 1);
      } else {
        trainGold += bg;
      }
    }

    const shipGold = this.sumBigInts(tradeDisplayGolds);
    const combined = shipGold + trainGold;

    if (combined > 0n) {
      this._incomeWindow.push({ atMs: Date.now(), amount: combined });
    }

    this.pruneIncomeWindow();
  }

  private pruneIncomeWindow() {
    const cutoff = Date.now() - 60_000;
    this._incomeWindow = this._incomeWindow.filter((x) => x.atMs >= cutoff);
    this._tradeAndTrainGoldPerMinute = this._incomeWindow.reduce(
      (sum, x) => sum + x.amount,
      0n,
    );
  }

  renderTroopBar(showLabel: boolean = true, compact: boolean = false) {
    const base = Math.max(this._maxTroops, 1);
    const greenPercentRaw = (this._troops / base) * 100;
    const orangePercentRaw = (this._attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );
    const primaryFillColor = this.troopFillColor(this._troops, base);

    return html`
      <div
        class="w-full ${compact ? "h-[18px] lg:h-5" : "h-5 lg:h-6"} border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="h-full flex">
          ${greenPercent > 0
            ? html`<div
                class="h-full transition-[width] duration-200"
                style="width: ${greenPercent}%; background-color: ${primaryFillColor};"
              ></div>`
            : ""}
          ${orangePercent > 0
            ? html`<div
                class="h-full bg-[#7d807b] transition-[width] duration-200"
                style="width: ${orangePercent}%;"
              ></div>`
            : ""}
        </div>
        ${showLabel
          ? html`<div
              class="absolute inset-0 flex items-center px-1.5 text-xs lg:text-sm font-bold leading-none pointer-events-none"
              translate="no"
            >
              <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] tabular-nums">
                ${renderTroops(this._troops)} / ${renderTroops(this._maxTroops)}
              </span>
            </div>`
          : ""}
      </div>
    `;
  }

  private renderRegenBadge() {
    return html`
      <div
        class="hidden lg:flex items-center justify-center px-1.5 py-1 gap-1 border rounded-md border-gray-500 font-bold text-sm w-auto shrink-0"
        translate="no"
      >
        <img
          src=${soldierIcon}
          width="13"
          height="13"
          class="lg:w-4 lg:h-4 brightness-0 invert"
        />
        <span class="text-white">
          +${renderTroops(this.troopRate)}/s
        </span>
      </div>
    `;
  }

  private renderAttackRatioBadge() {
    return html`
      <div
        class="hidden lg:flex items-center justify-start px-1.5 py-1 gap-1 border rounded-md border-gray-500 font-bold text-sm w-[126px] shrink-0 text-white tabular-nums whitespace-nowrap overflow-hidden"
        translate="no"
      >
        <img
          src=${swordIcon}
          alt=""
          aria-hidden="true"
          width="13"
          height="13"
          class="lg:w-4 lg:h-4"
          style="filter: brightness(0) saturate(100%) invert(71%) sepia(18%) saturate(2015%) hue-rotate(184deg) brightness(102%) contrast(95%);"
        />
        <span>
          ${(this.attackRatio * 100).toFixed(0)}%
          (${renderTroops(
            (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
          )})
        </span>
      </div>
    `;
  }

  private renderGoldPerMinuteBadge(
    hideOnMobile: boolean = true,
    compact: boolean = false,
  ) {
    const layoutClass = hideOnMobile ? "hidden lg:flex" : "inline-flex";
    return html`
      <div
        class="${layoutClass} items-center justify-center ${compact ? "px-1 py-1 w-[84px] text-[11px] lg:text-xs" : "px-1.5 py-1 w-[92px] text-xs lg:text-sm"} gap-1 border rounded-md border-gray-500 font-bold text-yellow-300 shrink-0 whitespace-nowrap"
        translate="no"
      >
        <img
          src=${donateGoldIconWhite}
          width="13"
          height="13"
          class="w-3.5 h-3.5"
        />
        <span>+${renderNumber(this._tradeAndTrainGoldPerMinute)}/m</span>
      </div>
    `;
  }

  private isClassicLayoutEnabled(): boolean {
    return document.body.classList.contains("control-panel-style-classic");
  }

  private renderClassicLayout() {
    const isClassicMapLayout = document.body.classList.contains("layout-classic");
    const panelScale = isClassicMapLayout ? 1.1 : 1;
    const panelScaleOrigin = isClassicMapLayout
      ? "bottom left"
      : "bottom center";
    const classicPanelBottomSpacerPx = isClassicMapLayout
      ? this.panelBottomSpacerPx
      : this.classicSplitBottomSpacerPx;
    return html`
      <div
        class="relative pointer-events-auto ${this._isVisible
          ? "relative z-[60] w-full lg:max-w-[540px] text-sm bg-gray-800/80 px-2 py-1.5 shadow-lg sm:rounded-tr-lg min-[1200px]:rounded-lg backdrop-blur-xs border border-white/10"
          : "hidden"}"
        style="transform: scale(${panelScale}); transform-origin: ${panelScaleOrigin};"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="grid ${isClassicMapLayout
            ? "grid-cols-[minmax(0,1fr)_92px] gap-1"
            : "grid-cols-[minmax(0,1fr)_98px] gap-1"}"
        >
          <div class="min-w-0">
            ${isClassicMapLayout
              ? html`
                  <div
                    class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs lg:text-sm text-white font-semibold"
                    translate="no"
                  >
                    <div class="min-w-0">
                      <span class="font-bold">Troops:</span>
                      <span class="ml-2 tabular-nums"
                        >${renderTroops(this._troops)} / ${renderTroops(
                          this._maxTroops,
                        )}</span
                      >
                    </div>
                    <div class="inline-flex items-center gap-1 tabular-nums text-white/95">
                      <img
                        src=${soldierIcon}
                        width="13"
                        height="13"
                        class="w-3.5 h-3.5 brightness-0 invert"
                      />
                      +${renderTroops(this.troopRate)}/s
                    </div>
                  </div>

                  <div class="mt-1.5">
                    <div class="w-full min-w-0">${this.renderTroopBar(false, true)}</div>
                  </div>

                  <div class="mt-1.5 pt-1.5 border-t border-white/10" translate="no">
                    <div class="flex items-center gap-1 text-white text-xs lg:text-sm font-semibold">
                      <img
                        src=${swordIcon}
                        alt=""
                        aria-hidden="true"
                        width="14"
                        height="14"
                        class="w-3.5 h-3.5"
                        style="filter: brightness(0) saturate(100%) invert(71%) sepia(18%) saturate(2015%) hue-rotate(184deg) brightness(102%) contrast(95%);"
                      />
                      <span>Attack ratio :</span>
                      <span>${(this.attackRatio * 100).toFixed(0)}%</span>
                      <span class="inline-block relative -top-1"
                        >(${renderTroops(
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
                      class="mt-1 w-full min-w-0 h-1.5 accent-blue-400 cursor-pointer"
                    />
                  </div>
                `
              : html`
                  <div class="flex items-center gap-1 text-xs lg:text-sm text-white font-semibold" translate="no">
                    <span class="font-bold shrink-0">Troops:</span>
                    <div class="min-w-0 flex-1">${this.renderTroopBar(true, true)}</div>
                    <div class="inline-flex items-center gap-1 tabular-nums text-white/95 shrink-0">
                      <img
                        src=${soldierIcon}
                        width="13"
                        height="13"
                        class="w-3.5 h-3.5 brightness-0 invert"
                      />
                      +${renderTroops(this.troopRate)}/s
                    </div>
                  </div>

                  <div class="mt-2.5 pt-1.5 border-t border-white/10 flex items-center gap-1 text-white text-xs lg:text-sm font-semibold" translate="no">
                    <div class="shrink-0 w-[190px] inline-flex items-center gap-1 tabular-nums whitespace-nowrap overflow-hidden">
                      <img
                        src=${swordIcon}
                        alt=""
                        aria-hidden="true"
                        width="14"
                        height="14"
                        class="w-3.5 h-3.5"
                        style="filter: brightness(0) saturate(100%) invert(71%) sepia(18%) saturate(2015%) hue-rotate(184deg) brightness(102%) contrast(95%);"
                      />
                      <span class="truncate">
                        Attack ratio : ${(this.attackRatio * 100).toFixed(0)}%
                        (${renderTroops(
                          (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
                        )})
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      .value=${String(Math.round(this.attackRatio * 100))}
                      @input=${(e: Event) => this.handleRatioSliderInput(e)}
                      class="w-full min-w-0 h-1.5 accent-blue-400 cursor-pointer"
                    />
                  </div>
                `}
          </div>

          <div
            class="min-w-0 ${isClassicMapLayout ? "pl-1" : "pl-1.5"} border-l border-white/10 flex flex-col items-end gap-0.5"
            translate="no"
          >
            <span class="text-white text-xs lg:text-sm font-bold text-right leading-none">
              Gold
            </span>
            <span
              class="inline-flex items-center justify-center self-end px-1.5 py-0.5 gap-1 border rounded-md border-yellow-400 font-bold text-yellow-400 text-xs lg:text-sm tabular-nums"
            >
              <img
                src=${goldCoinIcon}
                width="13"
                height="13"
                class="w-3.5 h-3.5 lg:w-4 lg:h-4"
              />
              ${renderNumber(this._gold)}
            </span>
            <span class="inline-flex items-center self-end gap-1 text-yellow-300 tabular-nums text-[11px] lg:text-xs">
              <img
                src=${donateGoldIconWhite}
                width="13"
                height="13"
                class="w-3.5 h-3.5"
              />
              +${renderNumber(this._tradeAndTrainGoldPerMinute)}/m
            </span>
          </div>
        </div>
        <div
          class="w-full"
          style="height: ${classicPanelBottomSpacerPx}px;"
          aria-hidden="true"
        ></div>

        ${this._touchDragging
          ? html`
              <div
                class="absolute bottom-full right-0 flex flex-col items-center pointer-events-auto z-[10000] bg-gray-800/70 backdrop-blur-xs rounded-tl-lg sm:rounded-lg p-2 w-12"
                style="height: 50vh;"
                @touchstart=${(e: TouchEvent) => this.handleBarTouch(e)}
              >
                <span class="text-red-400 text-sm font-bold mb-1" translate="no"
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
    `;
  }

  render() {
    if (this.isClassicLayoutEnabled()) {
      return this.renderClassicLayout();
    }

    const isClassicMapLayout = document.body.classList.contains("layout-classic");
    const splitPanelMaxWidthClass = isClassicMapLayout
      ? "lg:max-w-[700px]"
      : "lg:max-w-[540px]";
    const splitPanelBottomSpacerPx = isClassicMapLayout
      ? this.panelBottomSpacerPx
      : 0;

    return html`
      <div
        class="relative pointer-events-auto ${this._isVisible
          ? `relative z-[60] w-full ${splitPanelMaxWidthClass} text-sm bg-gray-800/70 px-2 py-2 lg:px-2 lg:py-2 shadow-lg sm:rounded-tr-lg min-[1200px]:rounded-lg backdrop-blur-xs`
          : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div class="flex gap-2 lg:gap-2 items-center">
          ${this.renderRegenBadge()}

          <!-- Troop bar -->
          <div class="w-3/5 lg:flex-1">${this.renderTroopBar()}</div>

          <!-- Gold -->
          <div
            class="flex flex-col items-end gap-0.5 w-1/5 lg:w-auto shrink-0"
            translate="no"
          >
            <div
              class="flex items-center justify-center px-1.5 py-1 lg:gap-1 border rounded-md border-yellow-400 font-bold text-yellow-400 text-xs lg:text-sm"
            >
              <img
                src=${goldCoinIcon}
                width="13"
                height="13"
                class="lg:w-4 lg:h-4"
              />
              <span class="px-0.5">${renderNumber(this._gold)}</span>
            </div>
          </div>

          <!-- Mobile quick ratio (kept) -->
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
                  style="filter: brightness(0) saturate(100%) invert(71%) sepia(18%) saturate(2015%) hue-rotate(184deg) brightness(102%) contrast(95%);"
                />
                ${(this.attackRatio * 100).toFixed(0)}%
              </div>
              <div class="text-[10px] text-red-400 tabular-nums" translate="no">
                (${renderTroops(
                  (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
                )})
              </div>
            </div>
            <div class="shrink-0">
              <div
                class="w-1.5 h-8 bg-white/20 rounded-full relative overflow-hidden"
              >
                <div
                  class="absolute bottom-0 w-full bg-red-500 rounded-full transition-all duration-200"
                  style="height: ${this.attackRatio * 100}%"
                ></div>
              </div>
            </div>
          </div>
        </div>

        ${this._touchDragging
          ? html`
              <div
                class="absolute bottom-full right-0 flex flex-col items-center pointer-events-auto z-[10000] bg-gray-800/70 backdrop-blur-xs rounded-tl-lg sm:rounded-lg p-2 w-12"
                style="height: 50vh;"
                @touchstart=${(e: TouchEvent) => this.handleBarTouch(e)}
              >
                <span class="text-red-400 text-sm font-bold mb-1" translate="no"
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

        <!-- Attack Ratio -->
        <div class="mt-1 flex items-center gap-2" translate="no">
          ${this.renderAttackRatioBadge()}

          <div class="w-full lg:flex-1">
            <input
              type="range"
              min="1"
              max="100"
              .value=${String(Math.round(this.attackRatio * 100))}
              @input=${(e: Event) => this.handleRatioSliderInput(e)}
              class="w-full min-w-0 h-1.5 accent-blue-400 cursor-pointer"
            />
          </div>

          ${this.renderGoldPerMinuteBadge(true, isClassicMapLayout)}

          <span class="shrink-0 text-xs font-bold text-white tabular-nums lg:hidden">
            ${(this.attackRatio * 100).toFixed(0)}%
          </span>
        </div>

        <div
          class="w-full"
          style="height: ${splitPanelBottomSpacerPx}px;"
          aria-hidden="true"
        ></div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
