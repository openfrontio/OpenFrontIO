import { html, TemplateResult } from "lit";
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
 * A thin XP bar. `percent` is 0..100. `durationMs` overrides the fill's
 * transition length when animating (the post-game reveal times each segment).
 */
export function xpBar(
  percent: number,
  opts: { animate?: boolean; heightClass?: string; durationMs?: number } = {},
): TemplateResult {
  return html`<div
    data-xp-bar
    class="w-full overflow-hidden rounded-full bg-white/15 ${opts.heightClass ??
    "h-2"}"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow=${Math.round(percent)}
  >
    <div
      data-xp-bar-fill
      class="h-full rounded-full bg-malibu-blue ${opts.animate
        ? "transition-[width] duration-700 ease-out"
        : ""}"
      style="width: ${percent}%${opts.animate && opts.durationMs !== undefined
        ? `; transition-duration: ${opts.durationMs}ms`
        : ""}"
    ></div>
  </div>`;
}
