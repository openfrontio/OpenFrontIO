import { Cosmetics } from "../CosmeticSchemas";
import { PlayerPattern } from "../Schemas";

export function getDefaultKeybinds(isMac: boolean): Record<string, string> {
  return {
    toggleView: "Space",
    coordinateGrid: "KeyM",
    buildCity: "Digit1",
    buildFactory: "Digit2",
    buildPort: "Digit3",
    buildDefensePost: "Digit4",
    buildMissileSilo: "Digit5",
    buildSamLauncher: "Digit6",
    buildWarship: "Digit7",
    buildAtomBomb: "Digit8",
    buildHydrogenBomb: "Digit9",
    buildMIRV: "Digit0",
    attackRatioDown: "KeyT",
    attackRatioUp: "KeyY",
    boatAttack: "KeyB",
    groundAttack: "KeyG",
    swapDirection: "KeyU",
    zoomOut: "KeyQ",
    zoomIn: "KeyE",
    centerCamera: "KeyC",
    moveUp: "KeyW",
    moveLeft: "KeyA",
    moveDown: "KeyS",
    moveRight: "KeyD",
    modifierKey: isMac ? "MetaLeft" : "ControlLeft",
    altKey: "AltLeft",
    shiftKey: "ShiftLeft",
    resetGfx: "KeyR",
    selectAllWarships: "KeyF",
    pauseGame: "KeyP",
    gameSpeedUp: "Period",
    gameSpeedDown: "Comma",
  };
}

export const USER_SETTINGS_CHANGED_EVENT = "event:user-settings-changed";
export const PATTERN_KEY = "territoryPattern";
export const FLAG_KEY = "flag";
export const COLOR_KEY = "settings.territoryColor";
export const DARK_MODE_KEY = "settings.darkMode";
export const PERFORMANCE_OVERLAY_KEY = "settings.performanceOverlay";
export const KEYBINDS_KEY = "settings.keybinds";

export class UserSettings {
  private static cache = new Map<string, string | null>();

  private emitChange(key: string, value: any): void {
    try {
      const maybeDispatch = (globalThis as any)?.dispatchEvent;
      if (typeof maybeDispatch !== "function") return;
      (globalThis as any).dispatchEvent(
        new CustomEvent(`${USER_SETTINGS_CHANGED_EVENT}:${key}`, {
          detail: value,
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

  private setCached(key: string, value: string, emitChange: boolean = true) {
    localStorage.setItem(key, value);
    UserSettings.cache.set(key, value);
    if (emitChange) {
      this.emitChange(key, value);
    }
  }

  public removeCached(key: string, emitChange: boolean = true) {
    localStorage.removeItem(key);
    UserSettings.cache.set(key, null);
    if (emitChange) {
      this.emitChange(key, null);
    }
  }

  private getBool(key: string, defaultValue: boolean): boolean {
    const value = this.getCached(key);
    if (!value) return defaultValue;
    if (value === "true") return true;
    if (value === "false") return false;
    return defaultValue;
  }

  private setBool(key: string, value: boolean) {
    this.setCached(key, value ? "true" : "false");
  }

  private getString(key: string, defaultValue: string = ""): string {
    const value = this.getCached(key);
    if (value === null) return defaultValue;
    return value;
  }

  private setString(key: string, value: string) {
    this.setCached(key, value);
  }

  private getFloat(key: string, defaultValue: number): number {
    const value = this.getCached(key);
    if (!value) return defaultValue;

    const floatValue = parseFloat(value);
    if (isNaN(floatValue)) return defaultValue;
    return floatValue;
  }

  private setFloat(key: string, value: number) {
    this.setCached(key, value.toString());
  }

  emojis() {
    return this.getBool("settings.emojis", true);
  }

  performanceOverlay() {
    return this.getBool(PERFORMANCE_OVERLAY_KEY, false);
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
    return this.getBool(DARK_MODE_KEY, false);
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

  // Performance overlay specifically needs a direct setter for Shift-D
  setPerformanceOverlay(value: boolean) {
    this.setBool(PERFORMANCE_OVERLAY_KEY, value);
  }

  togglePerformanceOverlay() {
    this.setBool(PERFORMANCE_OVERLAY_KEY, !this.performanceOverlay());
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
    this.setBool(DARK_MODE_KEY, !this.darkMode());
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
    let data = this.getCached(PATTERN_KEY);
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

  getFlag(): string | null {
    let flag = this.getCached(FLAG_KEY);
    if (!flag) return null;
    // Migrate bare country codes to country: prefix
    if (!flag.startsWith("flag:") && !flag.startsWith("country:")) {
      flag = `country:${flag}`;
      // Silent migration: don't emit change event for FlagInput
      this.setCached(FLAG_KEY, flag, false);
    }
    return flag;
  }

  setFlag(flag: string): void {
    if (flag === "country:xx") {
      this.clearFlag(true);
    } else {
      this.setCached(FLAG_KEY, flag);
    }
  }

  clearFlag(emitChange: boolean = false): void {
    this.removeCached(FLAG_KEY, emitChange);
  }

  backgroundMusicVolume(): number {
    return this.getFloat("settings.backgroundMusicVolume", 0);
  }

  setBackgroundMusicVolume(volume: number): void {
    this.setFloat("settings.backgroundMusicVolume", volume);
  }

  // What % attack ratio increments per click/scroll
  attackRatioIncrement(): number {
    const increment = Math.round(
      this.getFloat("settings.attackRatioIncrement", 10),
    );
    if (!Number.isFinite(increment) || increment <= 0) return 10;
    return increment;
  }

  setAttackRatioIncrement(value: number): void {
    this.setFloat("settings.attackRatioIncrement", value);
  }

  // What % attack ratio is set to
  attackRatio(): number {
    return this.getFloat("settings.attackRatio", 0.2);
  }

  setAttackRatio(value: number): void {
    this.setFloat("settings.attackRatio", value);
  }

  // In case localStorage was manually edited to be invalid, return an empty object
  parsedUserKeybinds(): Record<string, any> {
    const raw = this.getString(KEYBINDS_KEY, "{}");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      console.warn("Invalid keybinds JSON:", e);
    }
    return {};
  }

  // Returns a flat keybind map { action: "keyCode" }, handling nested objects and legacy strings
  private normalizedUserKeybinds(): Record<string, string> {
    const parsed = this.parsedUserKeybinds();
    return Object.fromEntries(
      Object.entries(parsed)
        // Extract value from nested object or plain string, filter out non-string values
        .map(([k, v]) => {
          let val = v;
          if (v && typeof v === "object" && !Array.isArray(v) && "value" in v) {
            val = v.value;
          }
          if (Array.isArray(val) && typeof val[0] === "string") {
            val = val[0];
          }
          return [k, val];
        })
        .filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  }

  keybinds(isMac: boolean): Record<string, string> {
    const merged = {
      ...getDefaultKeybinds(isMac),
      ...this.normalizedUserKeybinds(),
    };
    // Actually unbind key: if Unbind is clicked in UserSettingsModal, eg. for Attack Ratio Up,
    // keybind is "Null". Even if it is in default kindbinds (Y), it should not work anymore.
    // The key (Y) can now be bound to another action like Boat Attack, and no two actions listen to the same key.
    for (const k in merged) {
      if (merged[k] === "Null") {
        delete merged[k];
      }
    }

    return merged;
  }

  setKeybinds(value: string | Record<string, any>): void {
    if (typeof value === "string") {
      this.setString(KEYBINDS_KEY, value);
    } else {
      this.setString(KEYBINDS_KEY, JSON.stringify(value));
    }
  }

  soundEffectsVolume(): number {
    return this.getFloat("settings.soundEffectsVolume", 1);
  }

  setSoundEffectsVolume(volume: number): void {
    this.setFloat("settings.soundEffectsVolume", volume);
  }
}
