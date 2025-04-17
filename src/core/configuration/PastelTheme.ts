import { Colord, colord } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { PlayerType, Team, TerrainType } from "../game/Game";
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

export const pastelTheme = new (class implements Theme {
  private rand = new PseudoRandom(123);

  private background = colord({ r: 60, g: 60, b: 60 });
  private land = colord({ r: 194, g: 193, b: 148 });
  private shore = colord({ r: 204, g: 203, b: 158 });
  private falloutColors = [
    colord({ r: 120, g: 255, b: 71 }), // Original color
    colord({ r: 130, g: 255, b: 85 }), // Slightly lighter
    colord({ r: 110, g: 245, b: 65 }), // Slightly darker
    colord({ r: 125, g: 255, b: 75 }), // Warmer tint
    colord({ r: 115, g: 250, b: 68 }), // Cooler tint
  ];
  private water = colord({ r: 70, g: 132, b: 180 });
  private shorelineWater = colord({ r: 100, g: 143, b: 255 });

  private _selfColor = colord({ r: 0, g: 255, b: 0 });
  private _allyColor = colord({ r: 255, g: 255, b: 0 });
  private _enemyColor = colord({ r: 255, g: 0, b: 0 });

  private _spawnHighlightColor = colord({ r: 255, g: 213, b: 79 });

  teamColor(team: Team): Colord {
    switch (team) {
      case Team.Blue:
        return blue;
      case Team.Red:
        return red;
      case Team.Teal:
        return teal;
      case Team.Purple:
        return purple;
      case Team.Yellow:
        return yellow;
      case Team.Orange:
        return orange;
      case Team.Green:
        return green;
      case Team.Bot:
        return botColor;
    }
    throw new Error(`Missing color for ${team}`);
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
    return player.info().playerType == PlayerType.Human ? "#000000" : "#4D4D4D";
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
  defendedBorderColor(player: PlayerView): Colord {
    const bc = this.borderColor(player).rgba;
    return colord({
      r: Math.max(bc.r - 40, 0),
      g: Math.max(bc.g - 40, 0),
      b: Math.max(bc.b - 40, 0),
    });
  }

  focusedBorderColor(): Colord {
    return colord({ r: 230, g: 230, b: 230 });
  }
  focusedDefendedBorderColor(): Colord {
    return colord({ r: 200, g: 200, b: 200 });
  }

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.shore;
    }
    switch (gm.terrainType(tile)) {
      case TerrainType.Ocean:
      case TerrainType.Lake:
        const w = this.water.rgba;
        if (gm.isShoreline(tile) && gm.isWater(tile)) {
          return this.shorelineWater;
        }
        return colord({
          r: Math.max(w.r - 10 + (11 - Math.min(mag, 10)), 0),
          g: Math.max(w.g - 10 + (11 - Math.min(mag, 10)), 0),
          b: Math.max(w.b - 10 + (11 - Math.min(mag, 10)), 0),
        });

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
