import { html, nothing, TemplateResult } from "lit";
import { translateText } from "../Utils";

// Shared bits of the level / XP UI: number formatting and the progress bar.

export function formatXp(amount: number): string {
  return Math.round(amount).toLocaleString();
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
 * A thin XP bar. `percent` is 0..100. `valueText` is what a screen reader
 * announces for the value (typically xpProgressText); without it, the
 * percentage.
 */
export function xpBar(
  percent: number,
  opts: { heightClass?: string; valueText?: string } = {},
): TemplateResult {
  return html`<div
    data-xp-bar
    class="w-full overflow-hidden rounded-full bg-white/15 ${opts.heightClass ??
    "h-2"}"
    role="progressbar"
    aria-label=${translateText("progression.xp_bar_label")}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${Math.round(percent)}
    aria-valuetext=${opts.valueText ?? nothing}
  >
    <div
      data-xp-bar-fill
      class="h-full rounded-full bg-malibu-blue"
      style="width: ${percent}%"
    ></div>
  </div>`;
}
