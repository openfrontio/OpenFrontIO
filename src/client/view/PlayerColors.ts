/**
 * A player's territory and border colours. PlayerView uses this for live
 * players and the replay viewer (ReplayPalette) for a replay's, so both
 * draw a player the same way.
 */

import { type Colord, colord } from "colord";
import type { Team } from "../../core/game/Game";
import type { PlayerCosmetics } from "../../core/Schemas";
import type { Theme } from "../theme/ThemeProvider";

/**
 * The theme's colours unless a colour or pattern cosmetic overrides them.
 * In team games the territory keeps the team colour. `themed` is the
 * theme's territory colour for the player (Theme.territoryColor), and
 * `focused` whether they're the local player, whose border stands out.
 */
export function resolvePlayerColors(
  theme: Pick<Theme, "borderColor" | "focusedBorderColor">,
  themed: Colord,
  cosmetics: PlayerCosmetics,
  team: Team | null,
  focused: boolean,
): { territory: Colord; border: Colord } {
  const themedBorder = theme.borderColor(themed);
  // A pattern without a palette of its own is drawn in the theme's colours.
  const palette = cosmetics.pattern
    ? (cosmetics.pattern.colorPalette ?? {
        primaryColor: themed.toHex(),
        secondaryColor: themedBorder.toHex(),
      })
    : undefined;
  const territory =
    team === null
      ? colord(
          cosmetics.color?.color ?? palette?.primaryColor ?? themed.toHex(),
        )
      : themed;
  const border = colord(
    palette?.secondaryColor ??
      cosmetics.color?.color ??
      (focused ? theme.focusedBorderColor() : themedBorder).toHex(),
  );
  return { territory, border };
}
