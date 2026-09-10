import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { crazyGamesSDK } from "../../src/client/CrazyGamesSDK";
import {
  SettingsModal,
  ShowSettingsModalEvent,
} from "../../src/client/hud/layers/SettingsModal";
import { PauseGameIntentEvent } from "../../src/client/Transport";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";
import { EventBus } from "../../src/core/EventBus";

type TestMenu = SettingsModal & { updateComplete: Promise<unknown> };
type TestSettings = UserSettingModal & {
  updateComplete: Promise<unknown>;
  activeTab: string;
};

describe("in-game menu opens the shared settings modal", () => {
  let eventBus: EventBus;
  let menu: TestMenu;
  let settings: TestSettings;
  let pauses: boolean[];
  let gameplayStop: ReturnType<typeof vi.spyOn>;
  let gameplayStart: ReturnType<typeof vi.spyOn>;

  async function settle() {
    await menu.updateComplete;
    await settings.updateComplete;
  }

  beforeEach(async () => {
    document.body.innerHTML = "";
    localStorage.clear();
    // The @customElement decorator's define() side-effect doesn't run under the
    // test transform, so register the element explicitly.
    if (!customElements.get("settings-modal")) {
      customElements.define("settings-modal", SettingsModal);
    }

    gameplayStop = vi
      .spyOn(crazyGamesSDK, "gameplayStop")
      .mockImplementation(async () => {});
    gameplayStart = vi
      .spyOn(crazyGamesSDK, "gameplayStart")
      .mockImplementation(async () => {});

    menu = document.createElement("settings-modal") as TestMenu;
    document.body.appendChild(menu);
    // Mirrors index.html: the in-game instance is mounted next to the HUD, and
    // GameRenderer hands it the bus.
    settings = document.createElement("user-setting") as TestSettings;
    settings.id = "game-settings";
    document.body.appendChild(settings);

    eventBus = new EventBus();
    pauses = [];
    eventBus.on(PauseGameIntentEvent, (e) => pauses.push(e.paused));
    menu.eventBus = eventBus;
    settings.eventBus = eventBus;
    menu.init();
    await settle();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Open the menu the way GameRightSidebar does in a single-player game. */
  async function openMenu() {
    eventBus.emit(new ShowSettingsModalEvent(true, true, false));
    await settle();
  }

  const openSettingsRow = () =>
    menu.querySelector<HTMLElement>("[data-open-settings]");

  it("hands off to #game-settings without touching the pause", async () => {
    await openMenu();
    expect(openSettingsRow()).not.toBeNull();
    expect(pauses).toEqual([true]);

    openSettingsRow()!.click();
    await settle();

    // Menu hidden, settings open, pause untouched.
    expect(menu.querySelector("[data-open-settings]")).toBeNull();
    expect(settings.isOpen()).toBe(true);
    expect(settings.activeTab).toBe("gameplay");
    expect(pauses).toEqual([true]);
  });

  it("reopens the menu when the settings modal closes", async () => {
    await openMenu();
    openSettingsRow()!.click();
    await settle();

    settings.close();
    await settle();

    expect(settings.isOpen()).toBe(false);
    expect(openSettingsRow()).not.toBeNull();
    expect(pauses).toEqual([true]);
  });

  it("emits exactly one pause and one resume across the whole round trip", async () => {
    await openMenu();
    openSettingsRow()!.click();
    await settle();
    settings.close();
    await settle();

    // Closing the menu itself is what finally releases the pause.
    menu.closeModal();
    await settle();

    expect(pauses).toEqual([true, false]);
    expect(gameplayStop).toHaveBeenCalledTimes(1);
    expect(gameplayStart).toHaveBeenCalledTimes(1);
  });

  it("returns to the menu when the settings modal is dismissed with Escape", async () => {
    await openMenu();
    openSettingsRow()!.click();
    await settle();

    // The menu's own window keydown handler was registered first and must not
    // act on this keystroke — it is not visible.
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await Promise.resolve();
    await settle();

    expect(settings.isOpen()).toBe(false);
    expect(openSettingsRow()).not.toBeNull();
    expect(pauses).toEqual([true]);
  });

  it("keeps the menu open when #game-settings is missing", async () => {
    // A shell running a client build without the element must not strand the
    // player with neither a menu nor settings.
    settings.remove();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await openMenu();

    openSettingsRow()!.click();
    await menu.updateComplete;

    expect(openSettingsRow()).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(pauses).toEqual([true]);
  });
});
