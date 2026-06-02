import { Colord, colord } from "colord";
import { ColoredTeams, Team, TerrainType } from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import { BaseTheme } from "./BaseTheme";
import {
  blueTeamColors,
  botColors,
  botTeamColors,
  fallbackColors,
  greenTeamColors,
  humanColors,
  nationColors,
  orangeTeamColors,
  purpleTeamColors,
  redTeamColors,
  tealTeamColors,
  yellowTeamColors,
} from "./Colors";

export class PastelTheme extends BaseTheme {
  protected shore = colord("rgb(204,203,158)");
  protected water = colord("rgb(70,132,180)");
  protected shorelineWater = colord("rgb(100,143,255)");

  protected humanPalette(): Colord[] {
    return humanColors;
  }
  protected botPalette(): Colord[] {
    return botColors;
  }
  protected nationPalette(): Colord[] {
    return nationColors;
  }
  protected fallbackPalette(): Colord[] {
    return fallbackColors;
  }

  protected teamColorVariations(team: Team): Colord[] {
    switch (team) {
      case ColoredTeams.Blue:
        return blueTeamColors;
      case ColoredTeams.Red:
        return redTeamColors;
      case ColoredTeams.Teal:
        return tealTeamColors;
      case ColoredTeams.Purple:
        return purpleTeamColors;
      case ColoredTeams.Yellow:
        return yellowTeamColors;
      case ColoredTeams.Orange:
        return orangeTeamColors;
      case ColoredTeams.Green:
        return greenTeamColors;
      case ColoredTeams.Bot:
        return botTeamColors;
      case ColoredTeams.Humans:
        return blueTeamColors;
      case ColoredTeams.Nations:
        return redTeamColors;
      default:
        return [this.humanColorAllocator.assignColor(team)];
    }
  }

  // | Terrain Type      | Magnitude | Base Color Logic                                | Visual Description                                                   |
  // | :---------------- | :-------- | :---------------------------------------------- | :------------------------------------------------------------------- |
  // | **Shore (Land)**  | N/A       | Fixed: `rgb(204, 203, 158)`                   | Sandy beige. Overrides other land types if adjacent to water.        |
  // | **Plains**        | 0 - 9     | `rgb(190, 220, 138)` - `rgb(190, 202, 138)` | Light green. Gets slightly darker/less green as magnitude increases. |
  // | **Highland**      | 10 - 19   | `rgb(220, 203, 158)` - `rgb(238, 221, 176)` | Tan/Beige. Gets lighter as magnitude increases.                      |
  // | **Mountain**      | 20 - 30   | `rgb(240, 240, 240)` - `rgb(245, 245, 245)` | Grayscale (White/Grey). Represents snow caps or rocky peaks.         |
  // | **Water (Shore)** | 0         | Fixed: `rgb(100, 143, 255)`                   | Light blue near land.                                                |
  // | **Water (Deep)**  | 1 - 10+   | `rgb(70, 132, 180)` - `rgb(61, 123, 171)`   | Darker blue, adjusted slightly by distance to land.                  |
  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.shore;
    }
    switch (gm.terrainType(tile)) {
      case TerrainType.Ocean: {
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
      case TerrainType.Plains:
        return colord({
          r: 190,
          g: 220 - 2 * mag,
          b: 138,
        });
      case TerrainType.Highland:
        return colord({
          r: 200 + 2 * mag,
          g: 183 + 2 * mag,
          b: 138 + 2 * mag,
        });
      case TerrainType.Mountain:
        return colord({
          r: 230 + mag / 2,
          g: 230 + mag / 2,
          b: 230 + mag / 2,
        });
    }
  }
}
