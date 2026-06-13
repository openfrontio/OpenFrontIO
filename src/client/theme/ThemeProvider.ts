import { Colord, colord, LabaColor } from "colord";
import { PlayerType, Team } from "../../core/game/Game";
import { UserSettings } from "../../core/game/UserSettings";
import { simpleHash } from "../../core/Util";
import {
  createThemeSettings,
  ThemeSettings,
} from "../render/gl/RenderSettings";
import { PlayerView } from "../view";
import { ColorAllocator } from "./ColorAllocator";

/**
 * The color surface consumed by PlayerView and HUD components. Built from
 * `ThemeSettings` (a theme JSON like default-theme.json, combined with
 * render-settings.json into the graphics-configuration pipeline).
 */
export interface Theme {
  teamColor(team: Team): Colord;
  // Don't call directly, use PlayerView
  territoryColor(playerInfo: PlayerView): Colord;
  // Don't call directly, use PlayerView
  structureColors(territoryColor: Colord): { light: Colord; dark: Colord };
  // Don't call directly, use PlayerView
  borderColor(territoryColor: Colord): Colord;
  // Don't call directly, use PlayerView
  defendedBorderColors(territoryColor: Colord): { light: Colord; dark: Colord };
  focusedBorderColor(): Colord;
  spawnHighlightColor(): Colord;
}

/**
 * Generate per-player color variations around a team's base color, spreading
 * hue/chroma/lightness so teammates stay recognizable as one team.
 */
function generateTeamColors(baseColor: Colord): Colord[] {
  const lch = baseColor.toLch();
  const colorCount = 64;
  const goldenAngle = 137.508;

  return Array.from({ length: colorCount }, (_, index) => {
    if (index === 0) return baseColor;

    // Spread hues evenly across ±6° band using golden angle within that range
    const hueShift = ((index * goldenAngle) % 12) - 6;
    const h = (lch.h + hueShift + 360) % 360;

    // Chroma oscillates ±10% around the base to add variety without washing out
    const chromaFactor = 1.0 + 0.1 * Math.sin(index * 0.7);
    const c = Math.max(10, Math.min(130, lch.c * chromaFactor));

    // Lightness alternates above/below the base using golden angle spacing
    // Tighter range (±18) keeps teammates recognizable as the same team
    const lightOffset = 18 * Math.sin(index * goldenAngle * (Math.PI / 180));
    const l = Math.max(25, Math.min(80, lch.l + lightOffset));

    return colord({ l, c, h });
  });
}

/**
 * Build the per-team variation palettes from theme settings. The Bot team
 * stays a single flat color; every other team gets generated variations.
 */
export function buildTeamPalettes(
  settings: ThemeSettings,
): Map<Team, Colord[]> {
  const palettes = new Map<Team, Colord[]>();
  for (const [team, hex] of Object.entries(settings.teamColors)) {
    const base = colord(hex);
    palettes.set(team, team === "Bot" ? [base] : generateTeamColors(base));
  }
  return palettes;
}

/**
 * A theme built entirely from `ThemeSettings` data. Owns the per-pool color
 * allocators and the territory/team color dispatch, plus the color math every
 * theme shares — a new theme is just a new theme JSON.
 */
export class SettingsTheme implements Theme {
  private humanColorAllocator: ColorAllocator;
  private botColorAllocator: ColorAllocator;
  private nationColorAllocator: ColorAllocator;
  private teamPalettes: Map<Team, Colord[]>;
  private teamPlayerColors = new Map<string, Colord>();

  private _focusedBorderColor: Colord;
  private _spawnHighlightColor: Colord;

  constructor(private settings: ThemeSettings) {
    const humanColors = settings.humanColors.map(colord);
    const botColors = settings.botColors.map(colord);
    const nationColors = settings.nationColors.map(colord);
    const fallbackColors = settings.fallbackColors.map(colord);

    this.humanColorAllocator = new ColorAllocator(humanColors, fallbackColors);
    this.botColorAllocator = new ColorAllocator(botColors, botColors);
    this.nationColorAllocator = new ColorAllocator(nationColors, nationColors);
    this.teamPalettes = buildTeamPalettes(settings);

    this._focusedBorderColor = colord(settings.focusedBorderColor);
    this._spawnHighlightColor = colord(settings.spawnHighlightColor);
  }

  /** Per-team color variations; index 0 is the team's base color. */
  private teamColorVariations(team: Team): Colord[] {
    return (
      this.teamPalettes.get(team) ?? [
        this.humanColorAllocator.assignColor(team),
      ]
    );
  }

  /** Base color for a team (the first entry of its variations). */
  teamColor(team: Team): Colord {
    const rgb = this.teamColorVariations(team)[0].toRgb();
    return colord({
      r: Math.round(rgb.r),
      g: Math.round(rgb.g),
      b: Math.round(rgb.b),
    });
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
    const contrastTarget = this.settings.structureContrastTarget;
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
   * `borderLightnessScale` darkens *relative* to the fill's own lightness
   * (so dark fills don't collapse to black); `borderDarken` is an absolute
   * darken on top. Each theme JSON uses one or the other.
   */
  borderColor(territoryColor: Colord): Colord {
    let out = territoryColor;
    const scale = this.settings.borderLightnessScale;
    if (scale !== 1) {
      const hsl = out.toHsl();
      out = colord({ ...hsl, l: hsl.l * scale });
    }
    const darken = this.settings.borderDarken;
    if (darken !== 0) {
      out = out.darken(darken);
    }
    return out;
  }

  /** Light/dark border pair used to render a defended (fortified) border. */
  defendedBorderColors(territoryColor: Colord): {
    light: Colord;
    dark: Colord;
  } {
    return {
      light: territoryColor.darken(this.settings.defendedBorderDarkenLight),
      dark: territoryColor.darken(this.settings.defendedBorderDarkenDark),
    };
  }

  /** Border color used to highlight the currently focused player. */
  focusedBorderColor(): Colord {
    return this._focusedBorderColor;
  }

  /** Highlight color for a spawnable tile during the spawn phase. */
  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
}

/**
 * Client-side source of truth for the active theme. Themes were moved out of
 * `src/core` (the simulation never reads colors); this singleton replaces the
 * old `Config.theme()` accessor.
 */
class ThemeProvider {
  private readonly userSettings = new UserSettings();
  private defaultTheme = new SettingsTheme(createThemeSettings("default"));
  private colorblind = new SettingsTheme(createThemeSettings("colorblind"));

  /** The active theme, selected from the colorblind-mode preference. */
  current(): Theme {
    if (this.userSettings.graphicsOverrides().accessibility?.colorblind) {
      return this.colorblind;
    }
    return this.defaultTheme;
  }

  /**
   * Recreate the themes so their colour allocators start empty. Call once per
   * game — matches the previous per-`Config` theme lifecycle and prevents
   * colour-pool depletion across games in a single session.
   */
  reset(): void {
    this.defaultTheme = new SettingsTheme(createThemeSettings("default"));
    this.colorblind = new SettingsTheme(createThemeSettings("colorblind"));
  }
}

export const themeProvider = new ThemeProvider();
