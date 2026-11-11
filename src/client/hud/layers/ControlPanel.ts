import { TileRef } from "@openfront/engine-api/game/GameMap";
import { GameMode, GameType, Gold } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { ClientID } from "@openfront/engine-api/Schemas";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { EventBus } from "@openfront/shared/EventBus";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { Controller } from "../../Controller";
import { AttackRatioEvent, isForwardedClick } from "../../InputHandler";
import { UIState } from "../../UIState";
import { USER_SETTINGS_CHANGED_EVENT, UserSettings } from "../../UserSettings";
import { getGamesPlayed, translateText } from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import "../../components/OfIcon";
import { TICKS_PER_SECOND, ticksToSeconds } from "../GameTicks";
import { goldCoinIcon } from "../HotbarIcons";
import { OnboardingLowTroopsEvent } from "../Onboarding";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";
const swordIcon = assetUrl("images/SwordIcon.svg");

// Look. Sizes, colours, radii and spacing of each part live here, so a
// change of look is one edit. The templates below only hold structure.
const PANEL = "relative w-full px-2 py-1 text-sm lg:p-2";
// Below lg one row: gold, troop bar, ratio label, slider. From lg two rows,
// the rate chip over the ratio label in the first column. That column's 8rem
// is RATE's width: keep the two equal.
const GRID =
  "grid grid-cols-[auto_minmax(0,8fr)_auto_minmax(0,5fr)] items-center gap-x-2 lg:grid-cols-[8rem_minmax(0,1fr)_auto] lg:gap-y-1";
const CHIP = "flex h-6 items-center rounded-sm font-bold tabular-nums";
const BAR_TEXT_SHADOW = "drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]";
// The well is darker than the panel on purpose: it keeps the white numbers
// readable over a bright map when the HUD is see-through.
const TRACK = "rounded-sm border bg-black/40";
const TRACK_BORDER = {
  calm: "border-transparent",
  alert: "border-red-500",
} as const;
const TROOP_FILL = "bg-malibu-blue";
const TROOPS_OUT = "bg-sky-300";
const TROOPS = `gap-1 ps-1.5 text-xs font-bold text-white lg:text-base ${BAR_TEXT_SHADOW}`;
const MAX_TROOPS =
  "me-0.5 h-5 gap-1 rounded-xs bg-black/50 px-1 text-[11px] font-bold text-white lg:px-1.5 lg:text-[13px]";
// Inside the bar below lg; from lg a chip in the grid's empty first column.
const RATE = `ms-1.5 text-[11px] transition-colors duration-700 ${BAR_TEXT_SHADOW} lg:absolute lg:inset-y-0 lg:end-full lg:me-2 lg:w-[8rem] lg:justify-center lg:text-[13px] lg:drop-shadow-none`;
const RATE_TREND = {
  up: "text-green-400 lg:bg-green-400/12",
  down: "text-orange-400 lg:bg-orange-400/14",
} as const;
const GOLD =
  "justify-center gap-0.5 rounded-md border border-yellow-400 p-1 text-xs font-bold text-yellow-400 min-w-16 lg:justify-start lg:gap-1 lg:px-1 lg:py-0.5 lg:text-sm lg:min-w-[4.5rem]";
const GOLD_POP =
  "absolute -top-5 right-[5px] min-[1015px]:right-[9px] text-green-400 text-xs lg:text-sm font-extrabold tabular-nums whitespace-nowrap pointer-events-none drop-shadow-[0_2px_3px_rgba(0,0,0,0.9)]";
const RATIO =
  "justify-center gap-0.5 font-bold tabular-nums text-white lg:justify-start lg:gap-1 lg:rounded-md lg:border lg:border-gray-600 lg:px-1 lg:py-0.5 lg:text-sm";
const SLIDER = "h-1.5 accent-aquarius";

@customElement("control-panel")
export class ControlPanel extends LitElement implements Controller {
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
  private _notification: { type: "warning" | "info"; message: string } | null =
    null;

  @state()
  private _gold: Gold;

  @state()
  private _attackingTroops: number = 0;

  @state()
  private _goldGain: bigint | null = null;
  @state()
  private _goldGainPulseId: number = 0;
  private _goldGainTimeoutId: ReturnType<typeof setTimeout> | null = null;

  @state()
  private _tutorialHighlight: TutorialHighlight | null = null;
  /** The onboarding tutorial's low-troops warning is up: flash the bar. */
  @state()
  private _lowTroopsAlert = false;

  private _troopRateIsIncreasing: boolean = true;

  private _lastTroopIncreaseRate: number;

  // Border detection cache
  private _nearbyPlayerIDs: Set<number> = new Set();
  private _borderRefreshCounter: number = 0;
  private _borderTilesPromise: Promise<void> | null = null;
  // Track last attack tick per target player (for 15-second threshold)
  private _lastAttackTickByTarget: Map<number, number> = new Map();
  private static readonly BORDER_REFRESH_INTERVAL = 10; // recompute every 1s
  private static readonly ATTACK_THRESHOLD_TICKS = 15 * TICKS_PER_SECOND;

  connectedCallback() {
    super.connectedCallback();
    // The attack ratio is cached below for the lifetime of the game, but the
    // settings modal is now reachable mid-match, so follow the stored value
    // when it changes there. (This panel's own slider is session-only: it
    // never writes UserSettings, so there is no loop.)
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.attackRatio`,
      this.onAttackRatioSettingChanged,
    );
  }

  init() {
    this.attackRatio = new UserSettings().attackRatio();
    this.uiState.attackRatio = this.attackRatio;
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this._tutorialHighlight = e.target;
    });
    this.eventBus.on(OnboardingLowTroopsEvent, (e) => {
      this._lowTroopsAlert = e.low;
    });
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

    const config = this.game.config();
    this._maxTroops = config.maxTroops(player);
    this._gold = player.gold();
    this._troops = player.troops();
    this._attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    this.troopRate = config.troopIncreaseRate(player) * TICKS_PER_SECOND;

    const helpEnabled = new UserSettings().helpMessages();

    // Don't target veteran players
    if (helpEnabled && getGamesPlayed() < 20) {
      // Track outgoing attacks for 15-second threshold
      this.trackOutgoingAttacks(player);

      // Refresh border detection cache periodically
      this.refreshNearbyPlayers(player);

      // Compute notification
      this._notification = this.computeNotification(player, config);
    }

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      const myID = player.id();
      const bonusEvents = updates[GameUpdateType.BonusEvent];
      if (bonusEvents) {
        for (const ev of bonusEvents) {
          if (ev.player === myID && ev.gold > 0) {
            this.addGoldGain(BigInt(ev.gold));
          }
        }
      }
      const conquestEvents = updates[GameUpdateType.ConquestEvent];
      if (conquestEvents) {
        for (const ev of conquestEvents) {
          if (ev.conquerorId === myID && ev.gold > 0n) {
            this.addGoldGain(ev.gold);
          }
        }
      }
      const donateEvents = updates[GameUpdateType.DonateEvent];
      if (donateEvents) {
        for (const ev of donateEvents) {
          if (
            ev.donationType === "gold" &&
            ev.recipientId === myID &&
            ev.amount > 0n
          ) {
            this.addGoldGain(ev.amount);
          }
        }
      }
    }

    this.requestUpdate();
  }

  // Last-wins: when multiple gold events arrive in one tick, the pip shows
  // only the most recent amount (not a sum) — each gain restarts the pulse.
  private addGoldGain(amount: bigint) {
    this._goldGain = amount;
    this._goldGainPulseId++;
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
    }
    this._goldGainTimeoutId = setTimeout(() => {
      this._goldGain = null;
      this._goldGainTimeoutId = null;
      this.requestUpdate();
    }, 2000);
  }

  private trackOutgoingAttacks(player: PlayerView) {
    const currentTick = this.game.ticks();
    for (const attack of player.outgoingAttacks()) {
      if (attack.targetID !== 0 && !attack.retreating) {
        this._lastAttackTickByTarget.set(attack.targetID, currentTick);
      }
    }
    // Clean up old entries
    for (const [playerID, tick] of this._lastAttackTickByTarget.entries()) {
      if (currentTick - tick > ControlPanel.ATTACK_THRESHOLD_TICKS * 2) {
        this._lastAttackTickByTarget.delete(playerID);
      }
    }
  }

  private refreshNearbyPlayers(player: PlayerView) {
    this._borderRefreshCounter++;
    if (
      this._borderRefreshCounter < ControlPanel.BORDER_REFRESH_INTERVAL ||
      this._borderTilesPromise !== null
    ) {
      return;
    }
    this._borderRefreshCounter = 0;
    this._borderTilesPromise = player.borderTiles().then((bt) => {
      this._borderTilesPromise = null;
      const myID = player.smallID();
      const nearby = new Set<number>();
      for (const tile of bt.borderTiles) {
        for (const neighbor of this.game.neighbors(tile as TileRef)) {
          const ownerID = this.game.ownerID(neighbor);
          if (ownerID !== 0 && ownerID !== myID) {
            nearby.add(ownerID);
          }
        }
      }
      this._nearbyPlayerIDs = nearby;
    });
  }

  private computeNotification(
    player: PlayerView,
    config: Config,
  ): { type: "warning" | "info"; message: string } | null {
    const currentTick = this.game.ticks();

    // Army limit warning
    const { gameMode, gameType } = config.gameConfig();
    const isPublicTeamGame =
      gameMode === GameMode.Team && gameType === GameType.Public;
    const canDonateTroops = config.donateTroops();
    if (isPublicTeamGame && canDonateTroops) {
      const ratio = this._troops / Math.max(this._maxTroops, 1);
      if (ratio >= config.armyLimitWarningThreshold()) {
        return {
          type: "warning",
          message: "control_panel.army_limit_warning",
        };
      }
    }

    // Low troops (Less than 1k) warning
    if (this._troops < 10000 && this._troops > 0) {
      return { type: "warning", message: "control_panel.low_troops_warning" };
    }

    // Info messages: check nearby players for traitors, AFK allies, AFK teammates
    for (const nearbyID of this._nearbyPlayerIDs) {
      let other;
      try {
        other = this.game.playerBySmallID(nearbyID);
      } catch {
        continue;
      }
      if (!other.isPlayer() || !other.isAlive()) continue;

      const lastAttackTick = this._lastAttackTickByTarget.get(nearbyID) ?? -1;
      const secondsSinceAttack = ticksToSeconds(currentTick - lastAttackTick);
      const hasNotAttackedRecently =
        lastAttackTick < 0 || secondsSinceAttack > 15;

      if (!hasNotAttackedRecently) continue;

      if (other.isTraitor() && player.isAlliedWith(other)) {
        return { type: "info", message: "control_panel.traitor_neighbor_info" };
      }
      if (other.isDisconnected() && player.isAlliedWith(other)) {
        return {
          type: "info",
          message: "control_panel.allied_afk_neighbor_info",
        };
      }
      if (other.isDisconnected() && player.isOnSameTeam(other)) {
        return {
          type: "info",
          message: "control_panel.teammate_afk_neighbor_info",
        };
      }
    }

    return null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    globalThis.removeEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:settings.attackRatio`,
      this.onAttackRatioSettingChanged,
    );
    if (this._goldGainTimeoutId !== null) {
      clearTimeout(this._goldGainTimeoutId);
      this._goldGainTimeoutId = null;
    }
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
    // The element outlives any one game; uiState only exists once init() ran.
    // Before that (the hidden slider on the lobby page) this.attackRatio holds
    // the value, and init() reloads it from UserSettings anyway.
    if (this.uiState === undefined) return;
    this.uiState.attackRatio = newRatio;
  }

  private onAttackRatioSettingChanged = () => {
    if (this.uiState === undefined) return;
    this.attackRatio = new UserSettings().attackRatio();
    this.onAttackRatioChange(this.attackRatio);
    this.requestUpdate();
  };

  setVisibile(visible: boolean) {
    this._isVisible = visible;
    this.requestUpdate();
  }

  private handleRatioSliderInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const value = Number(input.value);
    this.attackRatio = value / 100;
    this.onAttackRatioChange(this.attackRatio);
  }

  private handleRatioSliderPointerUp(e: Event) {
    (e.target as HTMLInputElement).blur();
  }

  /**
   * The browser only moves a range input on a real pointer press. A tap that
   * the radial menu forwarded down from its overlay never reaches the slider
   * as a press, so move it from the tap position here.
   */
  private handleRatioSliderClick(e: MouseEvent) {
    if (!isForwardedClick(e)) return;
    const input = e.currentTarget as HTMLInputElement | null;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    if (rect.width === 0) return;
    const min = Number(input.min);
    const max = Number(input.max);
    const position = Math.min(
      Math.max((e.clientX - rect.left) / rect.width, 0),
      1,
    );
    const value = Math.round(min + position * (max - min));
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  private calculateTroopBar(): { greenPercent: number; orangePercent: number } {
    const base = Math.max(this._maxTroops, 1);
    const greenPercentRaw = (this._troops / base) * 100;
    const orangePercentRaw = (this._attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return { greenPercent, orangePercent };
  }

  private renderTroopBar() {
    // Troops above a shrunken cap drain away: the rate is then below zero.
    const sign = this.troopRate < 0 ? "−" : "+";
    const rate = `${sign}${renderTroops(Math.abs(this.troopRate))}/s`;
    const { greenPercent, orangePercent } = this.calculateTroopBar();
    const trend = this._troopRateIsIncreasing ? "up" : "down";
    return html`
      <div
        data-troop-bar
        ?data-alert=${this._lowTroopsAlert}
        ?data-attacking=${this._attackingTroops > 0}
        class="relative h-6 min-w-0 lg:col-start-2 lg:row-start-1 ${this.tutorialHighlightClass(
          "troops",
        )}"
      >
        <div
          class="absolute inset-0 overflow-hidden ${TRACK} ${
            this._lowTroopsAlert ? TRACK_BORDER.alert : TRACK_BORDER.calm
          }"
        >
          <div
            class="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-200 ease-out ${TROOP_FILL}"
            style="transform: scaleX(${greenPercent / 100});"
          ></div>
          <div
            class="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-200 ease-out ${TROOPS_OUT}"
            style="transform: translateX(${greenPercent}%) scaleX(${
              orangePercent / 100
            });"
          ></div>
          ${
            this._lowTroopsAlert
              ? html`<div
                  class="troop-bar-alert absolute inset-0 bg-red-600"
                ></div>`
              : nothing
          }
        </div>
        <!-- One line that clips: when the three do not fit, the max wraps out
             of sight first, then the rate; the count always stays. From lg
             the rate leaves the line for the chip column. -->
        <div
          class="relative flex h-6 flex-wrap content-start items-center overflow-hidden lg:flex-nowrap lg:overflow-visible"
          translate="no"
        >
          <span data-troops class="flex h-6 shrink-0 items-center ${TROOPS}">
            <of-icon name="troops" size="14" class="max-lg:hidden"></of-icon>
            <span class="hud-caps">${renderTroops(this._troops)}</span>
          </span>
          <span
            data-troop-rate
            data-rate-trend=${trend}
            class="shrink-0 ${CHIP} ${RATE} ${RATE_TREND[trend]} ${this.tutorialHighlightClass(
              "troop_rate",
            )}"
          >
            <span class="lg:hud-caps">${rate}</span>
          </span>
          <span
            data-max-troops
            class="ms-auto flex shrink-0 items-center ${MAX_TROOPS}"
          >
            <of-icon name="max" size="10" class="max-lg:hidden"></of-icon>
            <span class="hud-caps">${renderTroops(this._maxTroops)}</span>
          </span>
        </div>
      </div>
    `;
  }

  private tutorialHighlightClass(target: TutorialHighlight): string {
    return this._tutorialHighlight === target ? "tutorial-highlight" : "";
  }

  private renderNotification() {
    if (!this._notification) return html``;
    const isWarning = this._notification.type === "warning";
    return html`
      <div
        class="flex items-center gap-1.5 px-1.5 py-1 rounded-md border text-xs font-medium mb-1 ${
          isWarning
            ? "border-orange-400/60 bg-orange-400/10 text-orange-300"
            : "border-blue-400/60 bg-blue-400/10 text-blue-300"
        }"
      >
        <span class="shrink-0">${isWarning ? "⚠" : "ℹ"}</span>
        <span>${translateText(this._notification.message)}</span>
      </div>
    `;
  }

  private getMobileAttackRatioLabel(): string {
    const percent = (this.attackRatio * 100).toFixed(0);
    const troops = renderTroops(
      (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
    );
    const translated = translateText("control_panel.attack_ratio", {
      percent,
      troops,
    });
    return translated !== "control_panel.attack_ratio" &&
      translated.includes(percent)
      ? translated
      : `${percent}%\n(${troops})`;
  }

  private renderGold() {
    return html`
      <span
        data-gold
        class="relative flex shrink-0 items-center lg:col-start-3 lg:row-start-1 ${GOLD} ${this.tutorialHighlightClass(
          "gold",
        )}"
        translate="no"
      >
        ${
          this._goldGain !== null
            ? keyed(
                this._goldGainPulseId,
                html`<span class="gold-gain-pop ${GOLD_POP}"
                  >+${renderNumber(this._goldGain)}</span
                >`,
              )
            : ""
        }
        <img src=${goldCoinIcon} width="13" height="13" class="shrink-0" />
        <span class="px-0.5 tabular-nums lg:px-0"
          >${renderNumber(this._gold)}</span
        >
      </span>
    `;
  }

  private renderRatioLabel() {
    return html`
      <span
        data-attack-ratio-label
        class="flex items-center lg:col-start-1 lg:row-start-2 ${RATIO}"
        translate="no"
      >
        <img
          src=${swordIcon}
          alt=""
          aria-hidden="true"
          width="12"
          height="12"
          class="size-2.5 lg:size-3"
          style="filter: brightness(0) invert(1);"
        />
        <span
          class="text-center text-[11px] leading-tight whitespace-pre-wrap lg:hidden"
          >${this.getMobileAttackRatioLabel()}</span
        >
        <span class="hidden lg:inline"
          >${(this.attackRatio * 100).toFixed(0)}%
          (${renderTroops(
            (this.game?.myPlayer()?.troops() ?? 0) * this.attackRatio,
          )})</span
        >
      </span>
    `;
  }

  private renderRatioSlider() {
    return html`
      <div
        class="flex min-w-0 items-center lg:col-span-2 lg:col-start-2 lg:row-start-2 ${this.tutorialHighlightClass(
          "attack_ratio",
        )}"
        translate="no"
      >
        <input
          type="range"
          min="1"
          max="100"
          .value=${String(Math.round(this.attackRatio * 100))}
          @input=${(e: Event) => this.handleRatioSliderInput(e)}
          @pointerup=${(e: Event) => this.handleRatioSliderPointerUp(e)}
          @click=${(e: MouseEvent) => this.handleRatioSliderClick(e)}
          data-radial-click-through
          class="w-full cursor-pointer ${SLIDER}"
        />
      </div>
    `;
  }

  render() {
    return html`
      <style>
        @keyframes gold-gain-pop {
          0% {
            transform: translateY(4px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .gold-gain-pop {
          animation: gold-gain-pop 0.25s ease-out;
        }
      </style>
      <div
        data-control-panel
        class="pointer-events-auto ${this._isVisible ? PANEL : "hidden"}"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        ${this.renderNotification()}
        <div class=${GRID}>
          ${this.renderGold()} ${this.renderTroopBar()}
          ${this.renderRatioLabel()} ${this.renderRatioSlider()}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
