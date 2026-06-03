import { Colord, colord } from "colord";
import { ColoredTeams, Team, TerrainType } from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import {
  botTeamColors,
  cbBlueTeamColors,
  cbGreenTeamColors,
  cbOrangeTeamColors,
  cbPurpleTeamColors,
  cbRedTeamColors,
  cbTealTeamColors,
  cbYellowTeamColors,
  colorblindColors,
} from "./Colors";
import { PastelTheme } from "./PastelTheme";

/**
 * Colorblind theme — keeps the light terrain but swaps player and team palettes
 * for a high-contrast, lightness-varied, colorblind-safe set. Shares all the
 * allocation logic from BaseTheme via PastelTheme.
 */
export class ColorblindTheme extends PastelTheme {
  /** All player pools share the single CVD-safe, lightness-varied palette. */
  protected humanPalette(): Colord[] {
    return colorblindColors;
  }
  protected botPalette(): Colord[] {
    return colorblindColors;
  }
  protected nationPalette(): Colord[] {
    return colorblindColors;
  }

  /** Colorblind-safe per-team variations (blue/orange-anchored Okabe-Ito). */
  protected teamColorVariations(team: Team): Colord[] {
    switch (team) {
      case ColoredTeams.Blue:
        return cbBlueTeamColors;
      case ColoredTeams.Red:
        return cbRedTeamColors;
      case ColoredTeams.Teal:
        return cbTealTeamColors;
      case ColoredTeams.Purple:
        return cbPurpleTeamColors;
      case ColoredTeams.Yellow:
        return cbYellowTeamColors;
      case ColoredTeams.Orange:
        return cbOrangeTeamColors;
      case ColoredTeams.Green:
        return cbGreenTeamColors;
      case ColoredTeams.Bot:
        return botTeamColors;
      case ColoredTeams.Humans:
        return cbBlueTeamColors;
      case ColoredTeams.Nations:
        return cbRedTeamColors;
      default:
        return [this.humanColorAllocator.assignColor(team)];
    }
  }

  /**
   * Fill-derived border, darkened *relative* to each fill's own lightness
   * rather than by a fixed amount. An absolute darken (e.g. .darken(0.3))
   * pushes already-dark fills to near-black while barely touching light ones,
   * so borders read inconsistently across nations. Scaling lightness keeps
   * every border the same proportion darker than its territory — distinct, but
   * still hued and never collapsing to black. Friend/foe tints are mixed on top
   * in the border shader.
   */
  borderColor(territoryColor: Colord): Colord {
    const hsl = territoryColor.toHsl();
    return colord({ ...hsl, l: hsl.l * 0.6 });
  }

  /**
   * CVD-tuned terrain: separate elevation bands by *lightness* (the cue all
   * colorblindness types keep) rather than the green→brown→gray hue ramp, which
   * blurs plains↔hills under red-green CVD. Dark plains → mid hills → bright
   * mountains. Water/shore are inherited (blue is already CVD-safe).
   */
  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.shore;
    }
    const type = gm.terrainType(tile);
    switch (type) {
      case TerrainType.Ocean:
      case TerrainType.Lake: {
        const w = this.water.rgba;
        if (gm.isShoreline(tile) && gm.isWater(tile)) {
          return this.shorelineWater;
        }
        return colord({
          r: Math.max(w.r - 10 + (11 - Math.min(mag, 10)), 0),
          g: Math.max(w.g - 10 + (11 - Math.min(mag, 10)), 0),
          b: Math.max(w.b - 10 + (11 - Math.min(mag, 10)), 0),
        });
      }
      case TerrainType.Plains: // dark green, low lightness
        return colord({ r: 90, g: 140 - mag, b: 70 });
      case TerrainType.Highland: // mid ochre, clearly lighter than plains
        return colord({ r: 165 + 2 * mag, g: 145 + 2 * mag, b: 105 + mag });
      case TerrainType.Mountain: // near-white, brightest band
        return colord({ r: 225 + mag / 2, g: 225 + mag / 2, b: 228 + mag / 2 });
      default: {
        // Exhaustiveness guard: a new TerrainType is a compile error here.
        const _exhaustive: never = type;
        return _exhaustive;
      }
    }
  }
}
