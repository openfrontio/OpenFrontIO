import { Cosmetics } from "../CosmeticSchemas";
import { PlayerPattern } from "../Schemas";

const PATTERN_KEY = "territoryPattern";

export class UserSettings {
  private static cache = new Map<string, string | null>();

  private emitChange(key: string, value: boolean | number | string): void {
    try {
      const maybeDispatch = (globalThis as any)?.dispatchEvent;
      if (typeof maybeDispatch !== "function") return;
      (globalThis as any).dispatchEvent(
        new CustomEvent("user-settings-changed", {
          detail: { key, value },
        }),
      );
    } catch {
      // Ignore - settings should still be applied even if event dispatch fails.
    }
  }

  private getCached(key: string): string | null {
    if (!UserSettings.cache.has(key)) {
      UserSettings.cache.set(key, localStorage.getItem(key));
    }
    return UserSettings.cache.get(key) ?? null;
  }

  private setCached(key: string, value: string) {
    localStorage.setItem(key, value);
    UserSettings.cache.set(key, value);
  }

  private removeCached(key: string) {
    localStorage.removeItem(key);
    UserSettings.cache.set(key, null);
  }

  getBool(key: string, defaultValue: boolean): boolean {
    const value = this.getCached(key);
    if (!value) return defaultValue;
    if (value === "true") return true;
    if (value === "false") return false;
    return defaultValue;
  }

  setBool(key: string, value: boolean) {
    this.setCached(key, value ? "true" : "false");
    this.emitChange(key, value);
  }

  getString(key: string, defaultValue: string = ""): string {
    const value = this.getCached(key);
    if (value === null) return defaultValue;
    return value;
  }

  setString(key: string, value: string) {
    this.setCached(key, value);
    this.emitChange(key, value);
  }

  getFloat(key: string, defaultValue: number): number {
    const value = this.getCached(key);
    if (!value) return defaultValue;

    const floatValue = parseFloat(value);
    if (isNaN(floatValue)) return defaultValue;
    return floatValue;
  }

  setFloat(key: string, value: number) {
    this.setCached(key, value.toString());
    this.emitChange(key, value);
  }

  emojis() {
    return this.getBool("settings.emojis", true);
  }

  performanceOverlay() {
    return this.getBool("settings.performanceOverlay", false);
  }

  alertFrame() {
    return this.getBool("settings.alertFrame", true);
  }

  anonymousNames() {
    return this.getBool("settings.anonymousNames", false);
  }

  lobbyIdVisibility() {
    return this.getBool("settings.lobbyIdVisibility", true);
  }

  fxLayer() {
    return this.getBool("settings.specialEffects", true);
  }

  structureSprites() {
    return this.getBool("settings.structureSprites", true);
  }

  darkMode() {
    return this.getBool("settings.darkMode", false);
  }

  leftClickOpensMenu() {
    return this.getBool("settings.leftClickOpensMenu", false);
  }

  territoryPatterns() {
    return this.getBool("settings.territoryPatterns", true);
  }

  attackingTroopsOverlay() {
    return this.getBool("settings.attackingTroopsOverlay", true);
  }

  toggleAttackingTroopsOverlay() {
    this.setBool(
      "settings.attackingTroopsOverlay",
      !this.attackingTroopsOverlay(),
    );
  }

  cursorCostLabel() {
    const legacy = this.getBool("settings.ghostPricePill", true);
    return this.getBool("settings.cursorCostLabel", legacy);
  }

  toggleLeftClickOpenMenu() {
    this.setBool("settings.leftClickOpensMenu", !this.leftClickOpensMenu());
  }

  toggleEmojis() {
    this.setBool("settings.emojis", !this.emojis());
  }

  togglePerformanceOverlay() {
    this.setBool("settings.performanceOverlay", !this.performanceOverlay());
  }

  toggleAlertFrame() {
    this.setBool("settings.alertFrame", !this.alertFrame());
  }

  toggleRandomName() {
    this.setBool("settings.anonymousNames", !this.anonymousNames());
  }

  toggleLobbyIdVisibility() {
    this.setBool("settings.lobbyIdVisibility", !this.lobbyIdVisibility());
  }

  toggleFxLayer() {
    this.setBool("settings.specialEffects", !this.fxLayer());
  }

  toggleStructureSprites() {
    this.setBool("settings.structureSprites", !this.structureSprites());
  }

  toggleCursorCostLabel() {
    this.setBool("settings.cursorCostLabel", !this.cursorCostLabel());
  }

  toggleTerritoryPatterns() {
    this.setBool("settings.territoryPatterns", !this.territoryPatterns());
  }

  toggleDarkMode() {
    this.setBool("settings.darkMode", !this.darkMode());
    if (this.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
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
    let data = this.getCached(PATTERN_KEY) ?? null;
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
      this.removeCached(PATTERN_KEY);
    } else {
      this.setCached(PATTERN_KEY, patternName);
    }
  }

  getSelectedColor(): string | undefined {
    return this.getCached("settings.territoryColor") ?? undefined;
  }

  setSelectedColor(color: string | undefined): void {
    if (color === undefined) {
      this.removeCached("settings.territoryColor");
    } else {
      this.setCached("settings.territoryColor", color);
    }
  }

  getFlag(): string | undefined {
    const flag = this.getCached("flag") ?? undefined;
    if (!flag || flag === "xx") return undefined;
    return flag;
  }

  backgroundMusicVolume(): number {
    return this.getFloat("settings.backgroundMusicVolume", 0);
  }

  setBackgroundMusicVolume(volume: number): void {
    this.setFloat("settings.backgroundMusicVolume", volume);
  }

  attackRatioIncrement(): number {
    const increment = Math.round(
      this.getFloat("settings.attackRatioIncrement", 10),
    );
    if (!Number.isFinite(increment) || increment <= 0) return 10;
    return increment;
  }

  soundEffectsVolume(): number {
    return this.getFloat("settings.soundEffectsVolume", 1);
  }

  setSoundEffectsVolume(volume: number): void {
    this.setFloat("settings.soundEffectsVolume", volume);
  }
}
