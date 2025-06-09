export class UserSettings {
  constructor() {
    this._emojis = this.getFromStorage("settings.emojis", true);
    this._anonymousNames = this.getFromStorage(
      "settings.anonymousNames",
      false,
    );
    this._specialEffects = this.getFromStorage("settings.specialEffects", true);
    this._darkMode = this.getFromStorage("settings.darkMode", false);
    this._leftClickOpensMenu = this.getFromStorage(
      "settings.leftClickOpensMenu",
      false,
    );
    this._focusLocked = this.getFromStorage("settings.focusLocked", true);
  }
  private _emojis: boolean;
  private _anonymousNames: boolean;
  private _specialEffects: boolean;
  private _darkMode: boolean;
  private _leftClickOpensMenu: boolean;
  private _focusLocked: boolean;

  private getFromStorage(key: string, defaultValue: boolean): boolean {
    const value = localStorage.getItem(key);
    if (value === "true") return true;
    if (value === "false") return false;
    return defaultValue;
  }

  private setToStorage(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  emojis() {
    return this._emojis;
  }
  anonymousNames() {
    return this._anonymousNames;
  }
  fxLayer() {
    return this._specialEffects;
  }
  darkMode() {
    return this._darkMode;
  }
  leftClickOpensMenu() {
    return this._leftClickOpensMenu;
  }
  focusLocked() {
    return false;
  } // Keep disabled if buggy

  toggleLeftClickOpenMenu() {
    this._leftClickOpensMenu = !this._leftClickOpensMenu;
    this.setToStorage("settings.leftClickOpensMenu", this._leftClickOpensMenu);
  }

  toggleFocusLocked() {
    this._focusLocked = !this._focusLocked;
    this.setToStorage("settings.focusLocked", this._focusLocked);
  }

  toggleEmojis() {
    this._emojis = !this._emojis;
    this.setToStorage("settings.emojis", this._emojis);
  }

  toggleRandomName() {
    this._anonymousNames = !this._anonymousNames;
    this.setToStorage("settings.anonymousNames", this._anonymousNames);
  }

  toggleFxLayer() {
    this._specialEffects = !this._specialEffects;
    this.setToStorage("settings.specialEffects", this._specialEffects);
  }

  toggleDarkMode() {
    this._darkMode = !this._darkMode;
    this.setToStorage("settings.darkMode", this._darkMode);
    if (this._darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
  setEmojis(value: boolean) {
    this._emojis = value;
    this.setToStorage("settings.emojis", value);
  }

  setAnonymousNames(value: boolean) {
    this._anonymousNames = value;
    this.setToStorage("settings.anonymousNames", value);
  }

  setFxLayer(value: boolean) {
    this._specialEffects = value;
    this.setToStorage("settings.specialEffects", value);
  }

  setDarkMode(value: boolean) {
    this._darkMode = value;
    this.setToStorage("settings.darkMode", value);
    if (value) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }

  setLeftClickOpensMenu(value: boolean) {
    this._leftClickOpensMenu = value;
    this.setToStorage("settings.leftClickOpensMenu", value);
  }
}
export const userSettings = new UserSettings();
