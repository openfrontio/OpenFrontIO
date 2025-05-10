import { Colord, colord } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { ColoredTeams, PlayerType, Team, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import {
  blue,
  botColor,
  botColors,
  green,
  humanColors,
  orange,
  purple,
  red,
  teal,
  territoryColors,
  yellow,
} from "./Colors";
import { Theme } from "./Config";

export const pastelThemeDark = new (class implements Theme {
  private rand = new PseudoRandom(123);

  private background = colord({ r: 0, g: 0, b: 0 });
  private falloutColors = [
    colord({ r: 120, g: 255, b: 71 }), // Original color
    colord({ r: 130, g: 255, b: 85 }), // Slightly lighter
    colord({ r: 110, g: 245, b: 65 }), // Slightly darker
    colord({ r: 125, g: 255, b: 75 }), // Warmer tint
    colord({ r: 115, g: 250, b: 68 }), // Cooler tint
  ];
  private water = colord({ r: 14, g: 11, b: 30 });
  private shorelineWater = colord({ r: 50, g: 50, b: 50 });

  private _selfColor = colord({ r: 0, g: 255, b: 0 });
  private _allyColor = colord({ r: 255, g: 255, b: 0 });
  private _enemyColor = colord({ r: 255, g: 0, b: 0 });

  private _spawnHighlightColor = colord({ r: 255, g: 213, b: 79 });

  teamColor(team: Team): Colord {
    switch (team) {
      case ColoredTeams.Blue:
        return blue;
      case ColoredTeams.Red:
        return red;
      case ColoredTeams.Teal:
        return teal;
      case ColoredTeams.Purple:
        return purple;
      case ColoredTeams.Yellow:
        return yellow;
      case ColoredTeams.Orange:
        return orange;
      case ColoredTeams.Green:
        return green;
      case ColoredTeams.Bot:
        return botColor;
      default:
        return humanColors[simpleHash(team) % humanColors.length];
    }
  }

  territoryColor(player: PlayerView): Colord {
    if (player.team() !== null) {
      return this.teamColor(player.team());
    }
    if (player.info().playerType == PlayerType.Human) {
      return humanColors[simpleHash(player.id()) % humanColors.length];
    }
    if (player.info().playerType == PlayerType.Bot) {
      return botColors[simpleHash(player.id()) % botColors.length];
    }
    return territoryColors[simpleHash(player.id()) % territoryColors.length];
  }

  textColor(player: PlayerView): string {
    return player.info().playerType == PlayerType.Human ? "#ffffff" : "#e6e6e6";
  }

  specialBuildingColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;
    return colord({
      r: Math.max(tc.r - 50, 0),
      g: Math.max(tc.g - 50, 0),
      b: Math.max(tc.b - 50, 0),
    });
  }

  borderColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;
    return colord({
      r: Math.max(tc.r - 40, 0),
      g: Math.max(tc.g - 40, 0),
      b: Math.max(tc.b - 40, 0),
    });
  }

  defendedBorderColors(player: PlayerView): { light: Colord; dark: Colord } {
    return {
      light: this.territoryColor(player).darken(0.2),
      dark: this.territoryColor(player).darken(0.4),
    };
  }

  focusedBorderColor(): Colord {
    return colord({ r: 255, g: 255, b: 255 });
  }

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const type = gm.terrainType(tile);
    const mag = gm.magnitude(tile); // Magnitude for water is distance/2

    switch (type) {
      case TerrainType.Ocean:
      case TerrainType.Lake:
        if (gm.isShoreline(tile) && gm.isWater(tile)) {
          return this.shorelineWater;
        }
        const baseWater = this.water.rgba;
        const adjustment = 9 - Math.min(mag, 10); // Water magnitude influence
        return colord({
          r: Math.max(baseWater.r + adjustment, 0),
          g: Math.max(baseWater.g + adjustment, 0),
          b: Math.max(baseWater.b + adjustment, 0),
        });
      case TerrainType.Plains:
        return colord("#64823c"); // Darker #7cb25c
      case TerrainType.Forest:
        return colord("#3d551e"); // Darker #61853e
      case TerrainType.Desert:
        return colord("#b8a971"); // Darker #e8db91
      case TerrainType.DesertTransition:
        return colord("#b58a35"); // Darker #e5ba45
      case TerrainType.ArcticForest:
        return colord("#78a0b0"); // Darker #98c0e0
      case TerrainType.Beach:
        return colord("#b09859"); // Darker #e0c879
      case TerrainType.MidMountain:
        return colord("#3c413e"); // Darker #5c615e
      case TerrainType.HighMountain:
        return colord("#23282a"); // Darker #43484a
      case TerrainType.Jungle:
        return colord("#12451d"); // Darker #22752d
      case TerrainType.JunglePlains:
        return colord("#27733d"); // Darker #47a35d
      case TerrainType.ArcticPlains:
        return colord("#8dafcd"); // Darker #adcfed
      case TerrainType.SnowyHighMountain:
        return colord("#c7d5df"); // Darker #e7f5ff (more gray)
      default:
        return this.background; // Fallback
    }
  }

  backgroundColor(): Colord {
    return this.background;
  }

  falloutColor(): Colord {
    return this.rand.randElement(this.falloutColors);
  }

  font(): string {
    return "Overpass, sans-serif";
  }

  selfColor(): Colord {
    return this._selfColor;
  }
  allyColor(): Colord {
    return this._allyColor;
  }
  enemyColor(): Colord {
    return this._enemyColor;
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
})();
