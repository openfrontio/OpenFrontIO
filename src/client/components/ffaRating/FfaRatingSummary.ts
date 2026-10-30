import type {
  PublicFfaRating,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { translateText } from "../../Utils";
import { formatRating, formatRatingWithUncertainty } from "./FfaTier";
import "./FfaTierBadge";
import "./OfstatsCredit";

/** The `leaderboard.ffa` entry of `/users/@me`. */
export type MeFfaEntry = NonNullable<
  NonNullable<UserMeResponse["player"]["leaderboard"]>["ffa"]
>;

/** What the profile shows of a player's FFA rating. */
export type FfaRatingSummaryData =
  | {
      kind: "rated";
      rating: number;
      uncertainty: number;
      tier: string;
      peak?: number;
    }
  | { kind: "calibrating"; calibrationGames: number };

/**
 * The signed-in player's rating from `@me`. Rated once the API sends the
 * rating, its uncertainty and its tier; calibrating while it sends only the
 * calibration count; null before the rating is live (`{ elo }` alone).
 */
export function ffaSummaryFromMe(
  ffa: MeFfaEntry | undefined,
): FfaRatingSummaryData | null {
  if (ffa === undefined) return null;
  if (
    ffa.elo !== undefined &&
    ffa.uncertainty !== undefined &&
    ffa.tier !== undefined
  ) {
    return {
      kind: "rated",
      rating: ffa.elo,
      uncertainty: ffa.uncertainty,
      tier: ffa.tier,
      ...(ffa.peak === undefined ? {} : { peak: ffa.peak }),
    };
  }
  if (ffa.calibrationGames !== undefined) {
    return { kind: "calibrating", calibrationGames: ffa.calibrationGames };
  }
  return null;
}

/** Another player's rating from their public profile (null: unrated). */
export function ffaSummaryFromProfile(
  r: PublicFfaRating | null | undefined,
): FfaRatingSummaryData | null {
  if (r === null || r === undefined) return null;
  return {
    kind: "rated",
    rating: r.rating,
    uncertainty: r.uncertainty,
    tier: r.tier,
    peak: r.peak,
  };
}

/**
 * A player's FFA rating on their profile: the tier badge (or the calibration
 * count), the rating with its uncertainty, the peak, and the OFstats credit.
 * Nothing at all without a rating.
 */
@customElement("ffa-rating-summary")
export class FfaRatingSummary extends LitElement {
  @property({ attribute: false }) rating: FfaRatingSummaryData | null = null;

  createRenderRoot() {
    return this;
  }

  render() {
    const rating = this.rating;
    if (rating === null) return nothing;
    return html`<div
      data-ffa-rating-summary=${rating.kind}
      class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-white sm:justify-start"
    >
      <span class="text-xs font-bold uppercase tracking-wide text-white/70"
        >${translateText("ffa_rating.title")}</span
      >
      ${
        rating.kind === "rated"
          ? html`<ffa-tier-badge
                size="md"
                .tier=${rating.tier}
              ></ffa-tier-badge>
              <span
                data-ffa-rating-value
                class="text-lg font-bold tabular-nums text-white"
                >${formatRatingWithUncertainty(
                  rating.rating,
                  rating.uncertainty,
                )}</span
              >
              ${
                rating.peak === undefined
                  ? nothing
                  : html`<span
                      data-ffa-rating-peak
                      class="text-xs tabular-nums text-white/60"
                      >${translateText("ffa_rating.peak", {
                        rating: formatRating(rating.peak),
                      })}</span
                    >`
              }`
          : html`<ffa-tier-badge
              size="md"
              .calibrationGames=${rating.calibrationGames}
            ></ffa-tier-badge>`
      }
      <ofstats-credit></ofstats-credit>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "ffa-rating-summary": FfaRatingSummary;
  }
}
