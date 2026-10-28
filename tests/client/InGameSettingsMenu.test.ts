import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Difficulty,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { GameConfig } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import en from "../../resources/lang/en.json";
import { gamePortal } from "../../src/client/GamePortal";
import {
  SettingsModal,
  ShowSettingsModalEvent,
} from "../../src/client/hud/layers/SettingsModal";
import { PauseGameIntentEvent } from "../../src/client/Transport";
import "../../src/client/UserSettingModal";
import type { UserSettingModal } from "../../src/client/UserSettingModal";

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
      .spyOn(gamePortal, "gameplayStop")
      .mockImplementation(async () => {});
    gameplayStart = vi
      .spyOn(gamePortal, "gameplayStart")
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
    menu.init();
    await settle();
  });

  // Both elements are removed by the global DOM teardown in
  // tests/domTeardown.ts, which runs after this hook.
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

  const publicFfa = {
    gameMap: GameMapType.World,
    gameType: GameType.Public,
    gameMode: GameMode.FFA,
    difficulty: Difficulty.Medium,
    nations: "default",
    bots: 400,
    donateGold: false,
    donateTroops: false,
  } as GameConfig;
  const modifierTags = () =>
    [...menu.querySelectorAll("[data-modifier-tags] span")].map(
      (tag) => tag.textContent,
    );

  it("shows the game's modifiers", async () => {
    menu.gameConfig = {
      ...publicFfa,
      randomSpawn: true,
      nations: 5,
      publicGameModifiers: { isCrowded: true, isRandomSpawn: true },
    };
    menu.mapNationCount = 10;
    await openMenu();

    expect(modifierTags()).toEqual([
      "host_modal.crowded",
      "game_settings.random_spawn",
      "game_settings.nations: 5",
    ]);
  });

  it("shows the disabled units and host cheats with the modifiers", async () => {
    menu.gameConfig = {
      ...publicFfa,
      gameType: GameType.Private,
      difficulty: Difficulty.Easy,
      disabledUnits: [UnitType.City, UnitType.MIRV],
      hostCheats: { infiniteTroops: true, goldMultiplier: 3 },
    };
    await openMenu();

    const texts = (selector: string) =>
      [...menu.querySelectorAll(`[data-game-modifiers] ${selector} span`)].map(
        (tag) => tag.textContent,
      );
    expect(menu.querySelector("[data-modifier-tags]")).toBeNull();
    expect(texts("[data-disabled-units]")).toEqual([
      "unit_type.city",
      "unit_type.mirv",
    ]);
    expect(texts("[data-host-cheats]")).toEqual([
      "game_settings.infinite_troops",
      "game_settings.gold_multiplier: x3",
    ]);
  });

  it("leaves the modifiers out of a game without any", async () => {
    menu.gameConfig = publicFfa;
    await openMenu();

    expect(menu.querySelector("[data-game-modifiers]")).toBeNull();
  });
});
