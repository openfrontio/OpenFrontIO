import { html, nothing, type TemplateResult } from "lit";
import "./LevelBadge";

/**
 * A row's level fields as the API sends them on leaderboard and clan member
 * rows: all three present for a player with progress, all absent otherwise
 * (no progress yet, or progression switched off). The schema drops a
 * malformed field on its own, so a row can also arrive with only some.
 */
export interface LevelFields {
  level?: number;
  prestige?: number;
  legend?: boolean;
}

/**
 * The row's badge, or undefined unless all three fields are present: with
 * one dropped as malformed the row shows no badge rather than a guessed one.
 */
function rowBadge(row: LevelFields): Required<LevelFields> | undefined {
  const { level, prestige, legend } = row;
  if (level === undefined || prestige === undefined || legend === undefined) {
    return undefined;
  }
  return { level, prestige, legend };
}

/** True when the row carries a level to draw. */
export function hasLevel(row: LevelFields): boolean {
  return rowBadge(row) !== undefined;
}

/**
 * True when the row has prestiged at least once or is a Legend. The ranked
 * leaderboard badges only these players, so that the badge stays rare enough
 * there to mean something and the board doesn't get cluttered; clan member
 * lists and the lobby roster badge anyone with a level.
 */
export function isPrestigedOrLegend(row: LevelFields): boolean {
  const badge = rowBadge(row);
  return badge !== undefined && (badge.legend || badge.prestige > 0);
}

/**
 * The level badge in front of a name in a list, or — when `show` is false —
 * an empty slot of the same width so names stay lined up with the rows that
 * do have one. With `reserveSlot` false (no row in the list has a badge),
 * renders nothing at all, so lists look unchanged until levels appear.
 * Badges are `stagger`ed: a page of them arriving at once is drawn over a
 * few frames (see LevelBadgeFill).
 */
export function levelBadgeSlot(
  row: LevelFields,
  show: boolean,
  reserveSlot: boolean,
  size = 24,
): TemplateResult | typeof nothing {
  const badge = show ? rowBadge(row) : undefined;
  if (badge !== undefined) {
    return html`<level-badge
      stagger
      class="shrink-0"
      .level=${badge.level}
      .prestige=${badge.prestige}
      ?legend=${badge.legend}
      size=${size}
    ></level-badge>`;
  }
  if (!reserveSlot) return nothing;
  return html`<span
    class="shrink-0"
    style="width:${size}px;height:${size}px"
    aria-hidden="true"
    data-level-slot
  ></span>`;
}
