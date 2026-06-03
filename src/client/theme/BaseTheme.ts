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
  /** Color pool for human players. */
  protected abstract humanPalette(): Colord[];
  /** Color pool for bot players. */
  protected abstract botPalette(): Colord[];
  /** Color pool for nation (FFA AI) players. */
  protected abstract nationPalette(): Colord[];
  /** Extra colors used once the human pool is exhausted. */
  protected abstract fallbackPalette(): Colord[];
  /** Per-team color variations; index 0 is the team's base color. */
  protected abstract teamColorVariations(team: Team): Colord[];
  /** Color for a terrain tile, based on its type and elevation magnitude. */
  abstract terrainColor(gm: GameMap, tile: TileRef): Colord;

  // --- Allocation dispatch (overridable) ---
  /** Base color for a team (the first entry of its variations). */
  teamColor(team: Team): Colord {
    const rgb = this.teamColorVariations(team)[0].toRgb();
    return colord({
      r: Math.round(rgb.r),
      g: Math.round(rgb.g),
      b: Math.round(rgb.b),
    });
  }

  /**
   * Color for a player's territory: a per-player variation when the player is
   * on a team, otherwise a distinct color allocated from the matching pool
   * (human / bot / nation).
   */
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
  /**
   * Derive the light/dark color pair used to render a structure icon over a
   * territory, nudging luminance until the two reach a minimum contrast so the
   * icon stays legible on any fill.
   */
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
      } else if (loopCount > loopLimit) {
        // Increase the light color once the loop limit is reached (probably
        // because the dark color is already as dark as it can get).
        lightLAB.l = this.clamp(lightLAB.l + luminanceChange);
      } else {
        // Decrease the dark color first to keep the light color as close
        // to the territory color as possible.
        darkLAB.l = this.clamp(darkLAB.l - luminanceChange);
      }

      // re-calculate contrast and increment loop counter
      contrast = this.contrast(lightLAB, darkLAB);
      loopCount++;
    }
    return { light: colord(lightLAB), dark: colord(darkLAB) };
  }

  /** Perceptual (CIE76 delta-E) distance between two LAB colors. */
  private contrast(first: LabaColor, second: LabaColor): number {
    return colord(first).delta(colord(second));
  }

  /** Clamp a number into the inclusive [low, high] range (default 0–100). */
  private clamp(num: number, low: number = 0, high: number = 100): number {
    return Math.min(Math.max(low, num), high);
  }

  /**
   * Border color for a territory. Don't call directly — use PlayerView.
   * Themes override this to change how borders relate to the fill.
   */
  borderColor(territoryColor: Colord): Colord {
    return territoryColor.darken(0.125);
  }

  /** Light/dark border pair used to render a defended (fortified) border. */
  defendedBorderColors(territoryColor: Colord): {
    light: Colord;
    dark: Colord;
  } {
    return {
      light: territoryColor.darken(0.2),
      dark: territoryColor.darken(0.4),
    };
  }

  /** Border color used to highlight the currently focused player. */
  focusedBorderColor(): Colord {
    return colord("rgb(230,230,230)");
  }

  /** Player name text color (darker for humans, gray for AI). */
  textColor(player: PlayerView): string {
    return player.type() === PlayerType.Human ? "#000000" : "#4D4D4D";
  }

  /** Map background color. */
  backgroundColor(): Colord {
    return this.background;
  }

  /** A random color from the fallout palette (for the nuke fallout effect). */
  falloutColor(): Colord {
    return this.rand.randElement(this.falloutColors);
  }

  /** Font stack used for in-map text. */
  font(): string {
    return "Overpass, sans-serif";
  }

  /** Highlight color for a spawnable tile during the spawn phase. */
  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
  /** Spawn highlight color for the local player's own tiles. */
  spawnHighlightSelfColor(): Colord {
    return this._spawnHighlightSelfColor;
  }
  /** Spawn highlight color for teammates' tiles. */
  spawnHighlightTeamColor(): Colord {
    return this._spawnHighlightTeamColor;
  }
  /** Spawn highlight color for enemies' tiles. */
  spawnHighlightEnemyColor(): Colord {
    return this._spawnHighlightEnemyColor;
  }
}
