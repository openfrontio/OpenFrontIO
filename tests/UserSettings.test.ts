import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserSettings } from "../src/core/game/UserSettings";

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

describe("UserSettings sound/fx/notification accessors", () => {
  let settings: UserSettings;

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockLocalStorage());
    // The cache is static and shared across instances, so it must be
    // cleared between tests to avoid stale reads.
    (UserSettings as unknown as { cache: Map<string, unknown> }).cache.clear();
    settings = new UserSettings();
  });

  describe("isSoundEffectEnabled / setSoundEffectEnabled", () => {
    it("defaults to enabled when unset", () => {
      expect(settings.isSoundEffectEnabled("atom-launch")).toBe(true);
    });

    it("returns false after being disabled", () => {
      settings.setSoundEffectEnabled("atom-launch", false);
      expect(settings.isSoundEffectEnabled("atom-launch")).toBe(false);
    });

    it("returns true after being re-enabled", () => {
      settings.setSoundEffectEnabled("atom-launch", false);
      settings.setSoundEffectEnabled("atom-launch", true);
      expect(settings.isSoundEffectEnabled("atom-launch")).toBe(true);
    });

    it("persists the value to localStorage", () => {
      settings.setSoundEffectEnabled("ka-ching", false);
      expect(localStorage.getItem("settings.sound.ka-ching")).toBe("false");
    });

    it("tracks each effect key independently", () => {
      settings.setSoundEffectEnabled("atom-launch", false);
      expect(settings.isSoundEffectEnabled("atom-launch")).toBe(false);
      expect(settings.isSoundEffectEnabled("mirv-launch")).toBe(true);
    });
  });

  describe("isFxEnabled / setFxEnabled", () => {
    it("defaults to enabled when unset", () => {
      expect(settings.isFxEnabled("fx-conquest")).toBe(true);
    });

    it("returns false after being disabled", () => {
      settings.setFxEnabled("fx-conquest", false);
      expect(settings.isFxEnabled("fx-conquest")).toBe(false);
    });

    it("returns true after being re-enabled", () => {
      settings.setFxEnabled("fx-conquest", false);
      settings.setFxEnabled("fx-conquest", true);
      expect(settings.isFxEnabled("fx-conquest")).toBe(true);
    });

    it("persists the value to localStorage", () => {
      settings.setFxEnabled("fx-nuke-debris", false);
      expect(localStorage.getItem("settings.fx.fx-nuke-debris")).toBe("false");
    });

    it("tracks each effect key independently", () => {
      settings.setFxEnabled("fx-conquest", false);
      expect(settings.isFxEnabled("fx-conquest")).toBe(false);
      expect(settings.isFxEnabled("fx-dust")).toBe(true);
    });
  });

  describe("gameStartNotificationsEnabled / toggleGameStartNotifications", () => {
    it("defaults to enabled when unset", () => {
      expect(settings.gameStartNotificationsEnabled()).toBe(true);
    });

    it("flips to false on first toggle", () => {
      settings.toggleGameStartNotifications();
      expect(settings.gameStartNotificationsEnabled()).toBe(false);
    });

    it("flips back to true on second toggle", () => {
      settings.toggleGameStartNotifications();
      settings.toggleGameStartNotifications();
      expect(settings.gameStartNotificationsEnabled()).toBe(true);
    });

    it("persists the value to localStorage", () => {
      settings.toggleGameStartNotifications();
      expect(localStorage.getItem("settings.notifications.gameStart")).toBe(
        "false",
      );
    });
  });
});
