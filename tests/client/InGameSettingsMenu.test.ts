import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../resources/lang/en.json";
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
  setActiveTab(key: string): void;
  modalConfig(): { tabs?: { key: string; label: string }[] };
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

  afterEach(async () => {
    vi.restoreAllMocks();
    // A Lit element left connected when the file ends can schedule an update
    // after jsdom is gone, which surfaces as an unhandled "document is not
    // defined" and fails the run even though every test passed.
    menu.remove();
    settings.remove();
    await menu.updateComplete;
    await settings.updateComplete;
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

  it("reaches Graphics from the in-game instance, without changing the landing tab", async () => {
    await openMenu();
    openSettingsRow()!.click();
    await settle();

    // The in-game entry point still lands on Gameplay...
    expect(settings.activeTab).toBe("gameplay");
    expect(settings.querySelector("graphics-preset-selector")).toBeNull();

    // ...and Graphics is a tab the player can reach from there.
    expect(settings.modalConfig().tabs?.map((t) => t.key)).toContain(
      "graphics",
    );
    settings.setActiveTab("graphics");
    await settle();

    expect(settings.activeTab).toBe("graphics");
    expect(settings.querySelector("graphics-preset-selector")).not.toBeNull();
    expect(
      settings.querySelector("#performance-overlay-toggle"),
    ).not.toBeNull();
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

  it("offers one way into graphics, not a second advanced-graphics row", async () => {
    // The in-game-only advanced graphics modal used to sit here as its own
    // row, duplicating the settings modal's Graphics tab.
    await openMenu();

    expect(menu.querySelectorAll("[data-open-settings]")).toHaveLength(1);
    const strings = en.user_setting as Record<string, string | undefined>;
    expect(strings.graphics_settings_label).toBeUndefined();
    expect(menu.textContent).not.toContain("Graphics Settings");
  });

  it("reaches the advanced graphics options through the shared modal", async () => {
    await openMenu();
    openSettingsRow()!.click();
    await settle();

    settings.setActiveTab("graphics");
    await settle();
    settings
      .querySelector("#graphics-advanced-toggle")!
      .dispatchEvent(new Event("change", { bubbles: true }));
    await settle();

    // A sample from each storage section the old modal wrote.
    expect(settings.querySelector("#territory-alpha-slider")).not.toBeNull();
    expect(settings.querySelector("#ocean-color-picker")).not.toBeNull();
    expect(settings.querySelector("#classic-icons-toggle")).not.toBeNull();
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
