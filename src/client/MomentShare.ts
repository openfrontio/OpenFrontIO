import type { GameXpPanelState } from "./components/GameXpPanel";
import {
  isMilestoneLevel,
  levelsReachedInGame,
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

/** The `?moment=` value: `level50`, `legend`, `prestige3`. */
export function momentSlug(moment: ShareMoment): string {
  switch (moment.kind) {
    case "level":
      return `level${moment.level}`;
    case "legend":
      return "legend";
    case "prestige":
      return `prestige${moment.rank}`;
  }
}

/** The player's profile link with the moment: `/player/<id>?moment=level50`. */
export function momentShareUrl(publicId: string, moment: ShareMoment): string {
  return `${playerProfileUrl(publicId)}?moment=${momentSlug(moment)}`;
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
