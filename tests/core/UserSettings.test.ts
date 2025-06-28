import { EventBus } from "../../src/core/EventBus";
import {
  AnonymousNamesChangedEvent,
  DarkModeChangedEvent,
  EmojisChangedEvent,
  LeftClickOpensMenuChangedEvent,
  SpecialEffectsChangedEvent,
  UserSettings,
} from "../../src/core/game/UserSettings";
import LocalStorage from "../../src/core/Storage";
import { MockMemoryStorage } from "../mock/MockStorage";

describe("UserSettings", () => {
  let eventBus: EventBus;
  let storage: LocalStorage;
  let settings: UserSettings;

  beforeEach(() => {
    eventBus = new EventBus();
    storage = new MockMemoryStorage();
    settings = new UserSettings(eventBus, storage);
  });

  test("gets and sets boolean values", () => {
    expect(settings.emojis()).toBe(true);
    settings.set("settings.emojis", false);
    expect(settings.emojis()).toBe(false);
  });

  test("toggles left click menu and emits event", () => {
    const spy = jest.fn();
    eventBus.on(LeftClickOpensMenuChangedEvent, spy);

    expect(settings.leftClickOpensMenu()).toBe(false);
    settings.toggleLeftClickOpenMenu();
    expect(settings.leftClickOpensMenu()).toBe(true);
    expect(spy).toHaveBeenCalledWith(
      expect.any(LeftClickOpensMenuChangedEvent),
    );
  });

  test("toggles emojis and emits event", () => {
    const spy = jest.fn();
    eventBus.on(EmojisChangedEvent, spy);

    expect(settings.emojis()).toBe(true);
    settings.toggleEmojis();
    expect(settings.emojis()).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.any(EmojisChangedEvent));
  });

  test("toggles anonymous names and emits event", () => {
    const spy = jest.fn();
    eventBus.on(AnonymousNamesChangedEvent, spy);

    expect(settings.anonymousNames()).toBe(false);
    settings.toggleRandomName();
    expect(settings.anonymousNames()).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.any(AnonymousNamesChangedEvent));
  });

  test("toggles fx layer and emits event", () => {
    const spy = jest.fn();
    eventBus.on(SpecialEffectsChangedEvent, spy);

    expect(settings.fxLayer()).toBe(true);
    settings.toggleFxLayer();
    expect(settings.fxLayer()).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.any(SpecialEffectsChangedEvent));
  });

  test("toggles dark mode and emits event", () => {
    const spy = jest.fn();
    eventBus.on(DarkModeChangedEvent, spy);

    expect(settings.darkMode()).toBe(false);

    settings.toggleDarkMode();
    expect(settings.darkMode()).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.any(DarkModeChangedEvent));
  });
});
