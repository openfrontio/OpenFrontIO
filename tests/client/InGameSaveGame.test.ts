import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ uploadSavedGame: vi.fn() }));
vi.mock("../../src/client/SavedGamesApi", () => api);

// The page's bootstrap config isn't there under jsdom.
vi.mock("../../src/client/ClientEnv", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("../../src/client/ClientEnv")>();
  mod.ClientEnv.gitCommit = () => "DEV";
  return mod;
});

const identity = vi.hoisted(() => ({ linked: true }));
vi.mock("../../src/client/AccountIdentity", () => ({
  responseHasLinkedIdentity: vi.fn(() => identity.linked),
}));

import { gamePortal } from "../../src/client/GamePortal";
import {
  defaultSaveName,
  SettingsModal,
  ShowSettingsModalEvent,
} from "../../src/client/hud/layers/SettingsModal";
import type { GameView } from "../../src/client/view/GameView";

type TestMenu = SettingsModal & { updateComplete: Promise<unknown> };

const SNAPSHOT = new Uint8Array([1, 2, 3]);

function fakeGame(opts: { gameType?: GameType; replay?: boolean } = {}) {
  const snapshot = vi.fn(async () => SNAPSHOT);
  const game = {
    config: () => ({
      gameConfig: () => ({
        gameType: opts.gameType ?? GameType.Singleplayer,
        gameMap: "World",
      }),
      isReplay: () => opts.replay ?? false,
    }),
    ticks: () => 1234,
    worker: { snapshot },
  } as unknown as GameView;
  return { game, snapshot };
}

describe("in-game menu: save game", () => {
  let menu: TestMenu;
  let eventBus: EventBus;

  async function open(game: GameView) {
    menu.game = game;
    eventBus.emit(new ShowSettingsModalEvent(true, true, false));
    await menu.updateComplete;
  }

  const saveRow = () =>
    menu.querySelector<HTMLButtonElement>("[data-save-game]");
  const status = () =>
    menu.querySelector("[data-save-status]")?.textContent?.trim();

  beforeEach(async () => {
    identity.linked = true;
    api.uploadSavedGame.mockReset();
    vi.spyOn(gamePortal, "gameplayStop").mockImplementation(async () => {});
    vi.spyOn(gamePortal, "gameplayStart").mockImplementation(async () => {});
    menu = document.createElement("settings-modal") as TestMenu;
    document.body.appendChild(menu);
    eventBus = new EventBus();
    menu.eventBus = eventBus;
    menu.init();
    await menu.updateComplete;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is offered in a signed-in player's singleplayer game", async () => {
    await open(fakeGame().game);
    expect(saveRow()).not.toBeNull();
  });

  it.each([
    ["a multiplayer game", { gameType: GameType.Public }],
    ["a replay", { replay: true }],
  ])("is not offered in %s", async (_, opts) => {
    await open(fakeGame(opts).game);
    expect(saveRow()).toBeNull();
  });

  it("is not offered to a guest, whose saves would be lost", async () => {
    identity.linked = false;
    await open(fakeGame().game);
    expect(saveRow()).toBeNull();
  });

  it("snapshots the game and uploads it under the map's name", async () => {
    api.uploadSavedGame.mockResolvedValue({ id: "x" });
    const { game, snapshot } = fakeGame();
    await open(game);

    saveRow()!.click();
    await vi.waitFor(() =>
      expect(status()).toBe("saved_games.save_status.saved"),
    );

    expect(snapshot).toHaveBeenCalledTimes(1);
    const [bytes, meta] = api.uploadSavedGame.mock.calls[0];
    expect(bytes).toBe(SNAPSHOT);
    expect(meta.map).toBe("World");
    expect(meta.tick).toBe(1234);
    expect(meta.name).toMatch(/ \d{4}-\d\d-\d\d \d\d:\d\d$/);
  });

  it("says when the player has too many saves", async () => {
    api.uploadSavedGame.mockResolvedValue("limit");
    await open(fakeGame().game);

    saveRow()!.click();
    await vi.waitFor(() =>
      expect(status()).toBe("saved_games.save_status.limit"),
    );
  });

  it("reports a snapshot that failed rather than hanging on Saving", async () => {
    const { game, snapshot } = fakeGame();
    snapshot.mockRejectedValue(new Error("Snapshot failed"));
    await open(game);

    saveRow()!.click();
    await vi.waitFor(() =>
      expect(status()).toBe("saved_games.save_status.request_failed"),
    );
    expect(api.uploadSavedGame).not.toHaveBeenCalled();
  });

  it("starts the next opening without the last save's outcome", async () => {
    api.uploadSavedGame.mockResolvedValue({ id: "x" });
    const { game } = fakeGame();
    await open(game);
    saveRow()!.click();
    await vi.waitFor(() =>
      expect(status()).toBe("saved_games.save_status.saved"),
    );

    menu.closeModal();
    await open(game);
    expect(status()).toBe("saved_games.save_desc");
  });
});

describe("defaultSaveName", () => {
  it("is the map and the local time, within the API's 64 characters", () => {
    const at = new Date(2026, 9, 9, 7, 5);
    expect(defaultSaveName("World", at)).toBe("World 2026-10-09 07:05");
    expect(defaultSaveName("x".repeat(100), at).length).toBeLessThanOrEqual(64);
  });
});
