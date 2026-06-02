import { Colord, colord, LabaColor } from "colord";
import { PlayerType, Team } from "../../core/game/Game";
import { GameMap, TileRef } from "../../core/game/GameMap";
import { PlayerView } from "../../core/game/GameView";
import { PseudoRandom } from "../../core/PseudoRandom";
import { simpleHash } from "../../core/Util";
import { ColorAllocator } from "./ColorAllocator";
import { Theme } from "./Theme";

/**
 * Shared theme machinery. Owns the per-pool color allocators and the
 * territory/team color dispatch (the greedy allocation), plus the color math
 * every theme shares. Concrete themes supply only the color *data* by
 * implementing the abstract hooks (palettes, team-color variations, terrain).
 * A theme may also override the dispatch methods for fully custom allocation.
 */
export abstract class BaseTheme implements Theme {
  private rand = new PseudoRandom(123);
  protected humanColorAllocator: ColorAllocator;
  protected botColorAllocator: ColorAllocator;
  protected nationColorAllocator: ColorAllocator;
  private teamPlayerColors = new Map<string, Colord>();

  // Shared "default theme" colors. Override the fields in a subclass to differ.
  protected background = colord("rgb(60,60,60)");
  protected falloutColors = [
    colord("rgb(120,255,71)"),
    colord("rgb(130,255,85)"),
    colord("rgb(110,245,65)"),
    colord("rgb(125,255,75)"),
    colord("rgb(115,250,68)"),
  ];
  protected _spawnHighlightColor = colord("rgb(255,213,79)");
  protected _spawnHighlightSelfColor = colord("rgb(255,255,255)");
  protected _spawnHighlightTeamColor = colord("rgb(0,255,0)");
  protected _spawnHighlightEnemyColor = colord("rgb(255,0,0)");

  constructor() {
    this.humanColorAllocator = new ColorAllocator(
      this.humanPalette(),
      this.fallbackPalette(),
    );
    this.botColorAllocator = new ColorAllocator(
      this.botPalette(),
      this.botPalette(),
    );
    this.nationColorAllocator = new ColorAllocator(
      this.nationPalette(),
      this.nationPalette(),
    );
  }

  // --- Color data: concrete themes provide these ---
  protected abstract humanPalette(): Colord[];
  protected abstract botPalette(): Colord[];
  protected abstract nationPalette(): Colord[];
  protected abstract fallbackPalette(): Colord[];
  /** Per-team color variations; index 0 is the team's base color. */
  protected abstract teamColorVariations(team: Team): Colord[];
  abstract terrainColor(gm: GameMap, tile: TileRef): Colord;

  // --- Allocation dispatch (overridable) ---
  teamColor(team: Team): Colord {
    const rgb = this.teamColorVariations(team)[0].toRgb();
    return colord({
      r: Math.round(rgb.r),
      g: Math.round(rgb.g),
      b: Math.round(rgb.b),
    });
  }

  territoryColor(player: PlayerView): Colord {
    const team = player.team();
    if (team !== null) {
      return this.teamColorForPlayer(team, player.id());
    }
    if (player.type() === PlayerType.Human) {
      return this.humanColorAllocator.assignColor(player.id());
    }
    if (player.type() === PlayerType.Bot) {
      return this.botColorAllocator.assignColor(player.id());
    }
    return this.nationColorAllocator.assignColor(player.id());
  }

  /** Stable per-player variation within a team's color set. */
  teamColorForPlayer(team: Team, playerId: string): Colord {
    const cached = this.teamPlayerColors.get(playerId);
    if (cached !== undefined) {
      return cached;
    }
    const colors = this.teamColorVariations(team);
    const color = colors[simpleHash(playerId) % colors.length];
    this.teamPlayerColors.set(playerId, color);
    return color;
  }

  // --- Shared color math ---
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

  backgroundColor(): Colord {
    return this.background;
  }

  falloutColor(): Colord {
    return this.rand.randElement(this.falloutColors);
  }

  font(): string {
    return "Overpass, sans-serif";
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
  spawnHighlightSelfColor(): Colord {
    return this._spawnHighlightSelfColor;
  }
  spawnHighlightTeamColor(): Colord {
    return this._spawnHighlightTeamColor;
  }
  spawnHighlightEnemyColor(): Colord {
    return this._spawnHighlightEnemyColor;
  }
}
