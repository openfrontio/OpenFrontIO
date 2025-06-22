export class UserSettings {
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

  emojis() {
    return this.get("settings.emojis", true);
  }
  anonymousNames() {
    return this.get("settings.anonymousNames", false);
  }

  fxLayer() {
    return this.get("settings.specialEffects", true);
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

  toggleRandomName() {
    this.set("settings.anonymousNames", !this.anonymousNames());
  }

  toggleFxLayer() {
    this.set("settings.specialEffects", !this.fxLayer());
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

  private readonly PATTERN_KEY = "territoryPattern";

  getSelectedPattern(): string | undefined {
    return localStorage.getItem(this.PATTERN_KEY) ?? undefined;
  }

  setSelectedPattern(base64: string): void {
    localStorage.setItem(this.PATTERN_KEY, base64);
  }
}
