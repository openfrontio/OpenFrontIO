import { html, LitElement, nothing, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import type { GameXpEligible, GameXpResponse } from "../../core/ApiSchemas";
import {
  apportionXp,
  ineligibleReasonKey,
  isMilestoneLevel,
  levelFraction,
  levelsReachedInGame,
  MAX_LEVEL,
  reachedLegendThisGame,
  subscriberTierOf,
  visibleMultipliers,
  visibleXpLines,
  XP_LINE_LABEL_KEYS,
  type XpLineKey,
} from "../Progression";
import { translateText } from "../Utils";
import "./LevelBadge";
import { formatXp, xpBonusText, xpProgressText } from "./XpBar";

// What the XP section of a finished game is showing. The caller owns the
// fetching; this element only renders, so every state can be set directly.
export type GameXpPanelState =
  // Nothing to show: progression off, a spectator, timed out, a failure.
  | { kind: "hidden" }
  // Not signed in: XP needs an account.
  | { kind: "signed_out" }
  // The player died but the game is still running; XP comes at the end.
  | { kind: "awaiting_end" }
  // Waiting for the server to process the game. Never shows a number.
  | { kind: "calculating" }
  | { kind: "result"; data: GameXpResponse };

// Segments the big bar is drawn in. The gaps are decoration: the fill is one
// continuous sweep underneath them.
const BAR_SEGMENTS = 10;

// Reveal pacing, in ms.
const START_MS = 300;
const CAPTION_LEAD_MS = 250; // a caption lands before the bar moves
const CLIMB_MS = 450; // the bar's climb for one XP source (split across legs)
const MIN_LEG_MS = 140; // no leg of a climb is quicker than this
const GAP_MS = 300; // after a source's card lands, before the next caption
const LEVEL_UP_MS = 1100; // the pause on each level reached
const LEGEND_MS = 1900; // the pause on becoming a Legend
const MULTIPLIER_LEAD_MS = 450; // a multiplier caption slams in
const WIPE_MS = 1000; // a multiplier's wipe across the cards, first to last
const WIPE_CARD_SHARE = 0.4; // how much of the wipe each card takes

// When the wipe reaches card `i` of `n`, as a fraction of the wipe.
function wipeStart(i: number, n: number): number {
  return n > 1 ? (i * (1 - WIPE_CARD_SHARE)) / (n - 1) : 0;
}
const MULTIPLIER_HOLD_MS = 400;
const PAYOFF_MS = 900;

// The caption step the panel rests on once the reveal is over.
const REST_STEP = -1;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// The caption over the bar: one XP source at a time, then each multiplier,
// then the payoff. At rest it is the payoff, or just the heading; the number
// lives in the counter under the bar, never in two places.
type Caption =
  | { kind: "line"; key: XpLineKey; amount: number }
  | { kind: "multiplier"; key: "game" | "subscriber"; permille: number }
  | { kind: "heading" }
  | { kind: "level_up"; level: number }
  | { kind: "legend" };

// One frame of the reveal.
interface RevealFrame {
  // Increments with every caption change; keys the roll-in animation.
  step: number;
  caption: Caption | null;
  // Bar position in level units: 12.25 is a quarter of the way through level
  // 12. The fill is read off it.
  position: number;
  // The level shown at the end of the bar. Separate from `position` so the
  // level ticks over at the level-up moment, while the bar is still full.
  level: number;
  // Set during the pause on a level reached: the level-up moment.
  levelUp: number | null;
  // Set from the moment the player becomes a Legend.
  legend: boolean;
  // The earned-XP counter under the bar, counting up.
  counted: number;
  // Which XP-in-level text to show under the level: before the game, none
  // mid-way (the sizes of the levels in between are not known here), after.
  xpText: "before" | "none" | "after";
  // The cards below the bar: how many source and multiplier cards have
  // landed, and the value on each source card (a multiplier changes them).
  linesShown: number;
  multipliersShown: number;
  lineValues: number[];
  // A multiplier being applied to the cards (its wipe): a boost or a cut.
  applying: "boost" | "cut" | null;
}

// Bar position of a level/progress pair, in level units. Level 100 has no
// next level and reads as a full bar.
function positionOf(level: number, xpInLevel: number, xpForNext: number) {
  if (level >= MAX_LEVEL) return MAX_LEVEL;
  return level + levelFraction(xpInLevel, xpForNext);
}

// The source cards' final values: the award split across them, so a
// multiplied award shows on each card and the cards add up to it.
function finalLineValues(data: GameXpEligible): number[] {
  const lines = visibleXpLines(data.breakdown);
  return apportionXp(
    lines.map((l) => l.amount),
    data.breakdown.total,
  );
}

@customElement("game-xp-panel")
export class GameXpPanel extends LitElement {
  @property({ attribute: false }) view: GameXpPanelState = { kind: "hidden" };
  // Whether anyone can see the panel (WinModal hides it with its modal). The
  // reveal only plays on screen: a result that arrives while it is off screen
  // shows in its final state, and going off screen mid-reveal ends it there.
  @property({ attribute: false }) onScreen = true;

  // The reveal in progress, or null once it has finished (or when there is
  // none: reduced motion, a skip). Null renders the final
  // state, which is also where the reveal ends.
  @state() private reveal: RevealFrame | null = null;
  @state() private barAnimate = false;
  @state() private barDurationMs = CLIMB_MS;
  private animationToken = 0;
  // The Legend result already announced (see announceLegend).
  private announcedLegend: GameXpEligible | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  // The result last announced as settled (see updated()).
  private settledView: GameXpPanelState | null = null;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    // Jump to the end: with its timers gone, a reveal left in place would
    // stay half-done (and aria-busy) if the panel were added back.
    this.skipReveal();
    super.disconnectedCallback();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("view")) {
      const s = this.view;
      if (s.kind === "result" && s.data.eligible && this.onScreen) {
        this.startReveal(s.data);
      } else {
        this.skipReveal();
      }
    } else if (changed.has("onScreen") && !this.onScreen) {
      this.skipReveal();
    }
  }

  private clearTimers(): void {
    this.animationToken++;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private later(ms: number, fn: () => void): void {
    this.timers.push(setTimeout(fn, ms));
  }

  // The reveal. For each XP source a caption rolls in over the bar ("TIME
  // PLAYED +340 XP"), the bar climbs by that much, the counter under it
  // counts up, and the source's card lands in the grid below. When the bar
  // reaches the end of a level, everything stops for the level-up moment:
  // the bar flashes, the caption becomes "LEVEL 24!", the badge at the end
  // pops with a burst, and the level-up card appears. Then the bar empties
  // and the climb carries on. Each multiplier then slams in and is applied to
  // the cards on screen: a wipe runs across them, first to last, turning each
  // value over to its multiplied share (340 → 408) as it passes, with the
  // counter and bar going up with it; the bonus line then lands under the
  // counter. Becoming a Legend is its own, longer moment. Tapping skips to
  // the end.
  private startReveal(data: GameXpEligible): void {
    this.clearTimers();
    if (prefersReducedMotion()) {
      this.reveal = null;
      return;
    }
    const token = this.animationToken;
    const at = (ms: number, fn: () => void) =>
      this.later(ms, () => {
        if (token === this.animationToken && this.reveal !== null) fn();
      });
    const patch = (next: Partial<RevealFrame>) => {
      if (this.reveal !== null) this.reveal = { ...this.reveal, ...next };
    };
    let stepCount = 0;
    const showCaption = (ms: number, caption: Caption) => {
      const step = ++stepCount;
      at(ms, () => patch({ step, caption, levelUp: null }));
    };

    const { breakdown } = data;
    const lines = visibleXpLines(breakdown);
    const faces = lines.map((l) => l.amount);
    const multipliers = visibleMultipliers(breakdown);
    const start = positionOf(
      data.before.level,
      data.before.xpInLevel,
      data.before.xpForNext,
    );
    const end = positionOf(
      data.after.level,
      data.after.xpInLevel,
      data.after.xpForNext,
    );
    // The bar climbs in proportion to XP. When the multipliers cut the award
    // (private and singleplayer games), each source moves the bar its scaled
    // share, so the bar never goes backwards; when they boost it, the sources
    // move it their face value and each multiplier adds its part.
    const total = breakdown.total;
    const subtotal = Math.max(1, breakdown.subtotal);
    const scale = total < subtotal ? total / subtotal : 1;
    const positionAfterXp = (xp: number) =>
      total <= 0 ? start : start + ((end - start) * xp) / total;

    this.barAnimate = false;
    this.reveal = {
      step: 0,
      caption: null,
      position: start,
      level: Math.min(MAX_LEVEL, Math.floor(start)),
      levelUp: null,
      // A player who was already a Legend before this game shows the Legend
      // frame throughout; one who becomes one this game gets it at the
      // level-100 moment.
      legend: data.after.legend && !reachedLegendThisGame(data),
      counted: 0,
      xpText: "before",
      linesShown: 0,
      multipliersShown: 0,
      lineValues: [...faces],
      applying: null,
    };

    // Schedules the bar's climb from where it is to `to` starting at `t`,
    // with a level-up moment at every boundary it crosses. `progress` gives
    // the frame changes (counter, card values) for how far through the climb
    // it is, 0 to 1; they run across the climbing legs, not the pauses. A
    // climb that doesn't move the bar still runs its progress when `hold`.
    // `totalMs` is how long the climbing takes, pauses aside. Returns when it
    // ends.
    let position = start;
    const climb = (
      t: number,
      to: number,
      caption: Caption,
      progress: (f: number) => Partial<RevealFrame>,
      hold = false,
      totalMs = CLIMB_MS,
    ): number => {
      const from = position;
      const runProgress = (
        legT: number,
        ms: number,
        f0: number,
        f1: number,
      ) => {
        const steps = Math.max(2, Math.round(ms / 40));
        for (let i = 1; i <= steps; i++) {
          const f = f0 + ((f1 - f0) * i) / steps;
          at(legT + (ms * i) / steps, () => patch(progress(f)));
        }
      };
      if (to <= from) {
        if (!hold) return t;
        runProgress(t, totalMs, 0, 1);
        return t + totalMs;
      }
      position = to;
      const boundaries: number[] = [];
      for (let b = Math.floor(from) + 1; b <= Math.floor(to); b++) {
        if (b <= MAX_LEVEL) boundaries.push(b);
      }
      const distance = to - from;
      const legMs = (a: number, b: number) =>
        Math.max(MIN_LEG_MS, Math.round((totalMs * (b - a)) / distance));

      let cursor = from;
      for (const b of boundaries) {
        const ms = legMs(cursor, b);
        runProgress(t, ms, (cursor - from) / distance, (b - from) / distance);
        at(t, () => {
          this.barDurationMs = ms;
          this.barAnimate = true;
          patch({ position: b - 1e-6, xpText: "none" });
        });
        t += ms;
        // The level-up moment: the bar is full, the level ticks over.
        const reached = b;
        const legend = reached >= MAX_LEVEL && data.after.legend;
        at(t, () => {
          this.barAnimate = false;
          // Becoming a Legend: when the page takes the moment full screen
          // (the Legend ceremony), the panel rests on its final state behind
          // it instead of playing its own, smaller one.
          if (legend && this.announceLegend(data)) {
            this.skipReveal();
            return;
          }
          patch({
            level: Math.min(MAX_LEVEL, reached),
            levelUp: reached,
            legend,
          });
        });
        t += legend ? LEGEND_MS : LEVEL_UP_MS;
        // Empty the bar and carry on with the rest of this step.
        const resume = stepCount + 1;
        stepCount = resume;
        at(t, () => {
          this.barAnimate = false;
          patch({
            position: reached,
            levelUp: null,
            step: resume,
            caption,
          });
        });
        t += 60;
        cursor = b;
      }
      if (to > cursor) {
        const ms = legMs(cursor, to);
        runProgress(t, ms, (cursor - from) / distance, 1);
        at(t, () => {
          this.barDurationMs = ms;
          this.barAnimate = true;
          patch({ position: to });
        });
        t += ms;
      }
      return t;
    };

    let t = START_MS;
    let barXp = 0;
    let counted = 0;
    lines.forEach((line, i) => {
      const caption: Caption = {
        kind: "line",
        key: line.key,
        amount: line.amount,
      };
      showCaption(t, caption);
      t += CAPTION_LEAD_MS;
      barXp = Math.min(total, barXp + line.amount * scale);
      const countFrom = counted;
      counted += line.amount;
      const countTo = counted;
      t = climb(t, positionAfterXp(barXp), caption, (f) => ({
        counted: Math.round(countFrom + (countTo - countFrom) * f),
      }));
      // The caption is done with: its card lands below.
      at(t, () => patch({ counted: countTo, linesShown: i + 1 }));
      t += GAP_MS;
    });

    // Each multiplier applied to the cards on screen, in turn. The value
    // after the last one is the award, exactly.
    let values = [...faces];
    let product = 1;
    multipliers.forEach((m, k) => {
      const caption: Caption = {
        kind: "multiplier",
        key: m.key,
        permille: m.permille,
      };
      showCaption(t, caption);
      t += MULTIPLIER_LEAD_MS;
      product *= m.permille / 1000;
      const stageTotal =
        k === multipliers.length - 1 ? total : Math.round(subtotal * product);
      const fromValues = values;
      const toValues = apportionXp(faces, stageTotal);
      values = toValues;
      const countFrom = counted;
      counted = stageTotal;
      const applying = m.permille > 1000 ? "boost" : "cut";
      at(t, () => patch({ applying }));
      barXp = Math.max(barXp, Math.min(total, stageTotal));
      // A wipe runs across the cards, first to last; each card's value
      // turns over to its multiplied share as the wipe crosses it.
      const n = faces.length;
      const climbEnd = climb(
        t,
        positionAfterXp(barXp),
        caption,
        (f) => ({
          counted: Math.round(countFrom + (stageTotal - countFrom) * f),
          lineValues: fromValues.map((v, i) => {
            const fi = Math.min(
              1,
              Math.max(0, (f - wipeStart(i, n)) / WIPE_CARD_SHARE),
            );
            return Math.round(v + (toValues[i] - v) * fi);
          }),
        }),
        true,
        WIPE_MS,
      );
      t = Math.max(climbEnd, t + WIPE_MS);
      at(t, () =>
        patch({
          counted: stageTotal,
          lineValues: toValues,
          multipliersShown: k + 1,
          applying: null,
        }),
      );
      t += MULTIPLIER_HOLD_MS;
    });

    // Land exactly on the award, whatever rounding happened on the way.
    const last: Caption | null =
      multipliers.length > 0
        ? {
            kind: "multiplier",
            key: multipliers[multipliers.length - 1].key,
            permille: multipliers[multipliers.length - 1].permille,
          }
        : null;
    const settleFrom = counted;
    t = climb(t, end, last ?? { kind: "heading" }, (f) => ({
      counted: Math.round(settleFrom + (total - settleFrom) * f),
    }));
    const finalValues = finalLineValues(data);
    at(t, () =>
      patch({ counted: total, lineValues: finalValues, xpText: "after" }),
    );
    t += GAP_MS;

    // The payoff caption is the one the panel rests on, so it takes the
    // resting step: when the reveal ends it stays the same element instead
    // of rolling in a second time.
    const payoff = this.payoffCaption(data);
    if (payoff !== null) {
      at(t, () => patch({ step: REST_STEP, caption: payoff, levelUp: null }));
      t += PAYOFF_MS;
    }
    at(t, () => {
      this.barAnimate = false;
      this.reveal = null;
    });
  }

  // Tells the page this result made the player a Legend, once per result:
  // `xp-legend` (detail: the result), cancelable. A listener that takes the
  // moment (plays the Legend ceremony) cancels it. Only ever for a result the
  // server sent (a `result` view), never anything provisional.
  private announceLegend(data: GameXpEligible): boolean {
    if (this.announcedLegend === data) return false;
    this.announcedLegend = data;
    const event = new CustomEvent<GameXpEligible>("xp-legend", {
      detail: data,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    return !this.dispatchEvent(event);
  }

  protected updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    this.announceSettled();
    // A Legend result shown without its reveal reaching level 100 (reduced
    // motion, a skip, or it arrived while the popup was hidden) still gets
    // its moment, once it's on screen.
    const s = this.view;
    if (
      s.kind === "result" &&
      s.data.eligible &&
      this.reveal === null &&
      this.onScreen &&
      reachedLegendThisGame(s.data)
    ) {
      this.announceLegend(s.data);
    }
  }

  // Tells the host once a result is showing in full: its reveal has ended or
  // been skipped, or there was none. Once per result (`detail` is the view).
  private announceSettled(): void {
    const view = this.view;
    if (view.kind !== "result" || this.reveal !== null) return;
    if (this.settledView === view) return;
    this.settledView = view;
    this.dispatchEvent(
      new CustomEvent<GameXpPanelState>("xp-reveal-settled", {
        detail: view,
        bubbles: true,
      }),
    );
  }

  // Ends any reveal on its final state (a no-op when none is playing).
  private skipReveal(): void {
    this.clearTimers();
    this.barAnimate = false;
    this.reveal = null;
  }

  private payoffCaption(data: GameXpEligible): Caption | null {
    if (reachedLegendThisGame(data)) return { kind: "legend" };
    const reached = levelsReachedInGame(data);
    if (reached.length === 0) return null;
    return { kind: "level_up", level: reached[reached.length - 1].level };
  }

  // The colours of a multiplier's bonus: a subscription tier's own (see
  // SUBSCRIBER_TIERS), or null for the default lime.
  private accentOf(m: {
    key: "game" | "subscriber";
    permille: number;
  }): readonly [string, string] | null {
    if (m.key !== "subscriber") return null;
    return subscriberTierOf(m.permille)?.colors ?? null;
  }

  // The bonus colours the panel is showing: those of the multiplier being
  // applied, mid-reveal; otherwise the subscription tier's, if the game had
  // a tier's boost.
  private panelAccent(data: GameXpEligible): string | undefined {
    const multipliers = visibleMultipliers(data.breakdown);
    const r = this.reveal;
    const current =
      r !== null && r.applying !== null
        ? multipliers[r.multipliersShown]
        : multipliers.find((m) => this.accentOf(m) !== null);
    const accent = current === undefined ? null : this.accentOf(current);
    return accent === null
      ? undefined
      : `--accent-a: ${accent[0]}; --accent-b: ${accent[1]}`;
  }

  private frame(
    content: TemplateResult,
    stateName: string,
    style?: string,
  ): TemplateResult {
    const revealing = this.reveal !== null;
    return html`<section
      data-xp-panel
      data-xp-state=${stateName}
      data-xp-revealing=${revealing ? "true" : nothing}
      style=${style ?? nothing}
      class="relative mb-4 rounded-lg bg-black/30 p-3 text-left text-white ${revealing
        ? "cursor-pointer"
        : ""}"
      aria-live="polite"
      aria-busy=${revealing ? "true" : "false"}
      title=${revealing ? translateText("progression.tap_to_skip") : nothing}
      @click=${() => this.skipReveal()}
    >
      ${revealing
        ? // Tapping anywhere skips; this is the same for the keyboard. Out of
          // sight until focused, so the panel looks the same for a pointer.
          html`<button
            type="button"
            data-xp-skip
            class="sr-only focus:not-sr-only focus:absolute focus:right-2 focus:top-2 focus:z-10 focus:rounded-sm focus:bg-black/80 focus:px-2 focus:py-1 focus:text-xs focus:font-bold focus:text-white"
            @click=${(e: Event) => {
              e.stopPropagation();
              this.skipReveal();
            }}
          >
            ${translateText("progression.skip_reveal")}
          </button>`
        : nothing}
      ${content}
    </section>`;
  }

  private renderNote(key: string, stateName: string): TemplateResult {
    return this.frame(
      html`<p class="m-0 text-sm text-white/80">${translateText(key)}</p>`,
      stateName,
    );
  }

  private renderCalculating(): TemplateResult {
    return this.frame(
      html`<div class="flex items-center gap-2 text-sm text-white/80">
        <span
          class="w-4 h-4 shrink-0 border-2 border-white/30 border-t-white/80 rounded-full animate-spin"
          aria-hidden="true"
        ></span>
        <span>${translateText("progression.calculating")}</span>
      </div>`,
      "calculating",
    );
  }

  // ---------------------------------------------------------------------------
  // Full panel (WinModal): rolling caption, segmented bar, counter, level.
  // ---------------------------------------------------------------------------

  private captionContent(caption: Caption): TemplateResult {
    switch (caption.kind) {
      case "line":
        return html`${translateText(XP_LINE_LABEL_KEYS[caption.key])}
          <span class="text-yellow-300"
            >${translateText("progression.xp_total", {
              xp: formatXp(caption.amount),
            })}</span
          >`;
      case "multiplier":
        return html`${xpBonusText(caption.key, caption.permille)}`;
      case "heading":
        return html`${translateText("progression.xp_heading")}`;
      case "level_up":
        return html`<span class="text-yellow-300"
          >${translateText("progression.level_reached", {
            level: caption.level,
          })}</span
        >`;
      case "legend":
        return html`<span class="text-yellow-300"
          >${translateText("progression.legend_reached_title")}</span
        >`;
    }
  }

  private renderCaption(data: GameXpEligible): TemplateResult {
    const r = this.reveal;
    const levelUp = r?.levelUp ?? null;
    let content: TemplateResult | typeof nothing = nothing;
    let key: string;
    if (levelUp !== null && r?.legend) {
      // Becoming a Legend: the biggest moment on the track.
      key = "legend";
      content = html`<div
        class="xp-levelup-in xp-legend-text text-center text-2xl font-black uppercase italic tracking-wide sm:text-3xl"
        data-xp-caption-levelup=${levelUp}
        data-xp-caption-legend
      >
        ${translateText("progression.legend_reached_title")}
      </div>`;
    } else if (levelUp !== null) {
      // The level-up moment: a big "LEVEL 24!" that slams in.
      key = `lvl-${levelUp}`;
      content = html`<div
        class="xp-levelup-in text-center text-2xl font-black uppercase italic tracking-wide text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.8)] sm:text-3xl"
        data-xp-caption-levelup=${levelUp}
      >
        ${translateText("progression.level_reached", { level: levelUp })}
      </div>`;
    } else {
      key = `s-${r?.step ?? REST_STEP}`;
      // After the reveal the caption rests on the payoff, or the heading.
      const caption =
        r === null
          ? (this.payoffCaption(data) ?? { kind: "heading" as const })
          : r.caption;
      if (caption?.kind === "multiplier") {
        // A multiplier slams in, and a wipe runs through it: lime for a
        // bonus, blue for a cut.
        const boost = caption.permille > 1000;
        content = html`<div
          class="xp-levelup-in xp-bonus-text ${boost
            ? ""
            : "xp-bonus-text-cut"} text-center text-xl font-black uppercase italic tracking-wide sm:text-2xl"
          data-xp-caption-step=${r?.step ?? REST_STEP}
        >
          ${this.captionContent(caption)}
        </div>`;
      } else if (caption !== null) {
        content = html`<div
          class="xp-caption-in text-center text-lg font-black uppercase italic tracking-wide sm:text-xl"
          data-xp-caption-step=${r?.step ?? REST_STEP}
        >
          ${this.captionContent(caption)}
        </div>`;
      }
    }
    // A fresh element per step (or per level reached), so each replays its
    // entrance animation.
    return html`<div
      class="flex h-9 items-end justify-center overflow-visible"
      data-xp-caption
    >
      ${keyed(key, content)}
    </div>`;
  }

  private renderSegmentedBar(
    fillPercent: number,
    flashing: boolean,
    valueText: string,
  ): TemplateResult {
    return html`<div
      data-xp-bar
      class="relative h-3 w-full overflow-hidden rounded-sm bg-white/15 ${flashing
        ? "xp-bar-flash"
        : ""}"
      role="progressbar"
      aria-label=${translateText("progression.xp_bar_label")}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow=${Math.round(fillPercent)}
      aria-valuetext=${valueText === "" ? nothing : valueText}
    >
      <div
        data-xp-bar-fill
        class="h-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.7)] ${this
          .barAnimate
          ? "transition-[width] ease-linear"
          : ""}"
        style="width: ${fillPercent}%; transition-duration: ${this
          .barDurationMs}ms"
      ></div>
      ${Array.from(
        { length: BAR_SEGMENTS - 1 },
        (_, i) =>
          html`<span
            aria-hidden="true"
            class="absolute top-0 h-full w-[3px] -translate-x-1/2 bg-zinc-900"
            style="left: ${((i + 1) * 100) / BAR_SEGMENTS}%"
          ></span>`,
      )}
    </div>`;
  }

  private renderFull(data: GameXpEligible): TemplateResult {
    const { after } = data;
    const r = this.reveal;
    const position =
      r?.position ?? positionOf(after.level, after.xpInLevel, after.xpForNext);
    const level = r?.level ?? Math.min(MAX_LEVEL, Math.floor(position));
    const legend = r === null ? after.legend : r.legend;
    const barLevel = Math.floor(position);
    const fill =
      position >= MAX_LEVEL ? 100 : Math.max(0, (position - barLevel) * 100);
    const levelUp = r?.levelUp ?? null;
    const progressText =
      r === null || r.xpText === "after"
        ? xpProgressText(after.xpInLevel, after.xpForNext)
        : r.xpText === "before"
          ? xpProgressText(data.before.xpInLevel, data.before.xpForNext)
          : "";
    const counted = r?.counted ?? data.breakdown.total;
    const applying = r?.applying ?? null;
    // The bar runs from the level the player is on (left) to the next one
    // (right). At a level-up moment the right badge is the level being
    // reached, popping; after it, both move on. At level 100 there is no next
    // level: the left badge is 100 (the crown for a Legend) and the right
    // slot is empty.
    const prestige = r !== null ? data.before.prestige : after.prestige;
    const current = levelUp !== null ? levelUp - 1 : level;
    const next = levelUp ?? (level < MAX_LEVEL ? level + 1 : null);
    const levelBadge = (lvl: number, isLegend: boolean) =>
      html`<level-badge
        .level=${lvl}
        .prestige=${prestige}
        .legend=${isLegend}
        .size=${40}
      ></level-badge>`;
    // A badge that changes during the reveal settles in, rather than
    // swapping in place.
    const settle = r !== null ? "xp-badge-in" : "";

    return this.frame(
      html`
        ${this.renderStyles()} ${this.renderCaption(data)}
        <!-- Every box here is a fixed size, so nothing moves while the
             numbers and the level change. -->
        <div class="mt-1 flex items-start gap-3">
          <!-- The level the player is on. The same width as the next level's
               badge on the right, so the bar, and the counter under it, are
               centred in the panel like the caption above. -->
          <div class="grid h-10 w-10 shrink-0 place-items-center">
            ${keyed(
              `${current}-${legend && current >= MAX_LEVEL}`,
              html`<span
                data-xp-current-badge
                data-level=${current}
                class="inline-block ${settle}"
                >${levelBadge(current, legend && current >= MAX_LEVEL)}</span
              >`,
            )}
          </div>
          <div class="@container min-w-0 flex-1 pt-3.5">
            ${this.renderSegmentedBar(fill, levelUp !== null, progressText)}
            <!-- The counter centred under the bar, the level's progress at
                 its right end. A bar too narrow for both side by side (a
                 phone) stacks them, centred, so they never run together.
                 Fixed heights either way: nothing moves during the reveal. -->
            <div
              data-xp-counter-row
              class="mt-1 flex h-9 flex-col items-center @min-[16rem]:grid @min-[16rem]:h-5 @min-[16rem]:grid-cols-[1fr_auto_1fr] @min-[16rem]:gap-x-2"
            >
              <span class="hidden @min-[16rem]:block"></span>
              <span
                data-xp-total
                class="text-sm font-bold tabular-nums transition-colors ${applying ===
                "boost"
                  ? "xp-accent-text"
                  : applying === "cut"
                    ? "text-sky-300"
                    : "text-white/90"}"
              >
                ${translateText("progression.xp_total", {
                  xp: formatXp(counted),
                })}
              </span>
              <span
                data-xp-header-level
                class="max-w-full truncate text-center text-[11px] tabular-nums text-white/60 @min-[16rem]:text-right"
              >
                ${progressText}
              </span>
            </div>
          </div>
          <div class="relative grid h-10 w-10 shrink-0 place-items-center">
            ${levelUp !== null
              ? keyed(
                  `${levelUp}-${legend}`,
                  html`<span
                      aria-hidden="true"
                      class="xp-burst pointer-events-none absolute inset-0 rounded-full border-2 border-yellow-200 shadow-[0_0_12px_rgba(250,204,21,0.9)]"
                    ></span
                    ><span
                      aria-hidden="true"
                      class="xp-burst-late pointer-events-none absolute inset-0 rounded-full border border-white/80"
                    ></span>`,
                )
              : nothing}
            ${next !== null
              ? keyed(
                  `${next}-${levelUp !== null}-${legend}`,
                  html`<span
                    data-xp-next-badge
                    data-level=${next}
                    class="relative inline-block ${levelUp !== null
                      ? legend
                        ? "xp-legend-pop"
                        : "xp-badge-pop"
                      : `opacity-60 ${settle}`}"
                    >${levelBadge(
                      next,
                      levelUp !== null && legend && next >= MAX_LEVEL,
                    )}</span
                  >`,
                )
              : nothing}
          </div>
        </div>
        ${this.renderBonuses(data)}
        <div data-xp-recap>${this.renderRecap(data)}</div>
      `,
      "result",
      this.panelAccent(data),
    );
  }

  private renderStyles(): TemplateResult {
    return html`<style>
      @keyframes xp-caption-in {
        from {
          opacity: 0;
          transform: translateY(70%) skewX(-8deg);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      .xp-caption-in {
        animation: xp-caption-in 220ms ease-out;
      }
      @keyframes xp-levelup-in {
        0% {
          opacity: 0;
          transform: scale(2.2) skewX(-8deg);
        }
        55% {
          opacity: 1;
          transform: scale(0.92) skewX(-8deg);
        }
        100% {
          transform: scale(1) skewX(0);
        }
      }
      .xp-levelup-in {
        animation: xp-levelup-in 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
      }
      @keyframes xp-bar-flash {
        0%,
        100% {
          filter: brightness(1);
          box-shadow: none;
        }
        50% {
          filter: brightness(1.9);
          box-shadow: 0 0 16px 2px rgba(255, 255, 255, 0.85);
        }
      }
      .xp-bar-flash {
        animation: xp-bar-flash 450ms ease-in-out 2;
      }
      @keyframes xp-badge-pop {
        0% {
          transform: scale(1);
        }
        30% {
          transform: scale(1.45);
        }
        60% {
          transform: scale(0.95);
        }
        100% {
          transform: scale(1);
        }
      }
      .xp-badge-pop {
        animation: xp-badge-pop 650ms ease-out;
      }
      /* A level badge moving on after a level-up. No end opacity, so the
         next level's badge settles at its own dimmed opacity. */
      @keyframes xp-badge-in {
        from {
          opacity: 0;
          transform: scale(0.6);
        }
        to {
          transform: none;
        }
      }
      .xp-badge-in {
        animation: xp-badge-in 280ms cubic-bezier(0.2, 0.9, 0.3, 1.2);
      }
      @keyframes xp-legend-pop {
        0% {
          transform: scale(1) rotate(0);
          filter: brightness(1);
        }
        25% {
          transform: scale(1.8) rotate(-8deg);
          filter: brightness(2);
        }
        50% {
          transform: scale(1.3) rotate(6deg);
        }
        100% {
          transform: scale(1.15) rotate(0);
          filter: brightness(1.2);
        }
      }
      .xp-legend-pop {
        animation: xp-legend-pop 1100ms cubic-bezier(0.2, 0.9, 0.3, 1.2)
          forwards;
      }
      @keyframes xp-burst {
        from {
          transform: scale(0.6);
          opacity: 1;
        }
        to {
          transform: scale(2.4);
          opacity: 0;
        }
      }
      .xp-burst {
        animation: xp-burst 700ms ease-out forwards;
      }
      .xp-burst-late {
        opacity: 0;
        animation: xp-burst 700ms ease-out 180ms forwards;
      }
      /* A multiplier's wipe: a bright band runs across the caption, then
         across each card in turn (each card's own delay comes from its
         --wipe-delay), and the card's value turns over as it passes. In the
         bonus's colours: --accent-a to --accent-b, set on the panel for a
         subscription tier (Sovereign gold, Warlord cyan, Vanguard green),
         lime otherwise; blue for a cut. */
      @keyframes xp-wipe {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: 0 0;
        }
      }
      @keyframes xp-text-wipe {
        from {
          background-position:
            100% 0,
            0 0;
        }
        to {
          background-position:
            0 0,
            0 0;
        }
      }
      .xp-bonus-text {
        background:
          linear-gradient(
            100deg,
            transparent 42%,
            #ffffff 50%,
            transparent 58%
          ),
          linear-gradient(
            90deg,
            var(--accent-a, #bef264),
            var(--accent-b, #bef264)
          );
        background-size:
          300% 100%,
          100% 100%;
        background-position:
          100% 0,
          0 0;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        filter: drop-shadow(
          0 0 8px color-mix(in srgb, var(--accent-a, #a3e635) 55%, transparent)
        );
      }
      .xp-bonus-text-cut {
        --accent-a: #7dd3fc;
        --accent-b: #7dd3fc;
      }
      .xp-levelup-in.xp-bonus-text {
        animation:
          xp-levelup-in 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2),
          xp-text-wipe 900ms ease-in-out 250ms both;
      }
      /* The bonus line under the counter, in the same colours. */
      .xp-bonus-line {
        background: linear-gradient(
          90deg,
          var(--accent-a, #bef264),
          var(--accent-b, #bef264)
        );
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .xp-accent-text {
        color: var(--accent-b, #bef264);
      }
      .xp-card-wipe {
        --wipe-glow: color-mix(
          in srgb,
          var(--accent-a, #bef264) 60%,
          transparent
        );
      }
      .xp-card-wipe.xp-wipe-cut {
        --wipe-glow: rgba(125, 211, 252, 0.55);
      }
      .xp-card-wipe::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(
          100deg,
          transparent 36%,
          var(--wipe-glow) 46%,
          rgba(255, 255, 255, 0.7) 50%,
          var(--wipe-glow) 54%,
          transparent 64%
        );
        background-size: 300% 100%;
        background-position: 100% 0;
        animation: xp-wipe var(--wipe-ms, 400ms) ease-in-out
          var(--wipe-delay, 0ms) both;
      }
      .xp-card-boosted {
        border-color: color-mix(
          in srgb,
          var(--accent-a, #a3e635) 40%,
          transparent
        ) !important;
      }
      .xp-card-boosted [data-xp-card-value] {
        color: var(--accent-b, #d9f99d);
        text-shadow: 0 0 8px
          color-mix(in srgb, var(--accent-a, #a3e635) 50%, transparent);
      }
      .xp-card-cut {
        border-color: rgba(125, 211, 252, 0.35) !important;
      }
      .xp-card-cut [data-xp-card-value] {
        color: #bae6fd;
      }
      /* A card phasing in: it rises out of a blur, flares, overshoots a
         touch and settles, and a shine sweeps across it. */
      @keyframes xp-card-in {
        0% {
          opacity: 0;
          transform: translateY(18px) scale(0.82);
          filter: blur(8px) brightness(2.2);
        }
        55% {
          opacity: 1;
          transform: translateY(-3px) scale(1.05);
          filter: blur(0) brightness(1.7);
        }
        100% {
          opacity: 1;
          transform: none;
          filter: none;
        }
      }
      .xp-card-in {
        animation: xp-card-in 560ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
      }
      @keyframes xp-card-shine {
        from {
          background-position: 100% 0;
        }
        to {
          background-position: 0 0;
        }
      }
      .xp-shine {
        position: relative;
      }
      .xp-card-in.xp-shine::after,
      .xp-card-in .xp-shine::after {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        background: linear-gradient(
          100deg,
          transparent 40%,
          rgba(255, 255, 255, 0.4) 50%,
          transparent 60%
        );
        background-size: 300% 100%;
        animation: xp-card-shine 750ms ease-out 150ms both;
      }
      /* Inside a space that is sliding open: wait for it to open first. */
      .xp-card-in.xp-after-slide,
      .xp-after-slide .xp-badge-pop {
        animation-delay: 260ms;
      }
      .xp-card-in.xp-after-slide.xp-shine::after {
        animation-delay: 410ms;
      }
      .xp-legend-text {
        background: linear-gradient(90deg, #fde047, #f0abfc, #fde047);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        filter: drop-shadow(0 0 10px rgba(250, 204, 21, 0.8));
      }
      @media (prefers-reduced-motion: reduce) {
        .xp-caption-in,
        .xp-levelup-in,
        .xp-bar-flash,
        .xp-badge-pop,
        .xp-badge-in,
        .xp-legend-pop,
        .xp-burst,
        .xp-burst-late,
        .xp-levelup-in.xp-bonus-text,
        .xp-card-wipe::before,
        .xp-card-in,
        .xp-card-in.xp-shine::after,
        .xp-card-in .xp-shine::after {
          animation: none;
        }
      }
    </style>`;
  }

  // Under the bar: the milestone card and a card per XP source. The source
  // cards' slots are laid out from the start (they are coming either way) and
  // fill in as the reveal gets to them. What might not come (a milestone, a
  // bonus, the left-early note) takes no space until it does: then its space
  // slides open and it pops in, so the empty space never gives it away.
  private renderRecap(data: GameXpEligible): TemplateResult {
    const r = this.reveal;
    return html`
      ${this.renderLevelUp(data)} ${this.renderBreakdown(data)}
      ${data.breakdown.leftEarly
        ? this.collapsible(
            r === null,
            html`<p data-xp-left-early class="m-0 mt-3 text-xs text-amber-300">
              ${translateText("progression.left_early")}
            </p>`,
          )
        : nothing}
    `;
  }

  // Classes for a slot that waits for the reveal: hidden until it lands, then
  // animated in.
  private slotClass(shown: boolean): string {
    if (this.reveal === null) return "";
    return shown ? "xp-card-in" : "invisible";
  }

  // The same for a slot inside a collapsible: it pops in once its space has
  // slid open.
  private slideSlotClass(shown: boolean): string {
    if (this.reveal === null) return "";
    return shown ? "xp-card-in xp-after-slide" : "invisible";
  }

  // Space that is closed until `open`, then slides open (the content below
  // moves down with it). Closed, the content is laid out but clipped to
  // nothing.
  private collapsible(open: boolean, content: TemplateResult): TemplateResult {
    return html`<div
      data-xp-collapsible=${open ? "open" : "closed"}
      class="grid transition-[grid-template-rows] duration-300 ease-out ${open
        ? "grid-rows-[1fr]"
        : "grid-rows-[0fr]"}"
    >
      <div class="min-h-0 ${open ? "" : "overflow-hidden"}">${content}</div>
    </div>`;
  }

  // The one game that makes a player a Legend gets its own moment instead of
  // the ordinary level-up card: it is the end of the whole track.
  private renderLegendMoment(data: GameXpEligible): TemplateResult {
    const shown = this.reveal === null || this.reveal.legend;
    return this.collapsible(
      shown,
      html`<div
        data-xp-legend
        data-xp-slot-hidden=${shown ? nothing : "true"}
        class="xp-shine mt-3 flex items-center justify-center gap-3 rounded-xl border border-yellow-300/50 bg-gradient-to-r from-transparent via-fuchsia-500/15 to-transparent px-3 py-2.5 ${this.slideSlotClass(
          shown,
        )}"
      >
        <level-badge
          .level=${100}
          .prestige=${data.after.prestige}
          .legend=${true}
          .size=${48}
        ></level-badge>
        <div class="min-w-0">
          <div
            class="text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-300"
          >
            ${translateText("progression.legend")}
          </div>
          <div class="text-sm text-white/80">
            ${translateText("progression.legend_reached_body", {
              xp: formatXp(data.after.lifetimeXp),
            })}
          </div>
        </div>
      </div>`,
    );
  }

  // A card for a milestone reached this game (10, 25, 50, 75), or the Legend
  // card. An ordinary level-up gets no card: the caption and the badge at the
  // end of the bar say it. During the reveal its space slides open when the
  // bar reaches the milestone, and the card pops in.
  private renderLevelUp(data: GameXpEligible): TemplateResult | typeof nothing {
    if (reachedLegendThisGame(data)) return this.renderLegendMoment(data);
    const milestone = [...levelsReachedInGame(data)]
      .reverse()
      .find((lvl) => isMilestoneLevel(lvl.level));
    if (milestone === undefined) return nothing;
    const r = this.reveal;
    const shown = r === null || r.level >= milestone.level;
    return this.collapsible(
      shown,
      html`<div
        data-xp-levelup
        data-xp-milestone=${milestone.level}
        data-xp-slot-hidden=${shown ? nothing : "true"}
        class="xp-shine mt-3 flex items-center justify-center gap-3 rounded-xl border border-yellow-400/30 bg-gradient-to-r from-transparent via-yellow-400/15 to-transparent px-3 py-2 ${this.slideSlotClass(
          shown,
        )}"
      >
        <span
          data-xp-level-reached=${milestone.level}
          class="grid h-11 w-11 shrink-0 place-items-center rounded-full shadow-[0_0_16px_rgba(250,204,21,0.55)] ${r !==
            null && shown
            ? "xp-badge-pop"
            : ""}"
        >
          <level-badge
            .level=${milestone.level}
            .prestige=${milestone.prestige}
            .size=${40}
          ></level-badge>
        </span>
        <div class="min-w-0">
          <div
            class="text-[10px] font-bold uppercase tracking-[0.18em] text-yellow-300"
          >
            ${translateText("progression.new_milestone")}
          </div>
          <div class="text-lg font-black leading-tight text-white">
            ${translateText("progression.level", { level: milestone.level })}
          </div>
        </div>
      </div>`,
    );
  }

  // One small card per XP source and multiplier, like the stats page tiles:
  // a label over a big number.
  // The slot (entrance) and the card (the multiplier's wipe) are separate
  // elements, so their animations don't replace each other.
  private renderXpCard(
    label: string,
    value: string,
    classes: string,
    attrs: { line?: XpLineKey; shown: boolean; style?: string },
  ): TemplateResult {
    return html`<div
      class="w-[calc(50%-0.25rem)] min-w-0 sm:w-[calc(25%-0.375rem)] ${this.slotClass(
        attrs.shown,
      )}"
      data-xp-slot-hidden=${attrs.shown ? nothing : "true"}
    >
      <div
        data-xp-card
        title=${label}
        class="xp-shine h-full rounded-xl border bg-white/5 px-2 py-2.5 text-center ${classes}"
        style=${attrs.style ?? nothing}
      >
        <div
          data-xp-line=${attrs.line ?? nothing}
          class="truncate text-[10px] font-bold uppercase tracking-wider text-blue-200/55"
        >
          ${label}
        </div>
        <div
          data-xp-card-value
          class="mt-1 truncate text-lg font-black leading-none tabular-nums"
        >
          ${value}
        </div>
      </div>
    </div>`;
  }

  // The multiplier lines under the counter. During the reveal their row
  // slides open when the first multiplier's wipe has crossed the cards, and
  // each line pops in as its multiplier lands.
  private renderBonuses(data: GameXpEligible): TemplateResult | typeof nothing {
    const multipliers = visibleMultipliers(data.breakdown);
    if (multipliers.length === 0) return nothing;
    const r = this.reveal;
    return this.collapsible(
      r === null || r.multipliersShown > 0,
      html`<div
        data-xp-bonuses
        class="mt-1 flex min-h-5 flex-wrap items-center justify-center gap-x-5"
      >
        ${multipliers.map((m, k) => {
          const shown = r === null || k < r.multipliersShown;
          // Each line in its own bonus's colours.
          const accent = this.accentOf(m);
          return html`<span
            data-xp-multiplier=${m.key}
            data-xp-tier=${m.key === "subscriber"
              ? (subscriberTierOf(m.permille)?.tier ?? nothing)
              : nothing}
            data-xp-slot-hidden=${shown ? nothing : "true"}
            style=${accent === null
              ? nothing
              : `--accent-a: ${accent[0]}; --accent-b: ${accent[1]}`}
            class="inline-block text-sm font-bold uppercase italic tracking-wide ${m.permille >
            1000
              ? "xp-bonus-line"
              : "text-sky-300"} ${this.slideSlotClass(shown)}"
            >${xpBonusText(m.key, m.permille)}</span
          >`;
        })}
      </div>`,
    );
  }

  private renderBreakdown(data: GameXpEligible): TemplateResult {
    const lines = visibleXpLines(data.breakdown);
    if (lines.length === 0) return html``;
    const r = this.reveal;
    const values = r?.lineValues ?? finalLineValues(data);
    const applying = r?.applying ?? null;
    return html`<div
      data-xp-breakdown
      class="mt-3 flex flex-wrap justify-center gap-2"
    >
      ${lines.map((line, i) => {
        const shown = r === null || i < r.linesShown;
        // Once a multiplier has turned a card over it keeps the colour:
        // lime for a bonus, blue for a cut.
        const tone =
          values[i] > line.amount
            ? "xp-card-boosted"
            : values[i] < line.amount
              ? "xp-card-cut"
              : "";
        // During a multiplier the wipe crosses the cards in order.
        const wiping = applying !== null && shown;
        const wipe = wiping
          ? `xp-card-wipe ${applying === "cut" ? "xp-wipe-cut" : ""}`
          : "";
        const style = wiping
          ? `--wipe-delay: ${Math.round(wipeStart(i, lines.length) * WIPE_MS)}ms; --wipe-ms: ${Math.round(WIPE_CARD_SHARE * WIPE_MS)}ms`
          : undefined;
        return this.renderXpCard(
          translateText(XP_LINE_LABEL_KEYS[line.key]),
          translateText("progression.xp_total", { xp: formatXp(values[i]) }),
          `text-yellow-300 border-yellow-400/20 ${tone} ${wipe}`,
          { line: line.key, shown, style },
        );
      })}
    </div>`;
  }

  render() {
    const s = this.view;
    switch (s.kind) {
      case "hidden":
        return nothing;
      case "signed_out":
        return this.renderNote("progression.sign_in_to_earn", "signed_out");
      case "awaiting_end":
        return this.renderNote("progression.awaiting_end", "awaiting_end");
      case "calculating":
        return this.renderCalculating();
      case "result":
        if (!s.data.eligible) {
          return this.renderNote(
            ineligibleReasonKey(s.data.reason),
            "ineligible",
          );
        }
        return this.renderFull(s.data);
    }
  }
}
