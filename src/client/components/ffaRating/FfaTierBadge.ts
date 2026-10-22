import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import {
  FFA_CALIBRATION_GAMES,
  FfaTierBase,
  ParsedFfaTier,
  ffaTierLabel,
  parseFfaTier,
} from "./FfaTier";

export type FfaBadgeSize = "sm" | "md" | "lg";

// Full literal class strings: Tailwind only generates classes it sees in source.
export const FFA_TIER_COLOR_CLASSES: Record<FfaTierBase, string> = {
  iron: "bg-stone-600 text-white",
  bronze: "bg-amber-800 text-white",
  silver: "bg-slate-400 text-slate-950",
  gold: "bg-yellow-500 text-yellow-950",
  platinum: "bg-teal-400 text-teal-950",
  diamond: "bg-sky-400 text-sky-950",
  master: "bg-purple-600 text-white",
  grandmaster: "bg-red-600 text-white",
};

export const FFA_BADGE_SIZE_CLASSES: Record<FfaBadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
  lg: "text-sm px-3 py-1",
};

/**
 * A player's FFA rating tier, or a "Calibrating N/10" pill while they have no
 * tier yet. The tier is always the API's string, never computed here.
 *
 * Placeholder look: a flat pill. Only renderTier (and renderCalibrating) draw
 * the badge, so the final art can replace them without touching the rest.
 */
@customElement("ffa-tier-badge")
export class FfaTierBadge extends LitElement {
  @property({ type: String }) tier?: string;
  @property({ type: String }) size: FfaBadgeSize = "sm";
  @property({ type: Number }) calibrationGames?: number;

  createRenderRoot() {
    return this;
  }

  render() {
    if (this.tier) {
      const parsed = parseFfaTier(this.tier);
      if (parsed === null) {
        return html`<span
          data-ffa-tier="unknown"
          title=${this.tier}
          class="inline-flex align-middle"
          ><span
            class="rounded-full font-bold tracking-wide whitespace-nowrap bg-white/10 text-white/70 ${FFA_BADGE_SIZE_CLASSES[
              this.size
            ]}"
            >${this.tier}</span
          ></span
        >`;
      }
      const label = ffaTierLabel(parsed);
      return html`<span
        data-ffa-tier=${parsed.base}
        title=${label}
        class="inline-flex align-middle"
        >${this.renderTier(parsed, label)}</span
      >`;
    }
    if (this.calibrationGames !== undefined) {
      const n = Math.min(
        FFA_CALIBRATION_GAMES,
        Math.max(0, Math.round(this.calibrationGames)),
      );
      const text = translateText("ffa_rating.calibrating", { n });
      return html`<span
        data-ffa-calibrating
        title=${text}
        class="inline-flex align-middle"
        >${this.renderCalibrating(n)}</span
      >`;
    }
    return nothing;
  }

  protected renderTier(tier: ParsedFfaTier, label: string): TemplateResult {
    return html`<span
      class="rounded-full font-bold uppercase tracking-wide whitespace-nowrap ${FFA_TIER_COLOR_CLASSES[
        tier.base
      ]} ${FFA_BADGE_SIZE_CLASSES[this.size]}"
      >${label}</span
    >`;
  }

  protected renderCalibrating(n: number): TemplateResult {
    return html`<span
      class="rounded-full border border-dashed border-white/40 text-white/70 font-bold tracking-wide whitespace-nowrap ${FFA_BADGE_SIZE_CLASSES[
        this.size
      ]}"
      >${translateText("ffa_rating.calibrating", { n })}</span
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ffa-tier-badge": FfaTierBadge;
  }
}
