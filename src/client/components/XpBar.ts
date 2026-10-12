import { html, nothing, TemplateResult } from "lit";
import { multiplierPercent, subscriberTierOf } from "../Progression";
import { translateText } from "../Utils";

// Shared bits of the level / XP UI: number formatting, multiplier lines and
// the progress bar.

export function formatXp(amount: number): string {
  return Math.round(amount).toLocaleString();
}

/**
 * A multiplier as a line of its own, the way Overwatch shows a group bonus:
 * "+100% XP (SOVEREIGN BONUS)", "+20% XP (SUBSCRIBER BONUS)" for a boost from
 * no known tier, or "−50% XP (GAME TYPE)" for a cut.
 */
export function xpBonusText(
  key: "game" | "subscriber",
  permille: number,
): string {
  const percent = multiplierPercent(permille);
  const tier = key === "subscriber" ? subscriberTierOf(permille) : null;
  return translateText(
    percent >= 0 ? "progression.bonus_line" : "progression.penalty_line",
    {
      percent: Math.abs(percent),
      source: translateText(`progression.multiplier_${tier?.tier ?? key}`),
    },
  );
}

/** "1,234 / 5,000 XP", or "Max level" when there is no next level. */
export function xpProgressText(xpInLevel: number, xpForNext: number): string {
  if (!(xpForNext > 0)) return translateText("progression.max_level");
  return translateText("progression.xp_progress", {
    current: formatXp(xpInLevel),
    next: formatXp(xpForNext),
  });
}

/**
 * A thin XP bar. `percent` is clamped to 0..100. `valueText` is what a
 * screen reader announces for the value (typically xpProgressText); without
 * it, the percentage. `transitionMs` animates the fill to a new width (0 or
 * absent: it jumps); `onFillTransitionEnd` hears when that ends.
 */
export function xpBar(
  percent: number,
  opts: {
    heightClass?: string;
    valueText?: string;
    transitionMs?: number;
    fillClass?: string;
    onFillTransitionEnd?: (e: TransitionEvent) => void;
  } = {},
): TemplateResult {
  const ms = opts.transitionMs ?? 0;
  const fill = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : 0;
  return html`<div
    data-xp-bar
    class="w-full overflow-hidden rounded-full bg-white/15 ${opts.heightClass ??
    "h-2"}"
    role="progressbar"
    aria-label=${translateText("progression.xp_bar_label")}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${Math.round(fill)}
    aria-valuetext=${opts.valueText ?? nothing}
  >
    <div
      data-xp-bar-fill
      class="h-full rounded-full bg-malibu-blue ${opts.fillClass ?? ""}"
      style="width: ${fill}%${ms > 0
        ? `; transition: width ${ms}ms cubic-bezier(0.3, 0.7, 0.2, 1)`
        : ""}"
      @transitionend=${opts.onFillTransitionEnd ?? nothing}
    ></div>
  </div>`;
}
