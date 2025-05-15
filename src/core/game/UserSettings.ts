export class UserSettings {
  private cache = new Map<string, boolean>();

  get(key: string, defaultValue: boolean): boolean {
    // 1. Return cached value if present
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    // 2. Otherwise load from localStorage
    const raw = localStorage.getItem(key);
    let value = defaultValue;

    if (raw === "true") {
      value = true;
    } else if (raw === "false") {
      value = false;
    }

    // 3. Cache and return
    this.cache.set(key, value);
    return value;
  }

  set(key: string, value: boolean) {
    // 1. Update cache
    this.cache.set(key, value);

    // 2. Persist outside the game loop
    localStorage.setItem(key, value ? "true" : "false");
  }

  emojis() {
    return this.get("settings.emojis", true);
  }
  anonymousNames() {
    return this.get("settings.anonymousNames", false);
  }

  darkMode() {
    return this.get("settings.darkMode", false);
  }

  leftClickOpensMenu() {
    return this.get("settings.leftClickOpensMenu", false);
  }

  focusLocked() {
    return false;
    // TODO: renable when performance issues are fixed.
    // return this.get("settings.focusLocked", true);
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

  toggleDarkMode() {
    this.set("settings.darkMode", !this.darkMode());
    if (this.darkMode()) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }
}
