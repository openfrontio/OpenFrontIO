import type { GameXpPanelState } from "./components/GameXpPanel";
import {
  isMilestoneLevel,
  levelsReachedInGame,
  MAX_LEVEL,
  MAX_PRESTIGE,
  reachedLegendThisGame,
} from "./Progression";
import { playerProfileUrl } from "./utilities/PlayerProfileUrl";
import { translateText } from "./Utils";

// A progression moment worth sharing: a milestone level, becoming a Legend,
// or a new prestige rank. Shared as the player's profile link with the moment
// named in `?moment=`, so the link unfurls into a card for it.
export type ShareMoment =
  | { kind: "level"; level: number }
  | { kind: "legend" }
  | { kind: "prestige"; rank: number };

/**
 * The moment a finished game is worth sharing for, or null. Only the server's
 * result counts (never a provisional figure), and only a milestone level or
 * becoming a Legend: an ordinary level-up isn't shared. A Legend beats any
 * level, and of several milestones reached in one game the highest is shared.
 */
export function gameShareMoment(view: GameXpPanelState): ShareMoment | null {
  if (view.kind !== "result" || !view.data.eligible) return null;
  const data = view.data;
  if (reachedLegendThisGame(data)) return { kind: "legend" };
  const milestones = levelsReachedInGame(data)
    .map((l) => l.level)
    .filter(isMilestoneLevel);
  if (milestones.length === 0) return null;
  return { kind: "level", level: Math.max(...milestones) };
}

// The moments the site's card route draws: a level from 2 (the first one
// reached) to the last, and a prestige rank from 1 to the last. It answers
// anything else with a 400, which unfurls as no image at all.
function inRange(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * The `?moment=` value: `level50`, `legend`, `prestige3`. Null for a level or
 * rank the card route wouldn't draw (a surprising server value), so the
 * share is dropped rather than sending a link that unfurls without a card.
 */
export function momentSlug(moment: ShareMoment): string | null {
  switch (moment.kind) {
    case "level":
      return inRange(moment.level, 2, MAX_LEVEL)
        ? `level${moment.level}`
        : null;
    case "legend":
      return "legend";
    case "prestige":
      return inRange(moment.rank, 1, MAX_PRESTIGE)
        ? `prestige${moment.rank}`
        : null;
  }
}

/**
 * The player's profile link with the moment: `/player/<id>?moment=level50`.
 * Null when the moment has no slug (see momentSlug): nothing to share.
 */
export function momentShareUrl(
  publicId: string,
  moment: ShareMoment,
): string | null {
  const slug = momentSlug(moment);
  return slug === null ? null : `${playerProfileUrl(publicId)}?moment=${slug}`;
}

/** The line that goes with the link ("I just reached Level 50 on OpenFront!"). */
export function momentShareText(moment: ShareMoment): string {
  switch (moment.kind) {
    case "level":
      return translateText("progression.share_text_level", {
        level: moment.level,
      });
    case "legend":
      return translateText("progression.share_text_legend");
    case "prestige":
      return translateText("prestige.share_text", { rank: moment.rank });
  }
}

/** The share button's label for a game's moment ("Share Level 50"). */
export function momentShareLabel(
  moment: Exclude<ShareMoment, { kind: "prestige" }>,
): string {
  return moment.kind === "legend"
    ? translateText("progression.share_moment_legend")
    : translateText("progression.share_moment_level", {
        level: moment.level,
      });
}
