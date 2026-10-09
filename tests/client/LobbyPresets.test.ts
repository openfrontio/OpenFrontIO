import {
  Difficulty,
  GameMapType,
  GameMode,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteLobbyPreset,
  LOBBY_PRESETS_KEY,
  LobbyPreset,
  LobbyPresetConfig,
  LobbyPresetConfigSchema,
  MAX_PRESET_NAME_LENGTH,
  parseLobbyPresetsJson,
  saveLobbyPreset,
} from "../../src/client/LobbyPresets";
import { UserSettings } from "../../src/client/UserSettings";
import "../../src/client/components/LobbyPresetControls";
import { LobbyPresetControls } from "../../src/client/components/LobbyPresetControls";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
}));

vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
  prewarmCosmetics: vi.fn(),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({
      manifest: vi.fn(async () => ({
        nations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      })),
    })),
  },
}));

import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import { SinglePlayerModal } from "../../src/client/SinglePlayerModal";

describe("LobbyPresets logic and schema", () => {
  const sampleConfig: LobbyPresetConfig = {
    gameMap: GameMapType.World,
    useRandomMap: false,
    compactMap: true,
    difficulty: Difficulty.Medium,
    gameMode: GameMode.FFA,
    teamCount: 2,
    bots: 10,
    nations: 5,
    infiniteGold: true,
    infiniteTroops: false,
    instantBuild: true,
    randomSpawn: false,
    maxTimer: true,
    maxTimerValue: 60,
    disabledUnits: [UnitType.AtomBomb, UnitType.Warship],
    goldMultiplier: true,
    goldMultiplierValue: 2.5,
    startingGold: true,
    startingGoldValue: 10,
    customAlliances: true,
    customAllianceMinutes: 15,
    waterNukes: false,
    doomsdayClock: true,
    doomsdayClockSpeed: "fast",
    overtime: true,
    overtimeStartMinutes: 20,
    spawnImmunity: true,
    spawnImmunityDurationMinutes: 3,
    playerLimit: true,
    playerLimitValue: 8,
    startDelayValue: 10,
    anonymizeNames: true,
    whitelistEnabled: false,
    allowedPublicIds: "id1, id2",
    hostCheatsEnabled: true,
    hostCheatInfiniteGold: false,
    hostCheatInfiniteTroops: true,
    hostCheatGoldMultiplier: true,
    hostCheatGoldMultiplierValue: 5,
    hostCheatStartingGold: true,
    hostCheatStartingGoldValue: 50,
  };

  it("parses valid preset array JSON", () => {
    const raw = JSON.stringify([
      {
        name: "My Favorite FFA",
        createdAt: 123456789,
        config: sampleConfig,
      },
    ]);
    const parsed = parseLobbyPresetsJson(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("My Favorite FFA");
    expect(parsed[0].createdAt).toBe(123456789);
    expect(parsed[0].config.gameMap).toBe(GameMapType.World);
    expect(parsed[0].config.difficulty).toBe(Difficulty.Medium);
    expect(parsed[0].config.disabledUnits).toEqual([
      UnitType.AtomBomb,
      UnitType.Warship,
    ]);
  });

  it("safely handles invalid JSON, null, or empty string", () => {
    expect(parseLobbyPresetsJson("")).toEqual([]);
    expect(parseLobbyPresetsJson(null as unknown as string)).toEqual([]);
    expect(parseLobbyPresetsJson("not-valid-json")).toEqual([]);
    expect(parseLobbyPresetsJson("{}")).toEqual([]);
    expect(parseLobbyPresetsJson("42")).toEqual([]);
  });

  it("filters out items that do not conform to LobbyPresetSchema", () => {
    const raw = JSON.stringify([
      {
        name: "Valid",
        createdAt: 100,
        config: {
          gameMap: GameMapType.World,
          difficulty: Difficulty.Easy,
          gameMode: GameMode.FFA,
          teamCount: 2,
          bots: 5,
        },
      },
      {
        name: "Invalid missing difficulty",
        createdAt: 101,
        config: {
          gameMap: GameMapType.World,
          gameMode: GameMode.FFA,
          teamCount: 2,
          bots: 5,
        },
      },
      {
        name: 123, // invalid type
        createdAt: 102,
        config: sampleConfig,
      },
    ]);
    const parsed = parseLobbyPresetsJson(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("Valid");
  });

  describe("saveLobbyPreset and deleteLobbyPreset with UserSettings", () => {
    let mockStorage: Record<string, string>;
    let settings: UserSettings;

    beforeEach(() => {
      mockStorage = {};
      settings = {
        getSetting: vi.fn((key: string, def?: unknown) => {
          if (key in mockStorage) {
            return JSON.parse(mockStorage[key]);
          }
          return def;
        }),
        setSetting: vi.fn((key: string, val: unknown) => {
          mockStorage[key] = JSON.stringify(val);
        }),
        getLobbyPresets: () => {
          const val = mockStorage[LOBBY_PRESETS_KEY];
          return val ? parseLobbyPresetsJson(val) : [];
        },
        setLobbyPresets: (presets: readonly LobbyPreset[]) => {
          mockStorage[LOBBY_PRESETS_KEY] = JSON.stringify(presets);
          return true;
        },
      } as unknown as UserSettings;
    });

    it("saves a new preset and stores it in UserSettings", () => {
      const presets = saveLobbyPreset("Speed Run", sampleConfig, settings);
      expect(presets).not.toBeNull();
      expect(presets!).toHaveLength(1);
      expect(presets![0].name).toBe("Speed Run");
      expect(presets![0].config.bots).toBe(10);
      expect(presets![0].createdAt).toBeGreaterThan(0);

      // Verify persistence via settings.getLobbyPresets()
      const loaded = settings.getLobbyPresets();
      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe("Speed Run");
    });

    it("updates existing preset with case-insensitive name match", () => {
      saveLobbyPreset("Speed Run", sampleConfig, settings);

      const updatedConfig = { ...sampleConfig, bots: 99 };
      const updatedPresets = saveLobbyPreset(
        "speed run",
        updatedConfig,
        settings,
      );

      expect(updatedPresets).not.toBeNull();
      expect(updatedPresets!).toHaveLength(1);
      expect(updatedPresets![0].name).toBe("speed run");
      expect(updatedPresets![0].config.bots).toBe(99);
    });

    it("trims whitespace and truncates name to MAX_PRESET_NAME_LENGTH", () => {
      const longName = "A".repeat(MAX_PRESET_NAME_LENGTH + 20);
      const presets = saveLobbyPreset(
        `   ${longName}   `,
        sampleConfig,
        settings,
      );
      expect(presets).not.toBeNull();
      expect(presets!).toHaveLength(1);
      expect(presets![0].name).toBe("A".repeat(MAX_PRESET_NAME_LENGTH));
    });

    it("does not save when preset name is empty", () => {
      const presets = saveLobbyPreset("    ", sampleConfig, settings);
      expect(presets).toBeNull();
      expect(settings.getLobbyPresets()).toHaveLength(0);
    });

    it("returns null when setLobbyPresets fails", () => {
      (settings as any).setLobbyPresets = () => false;
      const presets = saveLobbyPreset("Failed Save", sampleConfig, settings);
      expect(presets).toBeNull();
    });

    it("deletes a preset by name (case-insensitive)", () => {
      saveLobbyPreset("Preset 1", sampleConfig, settings);
      saveLobbyPreset("Preset 2", sampleConfig, settings);
      expect(settings.getLobbyPresets()).toHaveLength(2);

      const afterDelete = deleteLobbyPreset("preset 1", settings);
      expect(afterDelete).toHaveLength(1);
      expect(afterDelete[0].name).toBe("Preset 2");
      expect(settings.getLobbyPresets()).toHaveLength(1);
    });

    it("leaves presets unchanged when deleting non-existent name", () => {
      saveLobbyPreset("Preset 1", sampleConfig, settings);
      const res = deleteLobbyPreset("Does Not Exist", settings);
      expect(res).toHaveLength(1);
    });
  });
});

describe("<lobby-preset-controls> component", () => {
  let element: LobbyPresetControls;

  const samplePresets: LobbyPreset[] = [
    {
      name: "Default Pro",
      createdAt: 1000,
      config: {
        gameMap: GameMapType.World,
        difficulty: Difficulty.Hard,
        gameMode: GameMode.FFA,
        teamCount: 2,
        bots: 20,
      },
    },
    {
      name: "Casual Team",
      createdAt: 2000,
      config: {
        gameMap: GameMapType.Europe,
        difficulty: Difficulty.Easy,
        gameMode: GameMode.Team,
        teamCount: 4,
        bots: 10,
      },
    },
  ];

  beforeEach(async () => {
    element = document.createElement(
      "lobby-preset-controls",
    ) as LobbyPresetControls;
    element.presets = samplePresets;
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
  });

  it("renders select dropdown with presets options", () => {
    const select = element.querySelector(
      "[data-test-preset-select]",
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.querySelectorAll("option"));
    expect(options.length).toBe(3); // placeholder + 2 presets
    expect(options[1].value).toBe("Default Pro");
    expect(options[2].value).toBe("Casual Team");
  });

  it("dispatches preset-select when selecting a preset from dropdown", async () => {
    const select = element.querySelector(
      "[data-test-preset-select]",
    ) as HTMLSelectElement;
    let selectedDetail = "";
    element.addEventListener("preset-select", ((e: CustomEvent<string>) => {
      selectedDetail = e.detail;
    }) as EventListener);

    select.value = "Default Pro";
    select.dispatchEvent(new Event("change"));
    await element.updateComplete;

    expect(selectedDetail).toBe("Default Pro");
    expect(element.selectedName).toBe("Default Pro");

    const nameInput = element.querySelector(
      "[data-test-preset-name-input]",
    ) as HTMLInputElement;
    expect(nameInput.value).toBe("Default Pro");
  });

  it("dispatches preset-load when Load button is clicked", async () => {
    element.selectedName = "Casual Team";
    await element.updateComplete;

    const loadBtn = element.querySelector(
      "[data-test-preset-load-btn]",
    ) as HTMLElement;
    expect(loadBtn).not.toBeNull();

    let loadedName = "";
    element.addEventListener("preset-load", ((e: CustomEvent<string>) => {
      loadedName = e.detail;
    }) as EventListener);

    loadBtn.click();
    expect(loadedName).toBe("Casual Team");
  });

  it("dispatches preset-delete when Delete button is clicked", async () => {
    element.selectedName = "Default Pro";
    await element.updateComplete;

    const deleteBtn = element.querySelector(
      "[data-test-preset-delete-btn]",
    ) as HTMLElement;
    expect(deleteBtn).not.toBeNull();

    let deletedName = "";
    element.addEventListener("preset-delete", ((e: CustomEvent<string>) => {
      deletedName = e.detail;
    }) as EventListener);

    deleteBtn.click();
    expect(deletedName).toBe("Default Pro");
  });

  it("dispatches preset-save when Save button is clicked with entered name", async () => {
    const nameInput = element.querySelector(
      "[data-test-preset-name-input]",
    ) as HTMLInputElement;
    nameInput.value = "New Custom Preset";
    nameInput.dispatchEvent(new Event("input"));
    await element.updateComplete;

    const saveBtn = element.querySelector(
      "[data-test-preset-save-btn]",
    ) as HTMLElement;
    expect(saveBtn).not.toBeNull();

    let savedName = "";
    element.addEventListener("preset-save", ((e: CustomEvent<string>) => {
      savedName = e.detail;
    }) as EventListener);

    saveBtn.click();
    expect(savedName).toBe("New Custom Preset");
  });

  it("does not dispatch preset-save if name input is empty or whitespace", async () => {
    const nameInput = element.querySelector(
      "[data-test-preset-name-input]",
    ) as HTMLInputElement;
    nameInput.value = "   ";
    nameInput.dispatchEvent(new Event("input"));
    await element.updateComplete;

    const saveBtn = element.querySelector(
      "[data-test-preset-save-btn]",
    ) as HTMLElement;

    let wasSaved = false;
    element.addEventListener("preset-save", () => {
      wasSaved = true;
    });

    saveBtn.click();
    expect(wasSaved).toBe(false);
  });

  it("disables save button when name input is empty even if a preset is selected", async () => {
    element.selectedName = "Default Pro";
    const nameInput = element.querySelector(
      "[data-test-preset-name-input]",
    ) as HTMLInputElement;
    nameInput.value = "";
    nameInput.dispatchEvent(new Event("input"));
    await element.updateComplete;

    const saveBtn = element.querySelector(
      "[data-test-preset-save-btn]",
    ) as HTMLElement;
    expect(saveBtn.hasAttribute("disable")).toBe(true);

    let saved = false;
    element.addEventListener("preset-save", () => {
      saved = true;
    });
    saveBtn.click();
    expect(saved).toBe(false);
  });

  it("disables controls and buttons when disabled property is set", async () => {
    element.disabled = true;
    element.selectedName = "Default Pro";
    await element.updateComplete;

    const select = element.querySelector(
      "[data-test-preset-select]",
    ) as HTMLSelectElement;
    const nameInput = element.querySelector(
      "[data-test-preset-name-input]",
    ) as HTMLInputElement;
    const loadBtn = element.querySelector(
      "[data-test-preset-load-btn]",
    ) as HTMLElement;
    const saveBtn = element.querySelector(
      "[data-test-preset-save-btn]",
    ) as HTMLElement;

    expect(select.disabled).toBe(true);
    expect(nameInput.disabled).toBe(true);

    let loadFired = false;
    element.addEventListener("preset-load", () => {
      loadFired = true;
    });
    loadBtn.click();
    expect(loadFired).toBe(false);

    let saveFired = false;
    element.addEventListener("preset-save", () => {
      saveFired = true;
    });
    saveBtn.click();
    expect(saveFired).toBe(false);
  });
});

describe("HostLobbyModal preset integration", () => {
  let modal: any;

  beforeEach(() => {
    localStorage.clear();
    modal = new HostLobbyModal();
    modal.putGameConfig = vi.fn();
  });

  it("exports valid preset config and imports it accurately", async () => {
    modal.selectedMap = GameMapType.Europe;
    modal.gameMode = GameMode.Team;
    modal.selectedDifficulty = Difficulty.Hard;
    modal.teamCount = 4;
    modal.bots = 25;
    modal.nations = 8;
    modal.infiniteGold = true;
    modal.goldMultiplier = true;
    modal.goldMultiplierValue = 3.5;
    modal.disabledUnits = [UnitType.AtomBomb];
    modal.spawnImmunity = true;
    modal.spawnImmunityDurationMinutes = 5;

    const exported = modal.exportPresetConfig();
    const parseResult = LobbyPresetConfigSchema.safeParse(exported);
    expect(parseResult.success).toBe(true);

    const targetModal: any = new HostLobbyModal();
    targetModal.putGameConfig = vi.fn();
    await targetModal.importPresetConfig(exported);

    expect(targetModal.selectedMap).toBe(GameMapType.Europe);
    expect(targetModal.gameMode).toBe(GameMode.Team);
    expect(targetModal.selectedDifficulty).toBe(Difficulty.Hard);
    expect(targetModal.teamCount).toBe(4);
    expect(targetModal.bots).toBe(25);
    expect(targetModal.infiniteGold).toBe(true);
    expect(targetModal.goldMultiplier).toBe(true);
    expect(targetModal.goldMultiplierValue).toBe(3.5);
    expect(targetModal.disabledUnits).toEqual([UnitType.AtomBomb]);
    expect(targetModal.spawnImmunity).toBe(true);
    expect(targetModal.spawnImmunityDurationMinutes).toBe(5);
  });

  it("handles preset save, load, and delete events", async () => {
    modal.selectedMap = GameMapType.World;
    modal.bots = 40;

    modal.handlePresetSave(
      new CustomEvent("preset-save", { detail: "World 40 Bots" }),
    );

    expect(modal.lobbyPresets).toHaveLength(1);
    expect(modal.lobbyPresets[0].name).toBe("World 40 Bots");
    expect(modal.selectedPresetName).toBe("World 40 Bots");

    // Change map and reload preset
    modal.selectedMap = GameMapType.Europe;
    modal.bots = 5;
    await modal.handlePresetLoad(
      new CustomEvent("preset-load", { detail: "World 40 Bots" }),
    );

    expect(modal.selectedMap).toBe(GameMapType.World);
    expect(modal.bots).toBe(40);

    // Delete preset
    modal.handlePresetDelete(
      new CustomEvent("preset-delete", { detail: "World 40 Bots" }),
    );
    expect(modal.lobbyPresets).toHaveLength(0);
    expect(modal.selectedPresetName).toBe("");
  });

  it("does not load preset when lobby is publicly listed", async () => {
    modal.publiclyListed = true;
    modal.selectedMap = GameMapType.Europe;
    modal.bots = 5;

    modal.lobbyPresets = [
      {
        name: "World 40 Bots",
        config: {
          ...modal.exportPresetConfig(),
          bots: 40,
          gameMap: GameMapType.World,
        },
      },
    ];

    await modal.handlePresetLoad(
      new CustomEvent("preset-load", { detail: "World 40 Bots" }),
    );

    expect(modal.selectedMap).toBe(GameMapType.Europe);
    expect(modal.bots).toBe(5);
  });

  it("shows error toast when saving preset fails", () => {
    (modal.userSettings as any).setLobbyPresets = () => false;
    modal.handlePresetSave(
      new CustomEvent("preset-save", { detail: "Fail Save" }),
    );
    expect(modal.lobbyPresets).toHaveLength(0);
  });
});

describe("SinglePlayerModal preset integration", () => {
  let modal: any;

  beforeEach(() => {
    localStorage.clear();
    modal = new SinglePlayerModal();
  });

  it("exports valid preset config and imports it accurately", async () => {
    modal.selectedMap = GameMapType.World;
    modal.gameMode = GameMode.FFA;
    modal.selectedDifficulty = Difficulty.Medium;
    modal.bots = 15;
    modal.infiniteGold = true;
    modal.waterNukes = true;
    modal.doomsdayClock = true;
    modal.doomsdayClockSpeed = "veryfast";

    const exported = modal.exportPresetConfig();
    const parseResult = LobbyPresetConfigSchema.safeParse(exported);
    expect(parseResult.success).toBe(true);

    const targetModal: any = new SinglePlayerModal();
    await targetModal.importPresetConfig(exported);

    expect(targetModal.selectedMap).toBe(GameMapType.World);
    expect(targetModal.gameMode).toBe(GameMode.FFA);
    expect(targetModal.selectedDifficulty).toBe(Difficulty.Medium);
    expect(targetModal.bots).toBe(15);
    expect(targetModal.infiniteGold).toBe(true);
    expect(targetModal.waterNukes).toBe(true);
    expect(targetModal.doomsdayClock).toBe(true);
    expect(targetModal.doomsdayClockSpeed).toBe("veryfast");
  });

  it("handles preset save, load, and delete events", async () => {
    modal.selectedMap = GameMapType.World;
    modal.bots = 12;

    modal.handlePresetSave(
      new CustomEvent("preset-save", { detail: "SP FFA 12" }),
    );

    expect(modal.lobbyPresets).toHaveLength(1);
    expect(modal.lobbyPresets[0].name).toBe("SP FFA 12");
    expect(modal.selectedPresetName).toBe("SP FFA 12");

    modal.selectedMap = GameMapType.Europe;
    modal.bots = 2;
    await modal.handlePresetLoad(
      new CustomEvent("preset-load", { detail: "SP FFA 12" }),
    );

    expect(modal.selectedMap).toBe(GameMapType.World);
    expect(modal.bots).toBe(12);

    modal.handlePresetDelete(
      new CustomEvent("preset-delete", { detail: "SP FFA 12" }),
    );
    expect(modal.lobbyPresets).toHaveLength(0);
    expect(modal.selectedPresetName).toBe("");
  });

  it("shows error toast when saving preset fails", () => {
    (modal.userSettings as any).setLobbyPresets = () => false;
    modal.handlePresetSave(
      new CustomEvent("preset-save", { detail: "Fail Save" }),
    );
    expect(modal.lobbyPresets).toHaveLength(0);
  });
});
