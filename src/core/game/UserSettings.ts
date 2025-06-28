import { EventBus, GameEvent } from "../EventBus";
import LocalStorage from "../Storage";

export class DarkModeChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class EmojisChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class AnonymousNamesChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class SpecialEffectsChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class LeftClickOpensMenuChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class FocusLockedChangedEvent implements GameEvent {
  constructor(public readonly value: boolean) {}
}

export class UserSettings {
  constructor(
    private _eventBus: EventBus,
    private _storage: LocalStorage,
  ) {}

  get eventBus(): EventBus {
    return this._eventBus;
  }

  get storage(): LocalStorage {
    return this._storage;
  }

  get(key: string, defaultValue: boolean): boolean {
    const value = this.storage.getItem(key);
    if (!value) return defaultValue;

    if (value === "true") return true;

    if (value === "false") return false;

    return defaultValue;
  }

  set(key: string, value: boolean) {
    this.storage.setItem(key, value ? "true" : "false");
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

  focusLocked() {
    return false;
    // TODO: renable when performance issues are fixed.
    this.get("settings.focusLocked", true);
  }

  toggleLeftClickOpenMenu() {
    const newValue = !this.leftClickOpensMenu();
    this.set("settings.leftClickOpensMenu", newValue);
    this.eventBus.emit(new LeftClickOpensMenuChangedEvent(newValue));
  }

  toggleFocusLocked() {
    const newValue = !this.focusLocked();
    this.set("settings.focusLocked", newValue);
    this.eventBus.emit(new FocusLockedChangedEvent(newValue));
  }

  toggleEmojis() {
    const newValue = !this.emojis();
    this.set("settings.emojis", newValue);
    this.eventBus.emit(new EmojisChangedEvent(newValue));
  }

  toggleRandomName() {
    const newValue = !this.anonymousNames();
    this.set("settings.anonymousNames", newValue);
    this.eventBus.emit(new AnonymousNamesChangedEvent(newValue));
  }

  toggleFxLayer() {
    const newValue = !this.fxLayer();
    this.set("settings.specialEffects", newValue);
    this.eventBus.emit(new SpecialEffectsChangedEvent(newValue));
  }

  toggleDarkMode() {
    const newValue = !this.darkMode();
    this.set("settings.darkMode", newValue);
    this.eventBus.emit(new DarkModeChangedEvent(newValue));
  }
}
