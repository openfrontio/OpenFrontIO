import { Cell, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { Intent } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { Platform } from "../../Platform";
import { GoToPositionEvent, TransformHandler } from "../../TransformHandler";
import { SetIntentGateEvent } from "../../Transport";
import { homeHref, textDirection, translateText } from "../../Utils";
import { GameView } from "../../view";
import { PlayerView } from "../../view/PlayerView";
import {
  inCircle,
  ISLET,
  judge,
  LOW_TROOP_SHARE,
  ONBOARDING_STEPS,
  OnboardingLowTroopsEvent,
  OnboardingStep,
  OnboardingTarget,
  OnboardingVerdict,
  SPAWN_ZONE,
  stepFor,
} from "../Onboarding";
import { TutorialHighlightEvent } from "../Tutorial";

/** How often (in ticks) to re-read the map for the step and its target. */
const SCAN_TICKS = 5;

/**
 * How long the low-troops warning stays up at least, so it can be read
 * even once troops grow back, and how long the "not there" nudge lasts.
 */
const LOW_TROOPS_MS = 5000;
const NUDGE_MS = 1500;

/**
 * How long troops just sent count as gone before the view shows them gone.
 * Clicks within a tick all read the same troop count, so without this a
 * burst of them sends the whole army before the low-troops rule sees it.
 */
const IN_FLIGHT_MS = 400;

/**
 * Radius of the target marker, in tiles, kept within these px. On the
 * expand step no one's land lies this close to it, so it only covers
 * empty land.
 */
const TARGET_RADIUS_TILES = 4;
const MIN_TARGET_PX = 14;
const MAX_TARGET_PX = 40;

/**
 * How far past our border, toward where we're headed, the expand step's
 * target sits at most, in tiles: on the border it reads as "click your land".
 */
const EXPAND_REACH_TILES = 10;

/**
 * Directions tried for the expand step's target, in degrees off the one
 * toward the goal, when land in that one is taken too close to the border.
 */
const EXPAND_TURNS = [0, 30, -30, 60, -60, 90, -90];

/**
 * Where on screen a new step's target counts as seen, as shares of the
 * viewport: the leaderboard, the step card and the control panel cover
 * the edges.
 */
const VIEW_X = [0.25, 0.75];
const VIEW_Y = [0.35, 0.75];

/** Steps whose text says "tap" instead of "click" on touch devices. */
const TOUCH_TEXT = new Set([
  "spawn",
  "expand",
  "tribe",
  "coast",
  "boat",
  "nation",
  "nation_land",
  "wrong_target",
]);

interface Target {
  x: number;
  y: number;
}

/**
 * The onboarding tutorial (docs/OnboardingTutorial.md): on a `tutorial`
 * game it marks the step's target with an arrow, shows one sentence,
 * and drops (through the Transport's intent gate) any spawn, attack or boat
 * the step doesn't ask for, or any attack while troops are low.
 */
@customElement("onboarding-overlay")
export class OnboardingOverlay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  @state() private active = false;
  /** The welcome card, shown until the player clicks Start. */
  @state() private intro = true;
  @state() private step: OnboardingStep | "won" = "spawn";
  @state() private hasCoast = true;
  @state() private lowTroops = false;
  @state() private nudging = false;
  /**
   * Screen position and radius of the target marker, in px; on the troops
   * step, the top of the troop bar, with the arrow and no marker.
   */
  @state() private spot: {
    x: number;
    y: number;
    r: number;
    marker: boolean;
  } | null = null;

  private target: Target | null = null;
  private lowTroopsUntil = 0;
  private nudgeUntil = 0;
  private frame: number | null = null;
  /** The tribe and nation spawn a tick or two in; until then none is "gone". */
  private rivalsSeen = false;
  /** Clicked "Got it" on the troops step. */
  private troopsSeen = false;
  /** Sent a boat to the nation: its middle is the target from then on. */
  private boatedNation = false;
  /**
   * The last scan's instruction: when it changes, the camera makes sure its
   * target is in view.
   */
  private lastKey = "";
  /** Troops of the attacks and boats let through lately, with when. */
  private inFlight: { troops: number; at: number }[] = [];

  createRenderRoot() {
    return this;
  }

  init() {
    if (this.game.config().gameConfig().tutorial !== true) return;
    this.active = true;
    this.eventBus.emit(new SetIntentGateEvent(this.gate));
    this.followTarget();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  tick() {
    if (!this.active) return;
    const me = this.game.myPlayer();
    if (me === null) return;
    if (this.game.ticks() % SCAN_TICKS === 0 || this.step === "spawn") {
      this.scan(me);
    }
    const now = performance.now();
    const low = me.hasSpawned() && this.troopShare(me) < LOW_TROOP_SHARE;
    if (low && !this.lowTroops) this.lowTroopsUntil = now + LOW_TROOPS_MS;
    this.setLowTroops(low || now < this.lowTroopsUntil);
    this.nudging = now < this.nudgeUntil;
  }

  private setLowTroops(low: boolean) {
    if (low === this.lowTroops) return;
    this.lowTroops = low;
    this.eventBus.emit(new OnboardingLowTroopsEvent(low));
  }

  /** Our troops, less those just sent and `sending`, over our max. */
  private troopShare(me: PlayerView, sending = 0): number {
    const now = performance.now();
    this.inFlight = this.inFlight.filter((s) => now - s.at < IN_FLIGHT_MS);
    const sent = this.inFlight.reduce((sum, s) => sum + s.troops, 0);
    return (
      Math.max(0, me.troops() - sent - sending) /
      Math.max(this.game.config().maxTroops(me), 1)
    );
  }

  /** Transport's intent gate: true lets the intent through. */
  private gate = (intent: Intent): boolean => {
    const verdict = this.judgeIntent(intent);
    const now = performance.now();
    if (verdict === "ok") {
      if (intent.type === "attack" || intent.type === "boat") {
        this.inFlight.push({ troops: intent.troops ?? 0, at: now });
      }
      if (
        intent.type === "boat" &&
        this.targetOfTile(intent.dst) === "nation"
      ) {
        this.boatedNation = true;
      }
      return true;
    }
    if (verdict === "low_troops") {
      // Each refused click restarts the clock, so it's read after the last.
      this.lowTroopsUntil = now + LOW_TROOPS_MS;
      this.setLowTroops(true);
    } else {
      this.nudgeUntil = now + NUDGE_MS;
      this.nudging = true;
    }
    return false;
  };

  private judgeIntent(intent: Intent): OnboardingVerdict {
    if (this.step === "won") return "ok";
    const me = this.game.myPlayer();
    const sending =
      intent.type === "attack" || intent.type === "boat"
        ? (intent.troops ?? 0)
        : 0;
    const share = me === null ? 0 : this.troopShare(me, sending);
    switch (intent.type) {
      case "spawn":
        return judge(
          this.step,
          {
            kind: "spawn",
            inZone: inCircle(
              SPAWN_ZONE,
              this.game.x(intent.tile),
              this.game.y(intent.tile),
            ),
          },
          share,
        );
      case "attack":
        return judge(
          this.step,
          {
            kind: "attack",
            target:
              intent.targetID === null
                ? "free"
                : this.targetOf(this.game.player(intent.targetID)),
          },
          share,
        );
      case "boat":
        return judge(
          this.step,
          { kind: "boat", target: this.targetOfTile(intent.dst) },
          share,
        );
      default:
        return "ok";
    }
  }

  private targetOf(p: PlayerView): OnboardingTarget {
    if (p.type() === PlayerType.Bot) return "tribe";
    if (p.type() === PlayerType.Nation) return "nation";
    return "other";
  }

  private targetOfTile(tile: number): OnboardingTarget {
    const owner = this.game.playerBySmallID(this.game.ownerID(tile));
    if (owner.isPlayer()) return this.targetOf(owner as PlayerView);
    return inCircle(ISLET, this.game.x(tile), this.game.y(tile))
      ? "islet"
      : "free";
  }

  private living(type: PlayerType): PlayerView | null {
    return (
      this.game.playerViews().find((p) => p.type() === type && p.isAlive()) ??
      null
    );
  }

  /**
   * Reads the step off the map, and where its arrow points: the free land
   * at our edge nearest where we're headed, the tribe's land nearest its
   * name (its middle), the islet, or the nation's coast nearest the islet
   * until a boat goes there, then its middle.
   */
  private scan(me: PlayerView) {
    const g = this.game;
    const tribe = this.living(PlayerType.Bot);
    const nation = this.living(PlayerType.Nation);
    const mine = me.smallID();
    const tribeID = tribe?.smallID() ?? -1;
    const nationID = nation?.smallID() ?? -1;
    const tribeLoc = tribe?.nameLocation();
    const nationLoc = nation?.nameLocation();
    // Grow toward the tribe while it's alive, then toward the islet.
    const goal = tribeLoc ?? ISLET;
    const near = (from: { x: number; y: number }, x: number, y: number) =>
      (x - from.x) * (x - from.x) + (y - from.y) * (y - from.y);

    let bordersTribe = false;
    let ownsIslet = false;
    let hasCoast = false;
    let frontier: Cell | null = null;
    let frontierDist = Infinity;
    let tribeMiddle: Cell | null = null;
    let tribeMiddleDist = Infinity;
    let nationCoast: Cell | null = null;
    let nationCoastDist = Infinity;
    let nationMiddle: Cell | null = null;
    let nationMiddleDist = Infinity;

    const w = g.width();
    const h = g.height();
    const offsets = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = g.ref(x, y);
        const owner = g.ownerID(t);
        if (owner === nationID) {
          if (g.isShore(t)) {
            const d = near(ISLET, x, y);
            if (d < nationCoastDist) {
              nationCoastDist = d;
              nationCoast = new Cell(x, y);
            }
          }
          if (nationLoc) {
            const d = near(nationLoc, x, y);
            if (d < nationMiddleDist) {
              nationMiddleDist = d;
              nationMiddle = new Cell(x, y);
            }
          }
          continue;
        }
        if (owner === tribeID && tribeLoc) {
          const d = near(tribeLoc, x, y);
          if (d < tribeMiddleDist) {
            tribeMiddleDist = d;
            tribeMiddle = new Cell(x, y);
          }
          continue;
        }
        if (owner !== mine) continue;
        if (inCircle(ISLET, x, y)) ownsIslet = true;
        if (g.isShore(t)) hasCoast = true;
        for (const [dx, dy] of offsets) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = g.ref(nx, ny);
          const no = g.ownerID(n);
          if (no === tribeID) {
            bordersTribe = true;
          } else if (no === 0 && g.isLand(n)) {
            const d = near(goal, nx, ny);
            if (d < frontierDist) {
              frontierDist = d;
              frontier = new Cell(nx, ny);
            }
          }
        }
      }
    }

    if (tribe !== null && nation !== null) this.rivalsSeen = true;
    const previous = this.step;
    this.step = stepFor({
      hasSpawned: me.hasSpawned(),
      bordersTribe,
      troopsSeen: this.troopsSeen,
      tribeAlive: tribe !== null || !this.rivalsSeen,
      ownsIslet,
      nationAlive: nation !== null || !this.rivalsSeen,
    });
    this.hasCoast = hasCoast;

    const at = (c: Cell | null): Target | null =>
      c === null ? null : { x: c.x, y: c.y };
    switch (this.step) {
      case "spawn":
        this.target = { x: SPAWN_ZONE.x, y: SPAWN_ZONE.y };
        break;
      case "expand":
        this.target = at(this.intoFreeLand(frontier, goal));
        break;
      case "troops":
        this.target = null;
        break;
      case "tribe":
        this.target = at(tribeMiddle);
        break;
      case "boat":
        this.target = hasCoast
          ? { x: ISLET.x, y: ISLET.y }
          : at(this.intoFreeLand(frontier, ISLET));
        break;
      case "nation":
        this.target = at(this.boatedNation ? nationMiddle : nationCoast);
        break;
      case "won":
        this.target = null;
        this.setLowTroops(false);
        this.eventBus.emit(new SetIntentGateEvent(null));
        break;
    }
    if ((this.step === "troops") !== (previous === "troops")) {
      this.eventBus.emit(
        new TutorialHighlightEvent(this.step === "troops" ? "troops" : null),
      );
    }
    // A new instruction's target can be across the map, or under the HUD.
    const t = this.target;
    const key = this.stepKey();
    if (key !== this.lastKey && t !== null && !this.inView(t)) {
      this.eventBus.emit(new GoToPositionEvent(t.x, t.y));
    }
    this.lastKey = key;
  }

  private inView(t: Target): boolean {
    const p = this.transformHandler.worldToScreenCoordinates(
      new Cell(t.x + 0.5, t.y + 0.5),
    );
    return (
      p.x > window.innerWidth * VIEW_X[0] &&
      p.x < window.innerWidth * VIEW_X[1] &&
      p.y > window.innerHeight * VIEW_Y[0] &&
      p.y < window.innerHeight * VIEW_Y[1]
    );
  }

  /**
   * Walks from a free tile at our border up to EXPAND_REACH_TILES toward
   * `goal`, staying on free land, and returns the farthest tile reached
   * with no one's land under the marker. If there's none that way, tries
   * directions further off it; null if none has one.
   */
  private intoFreeLand(
    from: Cell | null,
    goal: { x: number; y: number },
  ): Cell | null {
    if (from === null) return null;
    const g = this.game;
    const toward = Math.atan2(goal.y - from.y, goal.x - from.x);
    for (const turn of EXPAND_TURNS) {
      const a = toward + (turn * Math.PI) / 180;
      let best: Cell | null = null;
      for (let i = 1; i <= EXPAND_REACH_TILES; i++) {
        const x = Math.round(from.x + Math.cos(a) * i);
        const y = Math.round(from.y + Math.sin(a) * i);
        if (!g.isValidCoord(x, y)) break;
        const t = g.ref(x, y);
        if (!g.isLand(t) || g.hasOwner(t)) break;
        if (this.noOwnerNear(x, y)) best = new Cell(x, y);
      }
      if (best !== null) return best;
    }
    return null;
  }

  /** Whether no tile within TARGET_RADIUS_TILES of (x, y) has an owner. */
  private noOwnerNear(x: number, y: number): boolean {
    const g = this.game;
    const r = TARGET_RADIUS_TILES;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        if (!g.isValidCoord(x + dx, y + dy)) continue;
        if (g.hasOwner(g.ref(x + dx, y + dy))) return false;
      }
    }
    return true;
  }

  /**
   * Keeps the target marker on the target as the camera moves, or the
   * arrow on the troop bar.
   */
  private followTarget = () => {
    this.frame = requestAnimationFrame(this.followTarget);
    const next =
      this.step === "troops" ? this.troopBarSpot() : this.markerSpot();
    if (next === null) {
      if (this.spot !== null) this.spot = null;
      return;
    }
    const s = this.spot;
    if (
      s === null ||
      Math.abs(s.x - next.x) > 0.5 ||
      Math.abs(s.y - next.y) > 0.5 ||
      Math.abs(s.r - next.r) > 0.5 ||
      s.marker !== next.marker
    ) {
      this.spot = next;
    }
  };

  private markerSpot() {
    const t = this.target;
    if (t === null) return null;
    const p = this.transformHandler.worldToScreenCoordinates(
      new Cell(t.x + 0.5, t.y + 0.5),
    );
    const r = Math.min(
      MAX_TARGET_PX,
      Math.max(
        MIN_TARGET_PX,
        TARGET_RADIUS_TILES * this.transformHandler.scale,
      ),
    );
    return { x: p.x, y: p.y, r, marker: true };
  }

  /** The top middle of the troop bar the control panel highlights. */
  private troopBarSpot() {
    for (const el of document.querySelectorAll(
      "control-panel .tutorial-highlight",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      return {
        x: rect.left + rect.width / 2,
        y: rect.top,
        r: 0,
        marker: false,
      };
    }
    return null;
  }

  private troopsDone = () => {
    this.troopsSeen = true;
    const me = this.game.myPlayer();
    if (me !== null) this.scan(me);
  };

  private text(key: string): string {
    const touch = Platform.isTouch && TOUCH_TEXT.has(key) ? "_touch" : "";
    return translateText(`onboarding.step.${key}${touch}`);
  }

  private stepKey(): string {
    if (this.step === "boat" && !this.hasCoast) return "coast";
    if (this.step === "nation" && this.boatedNation) return "nation_land";
    return this.step;
  }

  render() {
    if (!this.active) return nothing;
    if (this.intro) return this.renderIntro();
    if (this.step === "won") return this.renderWon();
    const index = ONBOARDING_STEPS.indexOf(this.step);
    const spot = this.spot;
    return html`
      <style>
        @keyframes onboarding-shake {
          0%,
          100% {
            transform: translateX(-50%);
          }
          25% {
            transform: translateX(calc(-50% - 8px));
          }
          75% {
            transform: translateX(calc(-50% + 8px));
          }
        }
        .onboarding-shake {
          animation: onboarding-shake 0.25s ease-in-out 2;
        }
      </style>
      <div class="fixed inset-0 pointer-events-none z-[900]">
        ${
          spot === null
            ? nothing
            : html`
                ${
                  spot.marker
                    ? html`<svg
                        class="absolute drop-shadow-lg"
                        style="left: ${spot.x - spot.r}px; top: ${
                          spot.y - spot.r
                        }px; width: ${spot.r * 2}px; height: ${spot.r * 2}px"
                        viewBox="-10 -10 20 20"
                      >
                        <g fill="none" stroke="#000" stroke-width="3">
                          <circle r="8.5" />
                          <circle r="4.5" />
                        </g>
                        <g fill="none" stroke="#fde047" stroke-width="1.6">
                          <circle r="8.5" />
                          <circle r="4.5" />
                        </g>
                        <circle
                          r="1.6"
                          fill="#fde047"
                          stroke="#000"
                          stroke-width="0.8"
                        />
                      </svg>`
                    : nothing
                }
                <div
                  class="absolute -translate-x-1/2 animate-bounce text-yellow-300 drop-shadow-lg"
                  style="left: ${spot.x}px; top: ${spot.y - spot.r - 56}px"
                >
                  <svg width="40" height="48" viewBox="0 0 40 48">
                    <path
                      d="M14 0h12v28h12L20 48 2 28h12z"
                      fill="currentColor"
                      stroke="#000"
                      stroke-width="2"
                    />
                  </svg>
                </div>
              `
        }
      </div>
      <div
        dir=${textDirection()}
        class="fixed top-[1cm] left-1/2 -translate-x-1/2 z-[1001] pointer-events-none w-[min(92vw,560px)] rounded-xl bg-gray-900 px-5 py-4 text-center text-white shadow-2xl ${
          this.nudging ? "onboarding-shake ring-4 ring-yellow-300" : ""
        }"
      >
        <div class="text-xs uppercase tracking-wider text-yellow-300">
          ${translateText("onboarding.step_counter", {
            current: index + 1,
            total: ONBOARDING_STEPS.length,
          })}
        </div>
        <div
          class="mt-1 text-base sm:text-xl font-semibold leading-snug text-balance"
        >
          ${this.nudging ? this.text("wrong_target") : this.text(this.stepKey())}
        </div>
        ${
          this.step === "troops"
            ? html`<button
                type="button"
                class="pointer-events-auto mt-3 rounded-lg bg-yellow-400 px-6 py-2 text-lg font-bold text-gray-900 hover:bg-yellow-300"
                @click=${this.troopsDone}
              >
                ${translateText("onboarding.got_it")}
              </button>`
            : nothing
        }
      </div>
      ${
        this.lowTroops
          ? html`<div
              dir=${textDirection()}
              class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1001] pointer-events-none w-[min(88vw,440px)] rounded-xl bg-red-700/95 px-5 py-4 text-center text-white shadow-2xl"
            >
              <div class="text-xl sm:text-2xl font-bold">
                ${translateText("onboarding.low_troops_title")}
              </div>
              <div class="mt-1 text-base sm:text-lg">
                ${translateText("onboarding.low_troops")}
              </div>
            </div>`
          : nothing
      }
    `;
  }

  private renderIntro() {
    return html`
      <div
        class="fixed inset-0 z-[1001] flex items-center justify-center bg-black/60"
      >
        <div
          dir=${textDirection()}
          class="w-[min(90vw,480px)] rounded-xl bg-gray-900 px-6 py-6 text-center text-white shadow-2xl"
        >
          <h2 class="m-0 text-3xl font-bold text-yellow-300">
            ${translateText("onboarding.intro_title")}
          </h2>
          <p class="mt-3 text-lg">${translateText("onboarding.intro_body")}</p>
          <button
            type="button"
            class="mt-6 w-full rounded-lg bg-yellow-400 px-4 py-3 text-lg font-bold text-gray-900 hover:bg-yellow-300"
            @click=${() => (this.intro = false)}
          >
            ${translateText("onboarding.intro_start")}
          </button>
        </div>
      </div>
    `;
  }

  private renderWon() {
    return html`
      <div
        class="fixed inset-0 z-[1001] flex items-center justify-center bg-black/60"
      >
        <div
          dir=${textDirection()}
          class="w-[min(90vw,480px)] rounded-xl bg-gray-900 px-6 py-6 text-center text-white shadow-2xl"
        >
          <h2 class="m-0 text-3xl font-bold text-yellow-300">
            ${translateText("onboarding.won_title")}
          </h2>
          <p class="mt-3 text-lg">${translateText("onboarding.won_body")}</p>
          <div class="mt-6 flex flex-col gap-3">
            <button
              type="button"
              class="rounded-lg bg-yellow-400 px-4 py-3 text-lg font-bold text-gray-900 hover:bg-yellow-300"
              @click=${() =>
                (window.location.href = `${homeHref()}?solo_guide`)}
            >
              ${translateText("onboarding.play_solo")}
            </button>
            <button
              type="button"
              class="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-600"
              @click=${() => (window.location.href = homeHref())}
            >
              ${translateText("onboarding.main_menu")}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
