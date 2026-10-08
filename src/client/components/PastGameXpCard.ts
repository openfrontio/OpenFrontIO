import type { GameType } from "@openfront/engine-api/game/GameTypes";
import type {
  GameXpEligible,
  GameXpResponse,
} from "@openfront/shared/ApiSchemas";
import { html, LitElement, nothing, svg, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  BEFORE_PROGRESSION,
  ineligibleReasonKey,
  isMilestoneLevel,
  levelsReachedInGame,
  MAX_LEVEL,
  multiplierAmounts,
  reachedLegendThisGame,
  subscriberTierOf,
  visibleXpLines,
  XP_LINE_LABEL_KEYS,
} from "../Progression";
import { translateText } from "../Utils";
import "./LevelBadge";
import { formatXp, xpBonusText, xpProgressText } from "./XpBar";

// What a past game's XP card is showing. The caller (GameStatsModal) owns the
// fetching; this element only renders, so every state can be set directly.
export type PastGameXpView =
  // Nothing to show: signed out, progression off, not processed, a failure.
  | { kind: "hidden" }
  // The player's own game, just finished: the server is still scoring it.
  | { kind: "calculating" }
  | { kind: "result"; data: GameXpResponse };

// A boost from no known tier, and any game-type boost: the default lime.
const DEFAULT_BOOST_COLORS: readonly [string, string] = ["#bef264", "#bef264"];

const BADGE_SIZE = 30;

/**
 * The XP a past game earned, as a static summary card under the game summary
 * in the stats modal: the total, the level change (or the level the game left
 * the player on), each source at its base value, and each multiplier as its
 * own line. The end-of-game reveal is GameXpPanel.
 */
@customElement("past-game-xp-card")
export class PastGameXpCard extends LitElement {
  @property({ attribute: false }) view: PastGameXpView = { kind: "hidden" };
  // The game's type, once its record has loaded: picks the copy for a game
  // that didn't earn XP (see ineligibleReasonKey).
  @property({ attribute: false }) gameType: GameType | null = null;

  createRenderRoot() {
    return this;
  }

  private frame(content: TemplateResult, stateName: string): TemplateResult {
    return html`<section
      data-past-xp
      data-past-xp-state=${stateName}
      class="mt-4 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] px-4 py-3.5 text-left text-white sm:px-[18px]"
      aria-live="polite"
    >
      ${content}
    </section>`;
  }

  private heading(extra = ""): TemplateResult {
    return html`<div
      class="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-200/55 ${extra}"
    >
      ${translateText("progression.xp_heading")}
    </div>`;
  }

  // One line under the heading: calculating, didn't earn XP, or played
  // before levels existed.
  private renderNote(
    icon: TemplateResult,
    text: string,
    stateName: string,
    tone: string,
  ): TemplateResult {
    return this.frame(
      html`<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        ${this.heading("flex-none")}
        <div
          class="flex min-w-0 flex-[1_1_240px] items-center gap-2 text-sm ${tone}"
        >
          ${icon}
          <span data-past-xp-note>${text}</span>
        </div>
      </div>`,
      stateName,
    );
  }

  private renderCalculating(): TemplateResult {
    return this.renderNote(
      html`<span
        class="size-4 flex-none animate-spin rounded-full border-2 border-white/30 border-t-white/85"
        aria-hidden="true"
      ></span>`,
      translateText("progression.calculating"),
      "calculating",
      "text-white/70",
    );
  }

  // A small circled glyph: "i" for a game that didn't earn XP, a dash for one
  // played before levels existed.
  private circledIcon(kind: "info" | "dash"): TemplateResult {
    return html`<svg
      viewBox="0 0 18 18"
      class="size-[18px] flex-none ${kind === "info"
        ? "text-white/40"
        : "text-white/30"}"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
    >
      <circle cx="9" cy="9" r="8" stroke-width="1.5" />
      ${kind === "info"
        ? svg`<path d="M9 8v5" stroke-width="1.8" stroke-linecap="round" />
            <circle
              cx="9"
              cy="5.3"
              r="1.05"
              fill="currentColor"
              stroke="none"
            />`
        : svg`<path d="M5.5 9h7" stroke-width="1.8" stroke-linecap="round" />`}
    </svg>`;
  }

  private signed(amount: number): string {
    return translateText(
      amount < 0 ? "progression.xp_minus" : "progression.xp_plus",
      { xp: formatXp(Math.abs(amount)) },
    );
  }

  private badge(
    level: number,
    prestige: number,
    legend = false,
  ): TemplateResult {
    return html`<level-badge
      class="inline-block align-middle"
      .level=${level}
      .prestige=${prestige}
      .legend=${legend}
      .size=${BADGE_SIZE}
    ></level-badge>`;
  }

  // The right of the header: "46 → 47  Level 46 → 47", with a glow and a chip
  // when the game reached a milestone; without a level-up, the level the game
  // left the player on and their progress through it.
  private renderLevel(data: GameXpEligible): TemplateResult {
    const { before, after } = data;
    const reached = levelsReachedInGame(data);
    if (reached.length === 0) {
      return html`<div
        data-past-xp-level=${after.level}
        class="flex flex-none items-center gap-2"
      >
        ${this.badge(after.level, after.prestige, after.legend)}
        <div class="leading-tight">
          <div class="text-[15px] font-extrabold">
            ${after.legend
              ? translateText("progression.legend")
              : translateText("progression.level", { level: after.level })}
          </div>
          <div class="text-xs tabular-nums text-white/55">
            ${xpProgressText(after.xpInLevel, after.xpForNext)}
          </div>
        </div>
      </div>`;
    }
    const last = reached[reached.length - 1];
    const legend = reachedLegendThisGame(data);
    const milestone = reached.some((l) => isMilestoneLevel(l.level));
    return html`<div
      data-past-xp-levelup=${last.level}
      class="flex flex-none flex-wrap items-center gap-2"
    >
      ${this.badge(before.level, before.prestige)}
      <span class="text-base font-bold text-white/45" aria-hidden="true"
        >→</span
      >
      <span
        data-past-xp-new-badge
        class="inline-grid place-items-center rounded-full ${milestone
          ? "shadow-[0_0_14px_rgba(250,204,21,0.55)]"
          : ""}"
      >
        ${this.badge(
          last.level,
          last.prestige,
          legend && last.level >= MAX_LEVEL,
        )}
      </span>
      <span class="ml-1 text-[15px] font-extrabold tabular-nums">
        ${translateText("progression.level_change", {
          from: before.level,
          to: last.level,
        })}
      </span>
      ${milestone
        ? html`<span
            data-past-xp-milestone
            class="ml-1 rounded-full border border-yellow-400/45 bg-yellow-400/10 px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-[0.14em] text-yellow-300"
          >
            ${translateText("progression.milestone_chip")}
          </span>`
        : nothing}
    </div>`;
  }

  // The multipliers, each its own line under the sources with the XP it
  // added, so the lines add up to the total (see multiplierAmounts). A
  // subscriber boost in its tier's colours.
  private renderMultipliers(data: GameXpEligible): TemplateResult {
    return html`${multiplierAmounts(data.breakdown).map((m) => {
      const cut = m.permille < 1000;
      const colors =
        m.key === "subscriber"
          ? (subscriberTierOf(m.permille)?.colors ?? DEFAULT_BOOST_COLORS)
          : DEFAULT_BOOST_COLORS;
      return html`<div
        data-past-xp-multiplier=${m.key}
        data-xp-tier=${m.key === "subscriber"
          ? (subscriberTierOf(m.permille)?.tier ?? nothing)
          : nothing}
        class="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px] leading-relaxed"
      >
        <span
          class="font-extrabold uppercase italic tracking-[0.04em] ${cut
            ? "text-sky-300"
            : "bg-clip-text text-transparent"}"
          style=${cut
            ? nothing
            : `background-image: linear-gradient(90deg, ${colors[0]}, ${colors[1]})`}
          >${xpBonusText(m.key, m.permille)}</span
        >
        ${m.amount === null
          ? nothing
          : html`<span
              data-past-xp-multiplier-amount
              class="font-extrabold tabular-nums ${cut ? "text-sky-300" : ""}"
              style=${cut ? nothing : `color: ${colors[1]}`}
              >${this.signed(m.amount)}</span
            >`}
      </div>`;
    })}`;
  }

  private renderResult(data: GameXpEligible): TemplateResult {
    const lines = visibleXpLines(data.breakdown);
    return this.frame(
      html`
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2.5">
          <div class="min-w-0 flex-auto">
            ${this.heading()}
            <div
              data-past-xp-total
              class="mt-0.5 text-2xl font-black leading-tight tabular-nums text-yellow-300 [text-shadow:0_0_10px_rgba(250,204,21,0.35)]"
            >
              ${translateText("progression.xp_total", {
                xp: formatXp(data.breakdown.total),
              })}
            </div>
          </div>
          ${this.renderLevel(data)}
        </div>
        ${lines.length > 0
          ? html`<div
              data-past-xp-lines
              class="mt-3 grid grid-cols-1 gap-x-7 gap-y-1 border-t border-white/[0.08] pt-2.5 sm:grid-cols-3"
            >
              ${lines.map(
                (line) =>
                  html`<div
                    data-past-xp-line=${line.key}
                    class="flex justify-between gap-3 text-[13px] leading-relaxed"
                  >
                    <span class="min-w-0 text-white/70"
                      >${translateText(XP_LINE_LABEL_KEYS[line.key])}</span
                    >
                    <span class="font-bold tabular-nums text-yellow-300"
                      >${this.signed(line.amount)}</span
                    >
                  </div>`,
              )}
            </div>`
          : nothing}
        ${this.renderMultipliers(data)}
        ${data.breakdown.leftEarly
          ? html`<p
              data-past-xp-left-early
              class="m-0 mt-2 text-xs text-amber-300"
            >
              ${translateText("progression.left_early")}
            </p>`
          : nothing}
      `,
      "result",
    );
  }

  render() {
    const s = this.view;
    switch (s.kind) {
      case "hidden":
        return nothing;
      case "calculating":
        return this.renderCalculating();
      case "result":
        if (s.data.eligible) return this.renderResult(s.data);
        if (s.data.reason === BEFORE_PROGRESSION) {
          return this.renderNote(
            this.circledIcon("dash"),
            translateText(ineligibleReasonKey(s.data.reason)),
            "before_levels",
            "text-white/55",
          );
        }
        return this.renderNote(
          this.circledIcon("info"),
          translateText(ineligibleReasonKey(s.data.reason, this.gameType)),
          "ineligible",
          "text-white/70",
        );
    }
  }
}
