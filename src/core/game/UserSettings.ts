export enum RadialMenuMode {
  Default = "Default",
  Classic = "Classic",
}

function isTouchDevice() {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

export class UserSettings {
  get(key: string, defaultValue: boolean) {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;

    if (value === "true") return true;

    if (value === "false") return false;
  }

  getEnum<T>(key: string, defaultValue: T, validValues: T[]): T {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;
    if (!validValues.includes(value as T)) return defaultValue;

    return value as T;
  }

  set(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
  }

  setEnum(key: string, value: string) {
    localStorage.setItem(key, value);
  }

  emojis() {
    return this.get("settings.emojis", true);
  }

  darkMode() {
    return this.get("settings.darkMode", false);
  }

  leftClickOpensMenu() {
    return this.get("settings.leftClickOpensMenu", false);
  }

  toggleLeftClickOpenMenu() {
    this.set("settings.leftClickOpensMenu", !this.leftClickOpensMenu());
  }

  radialMenuMode() {
    return this.getEnum(
      "settings.radialMenuMode",
      isTouchDevice() ? RadialMenuMode.Classic : RadialMenuMode.Default,
      [RadialMenuMode.Default, RadialMenuMode.Classic],
    );
  }

  toggleRadialMenuMode() {
    this.setEnum(
      "settings.radialMenuMode",
      this.radialMenuMode() == RadialMenuMode.Default
        ? RadialMenuMode.Classic
        : RadialMenuMode.Default,
    );
  }

  toggleEmojis() {
    this.set("settings.emojis", !this.emojis());
  }

  toggleDarkMode() {
    this.set("settings.darkMode", !this.darkMode());
    if (this.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}
