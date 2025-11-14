import { Colord, colord } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { PlayerType, Team, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { ColorAllocator } from "./ColorAllocator";
import { botColors, fallbackColors, humanColors, nationColors } from "./Colors";
import { Theme } from "./Config";

type ColorCache = Map<string, Colord>;

export class PastelTheme implements Theme {
  private borderColorCache: ColorCache = new Map<string, Colord>();
  private rand = new PseudoRandom(123);
  private humanColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private botColorAllocator = new ColorAllocator(botColors, botColors);
  private teamColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private nationColorAllocator = new ColorAllocator(nationColors, nationColors);

  private background = colord("rgb(60,60,60)");
  private shore = colord("rgb(204,203,158)");
  private falloutColors = [
    colord("rgb(120,255,71)"), // Original color
    colord("rgb(130,255,85)"), // Slightly lighter
    colord("rgb(110,245,65)"), // Slightly darker
    colord("rgb(125,255,75)"), // Warmer tint
    colord("rgb(115,250,68)"), // Cooler tint
  ];
  private water = colord("rgb(70,132,180)");
  private shorelineWater = colord("rgb(100,143,255)");

  /** Alternate View colors for self, green */
  private _selfColor = colord("rgb(0,255,0)");
  /** Alternate View colors for allies, yellow */
  private _allyColor = colord("rgb(255,255,0)");
  /** Alternate View colors for neutral, gray */
  private _neutralColor = colord("rgb(128,128,128)");
  /** Alternate View colors for enemies, red */
  private _enemyColor = colord("rgb(255,0,0)");

  /** Default spawn highlight colors for other players in FFA, yellow */
  private _spawnHighlightColor = colord("rgb(255,213,79)");
  /** Added non-default spawn highlight colors for self, full white */
  private _spawnHighlightSelfColor = colord("rgb(255,255,255)");
  /** Added non-default spawn highlight colors for teammates, green */
  private _spawnHighlightTeamColor = colord("rgb(0,255,0)");
  /** Added non-default spawn highlight colors for enemies, red */
  private _spawnHighlightEnemyColor = colord("rgb(255,0,0)");

  teamColor(team: Team): Colord {
    return this.teamColorAllocator.assignTeamColor(team);
  }

  territoryColor(player: PlayerView): Colord {
    const team = player.team();
    if (team !== null) {
      return this.teamColorAllocator.assignTeamPlayerColor(team, player.id());
    }
    if (player.type() === PlayerType.Human) {
      return this.humanColorAllocator.assignColor(player.id());
    }
    if (player.type() === PlayerType.Bot) {
      return this.botColorAllocator.assignColor(player.id());
    }
    return this.nationColorAllocator.assignColor(player.id());
  }

  structureLightColor(territoryColor: Colord): Colord {}

  structureDarkColor(territoryColor: Colord): Colord {}

  // Don't call directly, use PlayerView
  borderColor(territoryColor: Colord): Colord {
    return territoryColor.darken(0.125);
  }

  defendedBorderColors(territoryColor: Colord): {
    light: Colord;
    dark: Colord;
  } {
    return {
      light: territoryColor.darken(0.2),
      dark: territoryColor.darken(0.4),
    };
  }

  focusedBorderColor(): Colord {
    return colord("rgb(230,230,230)");
  }

  textColor(player: PlayerView): string {
    return player.type() === PlayerType.Human ? "#000000" : "#4D4D4D";
  }

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.shore;
    }
    switch (gm.terrainType(tile)) {
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
  neutralColor(): Colord {
    return this._neutralColor;
  }
  enemyColor(): Colord {
    return this._enemyColor;
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
  /** Return spawn highlight color for self */
  spawnHighlightSelfColor(): Colord {
    return this._spawnHighlightSelfColor;
  }
  /** Return spawn highlight color for teammates */
  spawnHighlightTeamColor(): Colord {
    return this._spawnHighlightTeamColor;
  }
  /** Return spawn highlight color for enemies */
  spawnHighlightEnemyColor(): Colord {
    return this._spawnHighlightEnemyColor;
  }
}
