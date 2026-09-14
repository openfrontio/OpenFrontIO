import { html, TemplateResult } from "lit";
import medalIconRaw from "../../../../resources/images/MedalIconWhite.svg?raw";
import { Difficulty } from "../../../core/game/Game";
import { translateText } from "../../Utils";

// CSS mask that renders the medal glyph; tint it via `background-color`.
export const MEDAL_MASK = `url('data:image/svg+xml;utf8,${encodeURIComponent(medalIconRaw)}') no-repeat center / contain`;

// Difficulty medals, easiest to hardest — the canonical display order.
export const MEDAL_ORDER: readonly Difficulty[] = [
  Difficulty.Easy,
  Difficulty.Medium,
  Difficulty.Hard,
  Difficulty.Impossible,
];

export const MEDAL_COLORS: Record<Difficulty, string> = {
  [Difficulty.Easy]: "var(--medal-easy)",
  [Difficulty.Medium]: "var(--medal-medium)",
  [Difficulty.Hard]: "var(--medal-hard)",
  [Difficulty.Impossible]: "var(--medal-impossible)",
};

/**
 * A single colored medal glyph. Pass `earned=false` to dim it so it reads as
 * "not yet won" (used on map cards); the overview keeps them full-color.
 */
export function medalIcon(
  difficulty: Difficulty,
  sizeClass = "w-5 h-5",
  earned = true,
): TemplateResult {
  return html`<div
    class="${sizeClass} ${earned ? "opacity-100" : "opacity-25"}"
    style="background-color:${MEDAL_COLORS[
      difficulty
    ]}; mask:${MEDAL_MASK}; -webkit-mask:${MEDAL_MASK};"
    title=${translateText(`difficulty.${difficulty.toLowerCase()}`)}
  ></div>`;
}
