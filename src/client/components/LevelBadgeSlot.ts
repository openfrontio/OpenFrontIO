import { html, nothing, type TemplateResult } from "lit";
import "./LevelBadge";

/**
 * A row's level fields as the API sends them on leaderboard and clan member
 * rows: all three present for a player with progress, all absent otherwise
 * (no progress yet, or progression switched off).
 */
export interface LevelFields {
  level?: number;
  prestige?: number;
  legend?: boolean;
}

/** True when the row carries a level to draw. */
export function hasLevel(row: LevelFields): boolean {
  return row.level !== undefined;
}

/** True when the row has prestiged at least once or is a Legend. */
export function isPrestigedOrLegend(row: LevelFields): boolean {
  return hasLevel(row) && (row.legend === true || (row.prestige ?? 0) > 0);
}

/**
 * The level badge in front of a name in a list, or — when `show` is false —
 * an empty slot of the same width so names stay lined up with the rows that
 * do have one. With `reserveSlot` false (no row in the list has a badge),
 * renders nothing at all, so lists look unchanged until levels appear.
 */
export function levelBadgeSlot(
  row: LevelFields,
  show: boolean,
  reserveSlot: boolean,
  size = 24,
): TemplateResult | typeof nothing {
  if (show && row.level !== undefined) {
    return html`<level-badge
      class="shrink-0"
      .level=${row.level}
      .prestige=${row.prestige ?? 0}
      ?legend=${row.legend ?? false}
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
