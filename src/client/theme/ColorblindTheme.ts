import { Colord } from "colord";
import { ColoredTeams, Team } from "../../core/game/Game";
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
  protected humanPalette(): Colord[] {
    return colorblindColors;
  }
  protected botPalette(): Colord[] {
    return colorblindColors;
  }
  protected nationPalette(): Colord[] {
    return colorblindColors;
  }

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
}
