import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType, PlayerType } from "../../../core/game/Game";
import { Controller } from "../../Controller";
import { MouseMoveEvent } from "../../InputHandler";
import {
  attackLossesPerTile,
  commitVerdict,
  CommitVerdict,
  forecastAttack,
  Grade,
  gradeAttack,
  growthPerTick,
  minLossCommit,
  optimalTroops,
  TERRAIN_PLAINS,
  wildlandsSaturationTroops,
  wildlandsSpeedCost,
} from "../../trainer/TrainerMath";
import { TransformHandler } from "../../TransformHandler";
import { UIState } from "../../UIState";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";

const COLLAPSED_KEY = "trainer-overlay-collapsed";

interface TrackedAttack {
  targetSmallID: number;
  targetName: string;
  committed: number;
  lastTroops: number;
  targetTroops0: number;
  targetTiles0: number;
  /** Per-tile attacker loss if the attack had been sized at the clamp floor. */
  floorLossPerTile: number;
}

interface ReportCard {
  targetName: string;
  losses: number;
  minLosses: number;
  tilesTaken: number;
  grade: Grade;
}

/**
 * The trainer HUD: a deliberately ugly, numbers-first overlay that turns the
 * simulation's hidden math (growth curve, the 1.66x commit rule, density)
 * into live feedback. Singleplayer only; display-side only — it never sends
 * intents or touches game state. Formula mirrors live in trainer/TrainerMath.
 */
@customElement("trainer-overlay")
export class TrainerOverlay extends LitElement implements Controller {
  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public uiState!: UIState;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private collapsed = localStorage.getItem(COLLAPSED_KEY) === "true";

  @state()
  private hoverTarget: PlayerView | null = null;

  private lastMouseUpdate = 0;
  private lastGameTick = 0;
  private wastedGrowth = 0;
  private tracked = new Map<string, TrackedAttack>();
  private cards: ReportCard[] = [];

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) => {
      const now = Date.now();
      if (now - this.lastMouseUpdate < 100) return;
      this.lastMouseUpdate = now;
      this.updateHoverTarget(e.x, e.y);
    });
  }

  private isTrainerGame(): boolean {
    return (
      this.game !== undefined &&
      this.game.config().gameConfig().gameType === GameType.Singleplayer &&
      !this.game.config().isReplay()
    );
  }

  private updateHoverTarget(x: number, y: number) {
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) return;
    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;
    const owner = this.game.owner(tile);
    if (owner && owner.isPlayer() && owner !== this.game.myPlayer()) {
      // Sticky: keep the last hovered player so the panel doesn't flicker
      // while the cursor crosses ocean or your own land.
      this.hoverTarget = owner as PlayerView;
    }
  }

  tick() {
    if (!this.isTrainerGame()) return;
    const me = this.game.myPlayer();
    if (me === null) return;

    const curTick = this.game.ticks();
    const dt = Math.max(0, curTick - this.lastGameTick);
    this.lastGameTick = curTick;

    if (!this.game.inSpawnPhase() && me.isAlive()) {
      this.accumulateWaste(me, dt);
      this.trackAttacks(me);
    }
    this.requestUpdate();
  }

  /** Troops-not-grown while idling above the optimal troop count. */
  private accumulateWaste(me: PlayerView, dt: number) {
    const max = this.game.config().maxTroops(me);
    const opt = optimalTroops(max);
    if (me.troops() <= opt) return;
    const peak = growthPerTick(opt, max);
    const cur = this.game.config().troopIncreaseRate(me);
    this.wastedGrowth += dt * Math.max(0, peak - cur);
  }

  private trackAttacks(me: PlayerView) {
    const live = new Set<string>();
    for (const a of me.outgoingAttacks()) {
      live.add(a.id);
      const t = this.tracked.get(a.id);
      if (t === undefined) {
        if (a.targetID === 0) continue; // wildlands: losses are trivial
        const target = this.game.playerBySmallID(a.targetID);
        if (!target.isPlayer()) continue;
        const tv = target as PlayerView;
        const d0 = tv.troops();
        const tiles0 = Math.max(1, tv.numTilesOwned());
        this.tracked.set(a.id, {
          targetSmallID: a.targetID,
          targetName: tv.displayName(),
          committed: a.troops,
          lastTroops: a.troops,
          targetTroops0: d0,
          targetTiles0: tiles0,
          floorLossPerTile: attackLossesPerTile({
            attackTroops: Math.max(1, minLossCommit(d0)),
            defenderTroops: d0,
            defenderTiles: tiles0,
            attackerTiles: me.numTilesOwned(),
            terrain: TERRAIN_PLAINS,
            humanVsBot: tv.type() === PlayerType.Bot,
          }).attackerLoss,
        });
      } else {
        // Merged reinforcements show up as a troop increase.
        if (a.troops > t.lastTroops) {
          t.committed += a.troops - t.lastTroops;
        }
        t.lastTroops = a.troops;
      }
    }

    for (const [id, t] of this.tracked) {
      if (live.has(id)) continue;
      this.tracked.delete(id);
      this.finishCard(t);
    }
  }

  private finishCard(t: TrackedAttack) {
    const target = this.game.playerBySmallID(t.targetSmallID);
    const tilesNow = target.isPlayer()
      ? (target as PlayerView).numTilesOwned()
      : 0;
    const tilesTaken = Math.max(0, t.targetTiles0 - tilesNow);
    const losses = Math.max(0, t.committed - t.lastTroops);
    if (tilesTaken === 0 && losses < 10) return; // cancelled, nothing to grade
    const minLosses = tilesTaken * t.floorLossPerTile;
    this.cards.unshift({
      targetName: t.targetName,
      losses,
      minLosses,
      tilesTaken,
      grade: gradeAttack(losses, minLosses),
    });
    this.cards = this.cards.slice(0, 5);
  }

  /** uiState.attackRatio is seeded late; clamp to the slider's real range. */
  private attackRatio(): number {
    return Math.min(1, Math.max(0.01, this.uiState.attackRatio));
  }

  private toggleCollapsed() {
    this.collapsed = !this.collapsed;
    localStorage.setItem(COLLAPSED_KEY, String(this.collapsed));
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private gradeColor(grade: Grade): string {
    switch (grade) {
      case "S":
        return "text-cyan-300";
      case "A":
        return "text-green-400";
      case "B":
        return "text-lime-400";
      case "C":
        return "text-yellow-400";
      case "D":
        return "text-orange-400";
      case "F":
        return "text-red-500";
    }
  }

  private renderGrowthPanel(me: PlayerView): TemplateResult {
    const config = this.game.config();
    const max = config.maxTroops(me);
    const troops = me.troops();
    const opt = optimalTroops(max);
    const peak = growthPerTick(opt, max);
    const cur = config.troopIncreaseRate(me);
    const eff = peak > 0 ? cur / peak : 0;
    const pctOfMax = max > 0 ? troops / max : 0;
    const hoarding = troops > opt * 1.1;
    const atPeak = !hoarding && troops >= opt * 0.85;

    const effPct = Math.round(eff * 100);
    let effColor = "text-green-400";
    if (effPct < 45) effColor = "text-red-500";
    else if (effPct < 70) effColor = "text-orange-400";
    else if (effPct < 90) effColor = "text-yellow-400";

    let stateKey = "trainer.state_build";
    let stateColor = "bg-sky-800";
    if (hoarding) {
      stateKey = "trainer.state_hoarding";
      stateColor = "bg-red-800 animate-pulse";
    } else if (atPeak) {
      stateKey = "trainer.state_peak";
      stateColor = "bg-green-800";
    }

    const optPct = max > 0 ? (opt / max) * 100 : 0;

    return html`
      <div class="border-b border-gray-600 p-1.5">
        <div class="flex items-baseline justify-between">
          <span class="text-[10px] uppercase text-gray-400"
            >${translateText("trainer.growth")}</span
          >
          <span
            class="text-[10px] px-1 rounded text-white ${stateColor}"
            translate="no"
            >${translateText(stateKey)}</span
          >
        </div>
        <div class="flex items-baseline gap-2" translate="no">
          <span class="text-3xl font-bold tabular-nums ${effColor}"
            >${effPct}%</span
          >
          <span class="text-xs text-gray-300"
            >+${renderTroops(cur * 10)}/s
            <span class="text-gray-500">/ ${renderTroops(peak * 10)}/s</span>
          </span>
        </div>
        <!-- troop position bar with the optimum marked -->
        <div
          class="relative w-full h-3 mt-1 bg-gray-900 border border-gray-600 rounded-sm overflow-hidden"
          translate="no"
        >
          <div
            class="absolute inset-y-0 left-0 ${hoarding
              ? "bg-red-700"
              : "bg-sky-700"}"
            style="width: ${Math.min(100, pctOfMax * 100).toFixed(1)}%"
          ></div>
          <div
            class="absolute inset-y-0 w-0.5 bg-green-300"
            style="left: ${optPct.toFixed(1)}%"
            title=${translateText("trainer.optimal")}
          ></div>
        </div>
        <div
          class="flex justify-between text-[10px] text-gray-400 tabular-nums"
          translate="no"
        >
          <span
            >${renderTroops(troops)} (${Math.round(pctOfMax * 100)}%)</span
          >
          <span class="text-green-300"
            >${translateText("trainer.optimal")}: ${renderTroops(opt)}</span
          >
          <span>${renderTroops(max)}</span>
        </div>
        <div class="text-[10px] tabular-nums mt-0.5" translate="no">
          <span class="text-gray-400"
            >${translateText("trainer.wasted_growth")}:</span
          >
          <span class="${this.wastedGrowth > 0 ? "text-red-400" : "text-gray-500"} font-bold"
            >${renderTroops(this.wastedGrowth)}</span
          >
        </div>
      </div>
    `;
  }

  private verdictBadge(verdict: CommitVerdict): TemplateResult {
    switch (verdict) {
      case "undercommit":
        return html`<span
          class="px-1 rounded bg-red-800 text-white animate-pulse"
          >${translateText("trainer.undercommit")}</span
        >`;
      case "overkill":
        return html`<span class="px-1 rounded bg-orange-800 text-white"
          >${translateText("trainer.overkill")}</span
        >`;
      case "efficient":
        return html`<span class="px-1 rounded bg-green-800 text-white"
          >${translateText("trainer.efficient")}</span
        >`;
    }
  }

  private renderTargetPanel(me: PlayerView): TemplateResult | typeof nothing {
    const target = this.hoverTarget;
    if (target === null || !target.isAlive()) return nothing;

    const d = target.troops();
    const tiles = Math.max(1, target.numTilesOwned());
    const myDensity = me.troops() / Math.max(1, me.numTilesOwned());
    const density = d / tiles;
    const commit = minLossCommit(d);
    const planned = this.attackRatio() * me.troops();
    const sliderPct = Math.min(
      999,
      Math.ceil((commit / Math.max(1, me.troops())) * 100),
    );
    const verdict = commitVerdict(planned, d);
    const isFriendly = me.isFriendly(target);

    const forecast = forecastAttack(
      {
        attackTroops: planned,
        defenderTroops: d,
        defenderTiles: tiles,
        attackerTiles: me.numTilesOwned(),
        terrain: TERRAIN_PLAINS,
        humanVsBot: target.type() === PlayerType.Bot,
      },
      20,
    );

    return html`
      <div class="border-b border-gray-600 p-1.5">
        <div class="flex items-baseline justify-between gap-1">
          <span class="text-[10px] uppercase text-gray-400"
            >${translateText("trainer.target")}</span
          >
          <span
            class="text-xs font-bold truncate max-w-[10rem]"
            translate="no"
            >${target.displayName()}</span
          >
        </div>
        ${isFriendly
          ? html`<div class="text-xs text-green-400">
              ${translateText("trainer.ally")}
            </div>`
          : html`
              <div
                class="grid grid-cols-2 gap-x-2 text-[11px] tabular-nums"
                translate="no"
              >
                <span class="text-gray-400"
                  >${translateText("trainer.their_troops")}</span
                >
                <span class="text-right">${renderTroops(d)}</span>
                <span class="text-gray-400"
                  >${translateText("trainer.density")}</span
                >
                <span
                  class="text-right ${density > myDensity
                    ? "text-red-400"
                    : "text-green-400"}"
                  >${renderNumber(density / 10, 2)}
                  <span class="text-gray-500"
                    >/ ${renderNumber(myDensity / 10, 2)}</span
                  ></span
                >
                <span class="text-gray-400"
                  >${translateText("trainer.min_loss_commit")}</span
                >
                <span class="text-right font-bold text-yellow-300"
                  >${renderTroops(commit)}
                  ${sliderPct <= 100
                    ? html`<span class="text-gray-400">(${sliderPct}%)</span>`
                    : html`<span class="text-red-400"
                        >(${translateText("trainer.not_enough")})</span
                      >`}</span
                >
                <span class="text-gray-400"
                  >${translateText("trainer.planned_commit")}</span
                >
                <span class="text-right"
                  >${renderTroops(planned)}
                  (${Math.round(this.attackRatio() * 100)}%)</span
                >
              </div>
              <div class="flex justify-between text-[11px] mt-0.5">
                ${this.verdictBadge(verdict)}
                <span class="tabular-nums" translate="no">
                  ${forecast.conquered
                    ? html`<span class="text-green-400"
                        >${translateText("trainer.kills")}</span
                      >`
                    : html`<span class="text-orange-400"
                        >${translateText("trainer.stalls", {
                          tiles: renderNumber(forecast.tilesTaken),
                        })}</span
                      >`}
                  −${renderTroops(forecast.attackerLosses)}
                  <span class="text-gray-500"
                    >(${translateText("trainer.min")}
                    ${renderTroops(forecast.minPossibleLosses)})</span
                  >
                </span>
              </div>
            `}
      </div>
    `;
  }

  private renderExpansionPanel(me: PlayerView): TemplateResult {
    const planned = this.attackRatio() * me.troops();
    const cost = wildlandsSpeedCost(planned, TERRAIN_PLAINS);
    const speedPct = Math.round((5 / cost) * 100);
    const saturation = wildlandsSaturationTroops(TERRAIN_PLAINS);
    return html`
      <div class="border-b border-gray-600 p-1.5">
        <div class="flex justify-between text-[11px] tabular-nums" translate="no">
          <span class="text-gray-400"
            >${translateText("trainer.wildland_speed")}</span
          >
          <span
            class="${speedPct >= 100
              ? "text-green-400"
              : speedPct >= 50
                ? "text-yellow-400"
                : "text-red-400"} font-bold"
            >${speedPct}%</span
          >
        </div>
        ${speedPct < 100
          ? html`<div class="text-[10px] text-gray-500" translate="no">
              ${translateText("trainer.saturates_at", {
                troops: renderTroops(saturation),
              })}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderCards(): TemplateResult | typeof nothing {
    if (this.cards.length === 0) return nothing;
    return html`
      <div class="p-1.5">
        <div class="text-[10px] uppercase text-gray-400">
          ${translateText("trainer.report_cards")}
        </div>
        ${this.cards.map(
          (c) => html`
            <div
              class="flex justify-between gap-1 text-[11px] tabular-nums"
              translate="no"
            >
              <span class="truncate max-w-[8rem] text-gray-300"
                >${c.targetName}</span
              >
              <span>
                −${renderTroops(c.losses)}
                <span class="text-gray-500"
                  >/ ${renderTroops(c.minLosses)}</span
                >
                <span class="font-bold ${this.gradeColor(c.grade)}"
                  >${c.grade}</span
                >
              </span>
            </div>
          `,
        )}
      </div>
    `;
  }

  private renderSpawnPanel(): TemplateResult {
    return html`
      <div class="p-1.5 text-xs text-yellow-300">
        ${translateText("trainer.spawn_hint")}
      </div>
    `;
  }

  render() {
    if (!this.isTrainerGame()) return html``;
    const me = this.game?.myPlayer();
    if (!me || !me.hasSpawned()) {
      if (this.game?.inSpawnPhase()) {
        return this.wrap(this.renderSpawnPanel());
      }
      return html``;
    }
    if (!me.isAlive()) return html``;

    if (this.collapsed) {
      return html`
        <button
          class="fixed left-0 top-1/2 -translate-y-1/2 z-[900] bg-gray-900/90 text-green-400 text-[10px] font-bold px-1 py-2 border border-gray-600 rounded-r-md pointer-events-auto"
          style="writing-mode: vertical-rl"
          @click=${() => this.toggleCollapsed()}
          translate="no"
        >
          ${translateText("trainer.title")}
        </button>
      `;
    }

    return this.wrap(html`
      ${this.game.inSpawnPhase() ? this.renderSpawnPanel() : nothing}
      ${this.renderGrowthPanel(me)} ${this.renderTargetPanel(me)}
      ${this.renderExpansionPanel(me)} ${this.renderCards()}
    `);
  }

  private wrap(content: TemplateResult | typeof nothing) {
    return html`
      <div
        class="fixed left-0 top-1/2 -translate-y-1/2 z-[900] w-64 bg-gray-900/90 text-white font-mono border border-gray-600 rounded-r-md shadow-lg pointer-events-auto select-none"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="flex justify-between items-center px-1.5 py-0.5 bg-gray-800 border-b border-gray-600"
        >
          <span class="text-[10px] font-bold text-green-400 uppercase"
            >${translateText("trainer.title")}</span
          >
          <button
            class="text-gray-400 hover:text-white text-xs px-1"
            @click=${() => this.toggleCollapsed()}
          >
            ×
          </button>
        </div>
        ${content}
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
