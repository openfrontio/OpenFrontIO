import { Colord, colord, LabaColor } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { PlayerType, Team, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { ColorAllocator } from "./ColorAllocator";
import { botColors, fallbackColors, humanColors, nationColors } from "./Colors";
import { Theme } from "./Config";

export class PastelTheme implements Theme {
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

  structureColors(territoryColor: Colord): { light: Colord; dark: Colord } {
    // Convert territory color to LAB color space. Territory color is rendered in game with alpha = 150/255, use that here.
    const lightLAB = territoryColor.alpha(150 / 255).toLab();
    // Get "border color" from territory color & convert to LAB color space
    const darkLAB = this.borderColor(territoryColor).toLab();
    // Calculate the contrast of the two provided colors
    let contrast = this.contrast(lightLAB, darkLAB);

    // Don't want excessive contrast, so incrementally increase contrast within a loop.
    // Define target values, looping limits, and loop counter
    const loopLimit = 10; // Switch from darkening border to lightening fill if loopLimit is reached
    const maxIterations = 50; // maximum number of loops allowed, throw error above this limit
    const contrastTarget = 0.5;
    let loopCount = 0;

    // Adjust luminance by 5 in each iteration. This is a balance between speed and not overdoing contrast changes.
    const luminanceChange = 5;

    while (contrast < contrastTarget) {
      if (loopCount > maxIterations) {
        // Prevent runaway loops
        console.warn(`Infinite loop detected during structure color calculation. 
          Light color: ${colord(lightLAB).toRgbString()}, 
          Dark color: ${colord(darkLAB).toRgbString()}, 
          Contrast: ${contrast}`);
        break;

        // Increase the light color if the "loop limit" has been reach
        // (probably due to the dark color already being as dark as it can be)
      } else if (loopCount > loopLimit) {
        lightLAB.l = this.clamp(lightLAB.l + luminanceChange);

        // Decrease the dark color first to keep the light color as close
        // to the territory color as possible
      } else {
        darkLAB.l = this.clamp(darkLAB.l - luminanceChange);
      }

      // re-calculate contrast and increment loop counter
      contrast = this.contrast(lightLAB, darkLAB);
      loopCount++;
    }
    return { light: colord(lightLAB), dark: colord(darkLAB) };
  }

  private contrast(first: LabaColor, second: LabaColor): number {
    return colord(first).delta(colord(second));
  }

  private clamp(num: number, low: number = 0, high: number = 100): number {
    return Math.min(Math.max(low, num), high);
  }

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
