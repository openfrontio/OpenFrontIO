import {
  Difficulty,
  GameMapType,
  GameMode,
} from "@openfront/engine-api/game/GameTypes";
import "../../../src/client/components/GameConfigSettings";
import type {
  GameConfigSettings,
  GameConfigSettingsData,
} from "../../../src/client/components/GameConfigSettings";

vi.mock("../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
// The map grid isn't under test and needs IntersectionObserver.
vi.mock("../../../src/client/components/map/MapPicker", () => ({}));

const settings: GameConfigSettingsData = {
  map: { selected: GameMapType.World, useRandom: false },
  difficulty: { selected: Difficulty.Medium, disabled: false },
  gameMode: { selected: GameMode.FFA },
  teamCount: { selected: 2 },
  options: {
    bots: { value: 0, labelKey: "game_settings.bots", disabledKey: "x" },
    toggles: [{ labelKey: "game_settings.instant_build", checked: false }],
    inputCards: [],
  },
  unitTypes: { titleKey: "game_settings.disable_units", disabledUnits: [] },
};

describe("GameConfigSettings advanced settings", () => {
  let el: GameConfigSettings;

  beforeEach(async () => {
    el = document.createElement("game-config-settings") as GameConfigSettings;
    el.settings = settings;
    document.body.appendChild(el);
    await el.updateComplete;
  });

  afterEach(() => el.remove());

  it("hides options and unit toggles until expanded", async () => {
    const toggle = el.querySelector<HTMLButtonElement>(
      "[data-advanced-settings-toggle]",
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(el.textContent).toContain("map.map");
    expect(el.textContent).not.toContain("game_settings.instant_build");
    expect(el.textContent).not.toContain("game_settings.disable_units");

    toggle.click();
    await el.updateComplete;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(el.textContent).toContain("game_settings.instant_build");
    expect(el.textContent).toContain("game_settings.disable_units");

    toggle.click();
    await el.updateComplete;
    expect(el.textContent).not.toContain("game_settings.instant_build");
  });

  it("keeps the toggle usable while the settings are locked", async () => {
    el.locked = true;
    await el.updateComplete;
    const toggle = el.querySelector<HTMLButtonElement>(
      "[data-advanced-settings-toggle]",
    )!;
    expect(toggle.closest("[inert]")).toBeNull();

    toggle.click();
    await el.updateComplete;
    const option = [...el.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("game_settings.instant_build"),
    )!;
    expect(option.closest("[inert]")).not.toBeNull();
    expect(el.querySelector("map-picker")!.closest("[inert]")).not.toBeNull();
  });
});
