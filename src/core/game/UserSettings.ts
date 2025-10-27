import { Cosmetics } from "../CosmeticSchemas";
import { PlayerPattern } from "../Schemas";

const PATTERN_KEY = "territoryPattern";

export interface UserSettingsData {
  emojis: boolean;
  performanceOverlay: boolean;
  alertFrame: boolean;
  anonymousNames: boolean;
  lobbyIdVisibility: boolean;
  fxLayer: boolean;
  structureSprites: boolean;
  darkMode: boolean;
  leftClickOpensMenu: boolean;
  territoryPatterns: boolean;
  focusLocked: boolean;
  colorblindMode: boolean;
  backgroundMusicVolume: number;
  soundEffectsVolume: number;
}

export interface IUserSettings {
  emojis(): boolean;
  performanceOverlay(): boolean;
  alertFrame(): boolean;
  anonymousNames(): boolean;
  lobbyIdVisibility(): boolean;
  fxLayer(): boolean;
  structureSprites(): boolean;
  darkMode(): boolean;
  leftClickOpensMenu(): boolean;
  territoryPatterns(): boolean;
  focusLocked(): boolean;
  colorblindMode(): boolean;
  backgroundMusicVolume(): number;
  soundEffectsVolume(): number;
}

export class UserSettings implements IUserSettings {
  get(key: string, defaultValue: boolean): boolean {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;

    if (value === "true") return true;

    if (value === "false") return false;

    return defaultValue;
  }

  set(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  getFloat(key: string, defaultValue: number): number {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;

    const floatValue = parseFloat(value);
    if (isNaN(floatValue)) return defaultValue;

    return floatValue;
  }

  setFloat(key: string, value: number) {
    localStorage.setItem(key, value.toString());
  }

  getData(): UserSettingsData {
    return {
      emojis: this.emojis(),
      performanceOverlay: this.performanceOverlay(),
      alertFrame: this.alertFrame(),
      anonymousNames: this.anonymousNames(),
      lobbyIdVisibility: this.lobbyIdVisibility(),
      fxLayer: this.fxLayer(),
      structureSprites: this.structureSprites(),
      darkMode: this.darkMode(),
      leftClickOpensMenu: this.leftClickOpensMenu(),
      territoryPatterns: this.territoryPatterns(),
      focusLocked: this.focusLocked(),
      colorblindMode: this.colorblindMode(),
      backgroundMusicVolume: this.backgroundMusicVolume(),
      soundEffectsVolume: this.soundEffectsVolume(),
    };
  }

  emojis() {
    return this.get("settings.emojis", true);
  }

  performanceOverlay() {
    return this.get("settings.performanceOverlay", false);
  }

  alertFrame() {
    return this.get("settings.alertFrame", true);
  }

  anonymousNames() {
    return this.get("settings.anonymousNames", false);
  }

  lobbyIdVisibility() {
    return this.get("settings.lobbyIdVisibility", true);
  }

  fxLayer() {
    return this.get("settings.specialEffects", true);
  }

  structureSprites() {
    return this.get("settings.structureSprites", true);
  }

  darkMode() {
    return this.get("settings.darkMode", false);
  }

  leftClickOpensMenu() {
    return this.get("settings.leftClickOpensMenu", false);
  }

  territoryPatterns() {
    return this.get("settings.territoryPatterns", true);
  }

  focusLocked() {
    return false;
    // TODO: renable when performance issues are fixed.
    this.get("settings.focusLocked", true);
  }

  toggleLeftClickOpenMenu() {
    this.set("settings.leftClickOpensMenu", !this.leftClickOpensMenu());
  }

  toggleFocusLocked() {
    this.set("settings.focusLocked", !this.focusLocked());
  }

  toggleEmojis() {
    this.set("settings.emojis", !this.emojis());
  }

  togglePerformanceOverlay() {
    this.set("settings.performanceOverlay", !this.performanceOverlay());
  }

  toggleAlertFrame() {
    this.set("settings.alertFrame", !this.alertFrame());
  }

  toggleRandomName() {
    this.set("settings.anonymousNames", !this.anonymousNames());
  }

  toggleLobbyIdVisibility() {
    this.set("settings.lobbyIdVisibility", !this.lobbyIdVisibility());
  }

  toggleFxLayer() {
    this.set("settings.specialEffects", !this.fxLayer());
  }

  toggleStructureSprites() {
    this.set("settings.structureSprites", !this.structureSprites());
  }

  toggleTerritoryPatterns() {
    this.set("settings.territoryPatterns", !this.territoryPatterns());
  }

  toggleDarkMode() {
    this.set("settings.darkMode", !this.darkMode());
    if (this.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  colorblindMode() {
    return this.get("settings.colorblindMode", false);
  }

  toggleColorblindMode() {
    this.set("settings.colorblindMode", !this.colorblindMode());
  }

  // For development only. Used for testing patterns, set in the console manually.
  getDevOnlyPattern(): PlayerPattern | undefined {
    const data = localStorage.getItem("dev-pattern") ?? undefined;
    if (data === undefined) return undefined;
    return {
      name: "dev-pattern",
      patternData: data,
      colorPalette: {
        name: "dev-color-palette",
        primaryColor: localStorage.getItem("dev-primary") ?? "#ffffff",
        secondaryColor: localStorage.getItem("dev-secondary") ?? "#000000",
      },
    } satisfies PlayerPattern;
  }

  getSelectedPatternName(cosmetics: Cosmetics | null): PlayerPattern | null {
    if (cosmetics === null) return null;
    let data = localStorage.getItem(PATTERN_KEY) ?? null;
    if (data === null) return null;
    const patternPrefix = "pattern:";
    if (data.startsWith(patternPrefix)) {
      data = data.slice(patternPrefix.length);
    }
    const [patternName, colorPalette] = data.split(":");
    const pattern = cosmetics.patterns[patternName];
    if (pattern === undefined) return null;
    return {
      name: patternName,
      patternData: pattern.pattern,
      colorPalette: cosmetics.colorPalettes?.[colorPalette],
    } satisfies PlayerPattern;
  }

  setSelectedPatternName(patternName: string | undefined): void {
    if (patternName === undefined) {
      localStorage.removeItem(PATTERN_KEY);
    } else {
      localStorage.setItem(PATTERN_KEY, patternName);
    }
  }

  getSelectedColor(): string | undefined {
    const data = localStorage.getItem("settings.territoryColor") ?? undefined;
    if (data === undefined) return undefined;
    return data;
  }

  setSelectedColor(color: string | undefined): void {
    if (color === undefined) {
      localStorage.removeItem("settings.territoryColor");
    } else {
      localStorage.setItem("settings.territoryColor", color);
    }
  }

  backgroundMusicVolume(): number {
    return this.getFloat("settings.backgroundMusicVolume", 0);
  }

  setBackgroundMusicVolume(volume: number): void {
    this.setFloat("settings.backgroundMusicVolume", volume);
  }

  soundEffectsVolume(): number {
    return this.getFloat("settings.soundEffectsVolume", 1);
  }

  setSoundEffectsVolume(volume: number): void {
    this.setFloat("settings.soundEffectsVolume", volume);
  }
}
