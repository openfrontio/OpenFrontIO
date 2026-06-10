import { UserSettings } from "engine/game/UserSettings";
import { PastelTheme } from "./PastelTheme";
import { PastelThemeDark } from "./PastelThemeDark";
import { Theme } from "./Theme";

/**
 * Client-side source of truth for the active theme. Themes were moved out of
 * `src/core` (the simulation never reads colors); this singleton replaces the
 * old `Config.theme()` accessor.
 */
class ThemeProvider {
  private readonly userSettings = new UserSettings();
  private light = new PastelTheme();
  private dark = new PastelThemeDark();

  /** The active theme, selected from the user's dark-mode preference. */
  current(): Theme {
    return this.userSettings.darkMode() ? this.dark : this.light;
  }

  /**
   * Recreate the themes so their colour allocators start empty. Call once per
   * game — matches the previous per-`Config` theme lifecycle and prevents
   * colour-pool depletion across games in a single session.
   */
  reset(): void {
    this.light = new PastelTheme();
    this.dark = new PastelThemeDark();
  }
}

export const themeProvider = new ThemeProvider();
