export class UserSettings {
  get(key: string, defaultValue: boolean) {
    const value = localStorage.getItem(key);
    if (!value) return defaultValue;

    if (value === "true") return true;

    if (value === "false") return false;
  }

  set(key: string, value: boolean) {
    localStorage.setItem(key, value ? "true" : "false");
    document.body.classList.toggle("dark");
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

  toggleEmojis() {
    this.set("settings.emojis", !this.emojis());
  }

  toggleDarkMode() {
    this.set("settings.darkMode", !this.darkMode());
  }
}
