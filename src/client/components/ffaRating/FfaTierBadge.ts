import { assetUrl } from "@openfront/shared/AssetUrls";
import { LitElement, TemplateResult, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import {
  FFA_CALIBRATION_GAMES,
  ParsedFfaTier,
  ffaTierLabel,
  parseFfaTier,
} from "./FfaTier";

export type FfaBadgeSize = "sm" | "md" | "lg";

// Full literal class strings: Tailwind only generates classes it sees in source.
export const FFA_BADGE_SIZE_CLASSES: Record<FfaBadgeSize, string> = {
  sm: "text-[10px] px-1.5 py-0.5",
  md: "text-xs px-2 py-0.5",
  lg: "text-sm px-3 py-1",
};

// OFstats's emblem kit: the flat compact emblem (one per family) at 24 px and
// below, with the tier written beside it; the shaded detailed one (one per
// tier, division on its plate) at 32 px and up.
export const FFA_BADGE_IMAGE_PX: Record<FfaBadgeSize, number> = {
  sm: 20,
  md: 24,
  lg: 48,
};

const LABEL_CLASSES: Record<"sm" | "md", string> = {
  sm: "text-xs",
  md: "text-sm",
};

/** The emblem's path under resources/, e.g. "images/ffa-tiers/compact/gold.svg". */
export function ffaTierImagePath(
  tier: ParsedFfaTier,
  size: FfaBadgeSize,
): string {
  if (size !== "lg") return `images/ffa-tiers/compact/${tier.base}.svg`;
  const file =
    tier.division === null
      ? tier.base
      : `${tier.base}-${tier.division.toLowerCase()}`;
  return `images/ffa-tiers/detailed/${file}.svg`;
}

/**
 * A player's FFA rating tier, drawn with OFstats's emblem, or a
 * "Calibrating N/10" pill while they have no tier yet. The tier is always the
 * API's string, never computed here.
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
            class="rounded-full font-bold tracking-wide whitespace-nowrap bg-white/10 text-white/70 ${
              FFA_BADGE_SIZE_CLASSES[this.size]
            }"
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
    const size = this.size;
    const px = FFA_BADGE_IMAGE_PX[size];
    const src = assetUrl(ffaTierImagePath(tier, size));
    if (size === "lg") {
      return html`<img
        data-ffa-tier-img
        src=${src}
        alt=${label}
        width=${px}
        height=${px}
        decoding="async"
        draggable="false"
        class="block shrink-0"
      />`;
    }
    // The label beside it says the tier, so the emblem itself is decorative.
    // sm sits in narrow leaderboard rows: on a phone it shows only the
    // division (OFstats's compact rule) and keeps the label for screen readers.
    const phone = size === "sm";
    return html`<span class="inline-flex items-center gap-1.5 whitespace-nowrap"
      ><img
        data-ffa-tier-img
        src=${src}
        alt=""
        width=${px}
        height=${px}
        decoding="async"
        draggable="false"
        class="block shrink-0"
      /><span
        data-ffa-tier-label
        class="${
          phone ? "sr-only sm:not-sr-only" : ""
        } font-bold uppercase tracking-wide text-white ${LABEL_CLASSES[size]}"
        >${label}</span
      >${
        phone && tier.division !== null
          ? html`<span
              data-ffa-division
              aria-hidden="true"
              class="sm:hidden font-bold text-white ${LABEL_CLASSES[size]}"
              >${tier.division}</span
            >`
          : nothing
      }</span
    >`;
  }

  protected renderCalibrating(n: number): TemplateResult {
    return html`<span
      class="rounded-full border border-dashed border-white/40 text-white/70 font-bold tracking-wide whitespace-nowrap ${
        FFA_BADGE_SIZE_CLASSES[this.size]
      }"
      >${translateText("ffa_rating.calibrating", { n })}</span
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ffa-tier-badge": FfaTierBadge;
  }
}
