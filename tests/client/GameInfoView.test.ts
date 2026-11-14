import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import type { GameConfig } from "@openfront/engine-api/Schemas";
import type { AnalyticsRecord } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchGameById: vi.fn(async () => false),
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn((map: GameMapType) => ({
      webpPath: `/maps/${map}.webp`,
    })),
  },
}));

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    getMapName: vi.fn((mapName: string | undefined) => mapName ?? null),
  };
});

import { fetchGameById } from "../../src/client/Api";
import { formatAbsoluteTime } from "../../src/client/components/baseComponents/stats/GameHistoryDates";
import { GameInfoView } from "../../src/client/components/baseComponents/stats/GameInfoView";
import { LangSelector } from "../../src/client/LangSelector";
import { formatGameType } from "../../src/client/utilities/LobbySettingsSummary";

const config: GameConfig = {
  gameMap: GameMapType.Montreal,
  difficulty: Difficulty.Medium,
  donateGold: false,
  donateTroops: false,
  gameType: GameType.Public,
  gameMode: GameMode.FFA,
  gameMapSize: GameMapSize.Normal,
  nations: "disabled",
  bots: 0,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  maxPlayers: 40,
  disabledUnits: [],
  randomSpawn: false,
};

function makeSession(
  gameID: string,
  gameMap: GameMapType,
  withPlayer = true,
): AnalyticsRecord {
  return {
    version: "v0.0.2",
    info: {
      duration: 1_000,
      winner: withPlayer ? ["player", `${gameID}-player`] : undefined,
      players: withPlayer
        ? [
            {
              clientID: `${gameID}-player`,
              username: `${gameID} player`,
              clanTag: null,
              stats: {
                units: { port: [1n, 0n, 0n, 1n] },
                conquests: [1n],
              },
              persistentID: null,
            },
          ]
        : [],
      gameID,
      lobbyCreatedAt: 0,
      config: { ...config, gameMap },
      start: 0,
      end: 1_000,
      num_turns: 100,
      lobbyFillTime: 0,
    },
    gitCommit: "DEV",
    subdomain: "",
    domain: "",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mountView(gameId: string): GameInfoView {
  const view = document.createElement("game-info-view") as GameInfoView;
  view.gameId = gameId;
  document.body.appendChild(view);
  return view;
}

async function waitForRender(
  view: GameInfoView,
  assertion: () => void,
): Promise<void> {
  await vi.waitFor(async () => {
    await view.updateComplete;
    assertion();
  });
}

describe("GameInfoView", () => {
  let view: GameInfoView | null = null;
  const fetchMock = vi.mocked(fetchGameById);

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(false);
    if (!customElements.get("game-info-view")) {
      customElements.define("game-info-view", GameInfoView);
    }
  });

  afterEach(() => {
    view?.remove();
  });

  it("renders the game summary, controls, and player rows", async () => {
    fetchMock.mockResolvedValue(makeSession("game-1", GameMapType.Montreal));
    view = mountView("game-1");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain(GameMapType.Montreal);
      expect(view!.querySelector("ranking-controls")).not.toBeNull();
      expect(view!.querySelector("section")?.getAttribute("aria-label")).toBe(
        "game_info_modal.survival_time",
      );
      expect(view!.querySelectorAll("player-row")).toHaveLength(1);
    });
  });

  it("shows the game start using the history-card date format", async () => {
    const session = makeSession("game-1", GameMapType.Montreal);
    session.info.start = Date.UTC(2026, 3, 20, 16, 38, 22);
    fetchMock.mockResolvedValue(session);
    view = mountView("game-1");

    const startDate = new Date(session.info.start).toISOString();
    await waitForRender(view, () => {
      const date = view!.querySelector<HTMLTimeElement>(
        "[data-game-date] time",
      );
      expect(date?.dateTime).toBe(startDate);
      expect(date?.textContent).toBe(formatAbsoluteTime(startDate));
    });
  });

  it("uses a translated fallback for an unknown game type", async () => {
    const session = makeSession("game-1", GameMapType.Montreal);
    session.info.config.gameType = "future-game-type" as GameType;
    fetchMock.mockResolvedValue(session);
    view = mountView("game-1");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("game_info_modal.unknown_game_type");
      expect(view!.textContent).not.toContain("future-game-type");
    });
  });

  it("replaces a failed map image with the map fallback", async () => {
    fetchMock.mockResolvedValue(makeSession("game-1", GameMapType.Montreal));
    view = mountView("game-1");

    await waitForRender(view, () => {
      const image = view!.querySelector<HTMLImageElement>("[data-map-image]");
      expect(image?.getAttribute("src")).toBe(
        `/maps/${GameMapType.Montreal}.webp`,
      );
      expect(image?.alt).toBe(GameMapType.Montreal);
      expect(view!.querySelector("[data-map-fallback]")).toBeNull();
    });

    view
      .querySelector<HTMLImageElement>("[data-map-image]")!
      .dispatchEvent(new Event("error"));

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-map-image]")).toBeNull();
      expect(view!.querySelector("[data-map-fallback]")).not.toBeNull();
    });
  });

  it("renders the no-winner state for a game without ranked players", async () => {
    fetchMock.mockResolvedValue(
      makeSession("empty", GameMapType.Montreal, false),
    );
    view = mountView("empty");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("game_info_modal.no_winner");
      expect(view!.querySelector("[data-game-summary]")).not.toBeNull();
      expect(view!.querySelector("player-row")).toBeNull();
    });
  });

  it("renders a fetch error and recovers when Retry succeeds", async () => {
    const retry = deferred<AnalyticsRecord | false>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      fetchMock
        .mockRejectedValueOnce(new Error("network failure"))
        .mockReturnValueOnce(retry.promise);
      view = mountView("retry-game");

      await waitForRender(view, () => {
        expect(view!.textContent).toContain("game_info_modal.load_failed");
        expect(view!.querySelector("button")?.textContent).toContain(
          "game_info_modal.retry",
        );
      });

      const retryButton = view.querySelector("button") as HTMLButtonElement;
      retryButton.click();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(fetchMock).toHaveBeenNthCalledWith(2, "retry-game");

      retry.resolve(makeSession("retry-game", GameMapType.Montreal));
      await retry.promise;
      await waitForRender(view, () => {
        expect(view!.textContent).toContain(GameMapType.Montreal);
        expect(view!.textContent).not.toContain("game_info_modal.load_failed");
        expect(view!.querySelectorAll("player-row")).toHaveLength(1);
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("clears rendered game state when gameId becomes null", async () => {
    fetchMock.mockResolvedValue(makeSession("game-1", GameMapType.Montreal));
    view = mountView("game-1");

    await waitForRender(view, () => {
      expect(view!.querySelectorAll("player-row")).toHaveLength(1);
    });

    view.gameId = null;
    await waitForRender(view, () => {
      const state = view as unknown as {
        gameInfo: AnalyticsRecord["info"] | null;
        rankedPlayers: unknown[];
      };
      expect(view!.textContent?.trim()).toBe("");
      expect(state.gameInfo).toBeNull();
      expect(state.rankedPlayers).toEqual([]);
    });
  });

  it("ignores a pending response after gameId becomes null", async () => {
    const pending = deferred<AnalyticsRecord | false>();
    fetchMock.mockReturnValue(pending.promise);
    view = mountView("pending");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("pending"));

    view.gameId = null;
    await waitForRender(view, () => {
      expect(view!.textContent?.trim()).toBe("");
    });

    pending.resolve(makeSession("pending", GameMapType.Montreal));
    await pending.promise;
    await Promise.resolve();
    await view.updateComplete;

    const state = view as unknown as {
      gameInfo: AnalyticsRecord["info"] | null;
      rankedPlayers: unknown[];
    };
    expect(state.gameInfo).toBeNull();
    expect(state.rankedPlayers).toEqual([]);
    expect(view.textContent?.trim()).toBe("");
  });

  it("refreshes the stats view and translated ranking controls", async () => {
    fetchMock.mockResolvedValue(makeSession("game-1", GameMapType.Montreal));
    view = mountView("game-1");

    await waitForRender(view, () => {
      expect(view!.querySelector("ranking-controls")).not.toBeNull();
    });

    const controls = view.querySelector<
      HTMLElement & { requestUpdate(): void }
    >("ranking-controls")!;
    const viewUpdate = vi.spyOn(view, "requestUpdate");
    const controlsUpdate = vi.spyOn(controls, "requestUpdate");
    const selector = new LangSelector();
    selector.translations = { "main.title": "OpenFront" };
    selector.defaultTranslations = selector.translations;

    (
      selector as unknown as {
        applyTranslation(): void;
      }
    ).applyTranslation();

    expect(viewUpdate).toHaveBeenCalled();
    expect(controlsUpdate).toHaveBeenCalled();
  });

  it("ignores a stale response when a newer game resolves first", async () => {
    const first = deferred<AnalyticsRecord | false>();
    const second = deferred<AnalyticsRecord | false>();
    fetchMock.mockImplementation((gameId) =>
      gameId === "first" ? first.promise : second.promise,
    );

    view = mountView("first");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("first"));

    view.gameId = "second";
    await view.updateComplete;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("second"));

    second.resolve(makeSession("second", GameMapType.Europe));
    await second.promise;
    await waitForRender(view, () => {
      expect(view!.textContent).toContain(GameMapType.Europe);
    });

    first.resolve(makeSession("first", GameMapType.Montreal));
    await first.promise;
    await Promise.resolve();
    await view.updateComplete;

    expect(view.textContent).toContain(GameMapType.Europe);
    expect(view.textContent).not.toContain(GameMapType.Montreal);
  });

  it("renders Hosted visibility badge for a private game with visibleAt", async () => {
    const session = makeSession("hosted-game", GameMapType.Montreal);
    session.info.config.gameType = GameType.Private;
    session.info.visibleAt = 12345;
    fetchMock.mockResolvedValue(session);
    view = mountView("hosted-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("detailed_view.source_hosted");
      expect(view!.textContent).not.toContain(
        "account_modal.games_type_private",
      );
    });
  });

  it("renders Private visibility badge for a private game without visibleAt", async () => {
    const session = makeSession("private-game", GameMapType.Montreal);
    session.info.config.gameType = GameType.Private;
    session.info.visibleAt = undefined;
    fetchMock.mockResolvedValue(session);
    view = mountView("private-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("account_modal.games_type_private");
      expect(view!.textContent).not.toContain("detailed_view.source_hosted");
    });
  });

  it("renders Public visibility badge for a public game", async () => {
    const session = makeSession("public-game", GameMapType.Montreal);
    session.info.config.gameType = GameType.Public;
    fetchMock.mockResolvedValue(session);
    view = mountView("public-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("account_modal.games_type_public");
    });
  });

  it("renders Singleplayer visibility badge for a singleplayer game", async () => {
    const session = makeSession("singleplayer-game", GameMapType.Montreal);
    session.info.config.gameType = GameType.Singleplayer;
    fetchMock.mockResolvedValue(session);
    view = mountView("singleplayer-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain(
        "account_modal.games_type_singleplayer",
      );
    });
  });

  it("uses formatGameType for the mode badge", async () => {
    const session = makeSession("mode-game", GameMapType.Montreal);
    session.info.config.gameMode = GameMode.Team;
    session.info.config.playerTeams = 4;
    fetchMock.mockResolvedValue(session);
    view = mountView("mode-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain(formatGameType(session.info.config));
    });
  });

  it("renders Hosted visibility badge for a private game when visibleAt is 0", async () => {
    const session = makeSession("hosted-zero-game", GameMapType.Montreal);
    session.info.config.gameType = GameType.Private;
    session.info.visibleAt = 0;
    fetchMock.mockResolvedValue(session);
    view = mountView("hosted-zero-game");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("detailed_view.source_hosted");
      expect(view!.textContent).not.toContain(
        "account_modal.games_type_private",
      );
    });
  });

  it("renders notable lobby settings and disabled units when present", async () => {
    const session = makeSession("modifiers-game", GameMapType.Montreal);
    session.info.config.infiniteGold = true;
    session.info.config.disabledUnits = [UnitType.AtomBomb];
    fetchMock.mockResolvedValue(session);
    view = mountView("modifiers-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).not.toBeNull();
      const disabledEl = view!.querySelector("[data-disabled-units]");
      expect(disabledEl).not.toBeNull();
      expect(disabledEl!.classList.contains("mt-3")).toBe(true);
      expect(view!.textContent).toContain("game_settings.infinite_gold");
      expect(view!.textContent).toContain("unit_type.atom_bomb");
    });
  });

  it("renders disabled units without mt-3 when there are no notable settings", async () => {
    const session = makeSession("disabled-only-game", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.disabledUnits = [UnitType.AtomBomb];
    fetchMock.mockResolvedValue(session);
    view = mountView("disabled-only-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).not.toBeNull();
      const disabledEl = view!.querySelector("[data-disabled-units]");
      expect(disabledEl).not.toBeNull();
      expect(disabledEl!.classList.contains("mt-3")).toBe(false);
      expect(view!.textContent).toContain("unit_type.atom_bomb");
    });
  });

  it("renders only notable settings when disabledUnits is empty", async () => {
    const session = makeSession("settings-only-game", GameMapType.Montreal);
    session.info.config.infiniteGold = true;
    session.info.config.disabledUnits = [];
    fetchMock.mockResolvedValue(session);
    view = mountView("settings-only-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).not.toBeNull();
      expect(view!.querySelector("[data-disabled-units]")).toBeNull();
      expect(view!.textContent).toContain("game_settings.infinite_gold");
    });
  });

  it("renders host cheats alongside settings and disabled units when present", async () => {
    const session = makeSession("cheats-game", GameMapType.Montreal);
    session.info.config.infiniteGold = true;
    session.info.config.disabledUnits = [UnitType.AtomBomb];
    session.info.config.hostCheats = { infiniteTroops: true };
    fetchMock.mockResolvedValue(session);
    view = mountView("cheats-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).not.toBeNull();
      const cheatsEl = view!.querySelector("[data-host-cheats]");
      expect(cheatsEl).not.toBeNull();
      expect(cheatsEl!.classList.contains("mt-3")).toBe(true);
      expect(view!.textContent).toContain("game_settings.infinite_troops");
    });
  });

  it("renders modifiers container when host cheats are the only modifier", async () => {
    const session = makeSession("cheats-only-game", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.disabledUnits = [];
    session.info.config.hostCheats = { infiniteGold: true };
    fetchMock.mockResolvedValue(session);
    view = mountView("cheats-only-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).not.toBeNull();
      const cheatsEl = view!.querySelector("[data-host-cheats]");
      expect(cheatsEl).not.toBeNull();
      expect(cheatsEl!.classList.contains("mt-3")).toBe(false);
      expect(view!.querySelector("[data-disabled-units]")).toBeNull();
      expect(view!.querySelector("[data-modifier-tags]")).toBeNull();
      expect(view!.textContent).toContain("game_settings.infinite_gold");
    });
  });

  it("does not render modifiers container when there are none", async () => {
    const session = makeSession("clean-game", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.disabledUnits = [];
    fetchMock.mockResolvedValue(session);
    view = mountView("clean-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).toBeNull();
    });
  });

  it("does not render modifiers container when disabledUnits is undefined and settings are default", async () => {
    const session = makeSession("undefined-disabled", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.disabledUnits = undefined;
    fetchMock.mockResolvedValue(session);
    view = mountView("undefined-disabled");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-modifiers]")).toBeNull();
    });
  });

  it("hides the default gold multiplier and win threshold", async () => {
    const session = makeSession("defaults-game", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.goldMultiplier = 1;
    session.info.config.winThresholdTenths = 800;
    fetchMock.mockResolvedValue(session);
    view = mountView("defaults-game");

    await waitForRender(view, () => {
      expect(view!.querySelector("[data-game-summary]")).not.toBeNull();
      expect(view!.querySelector("[data-game-modifiers]")).toBeNull();
    });
  });

  it("shows a PvP immunity of 0 as 0s", async () => {
    const session = makeSession("no-immunity-game", GameMapType.Montreal);
    session.info.config.bots = 400;
    session.info.config.nations = 0;
    session.info.config.spawnImmunityDuration = 0;
    fetchMock.mockResolvedValue(session);
    view = mountView("no-immunity-game");

    await waitForRender(view, () => {
      expect(
        view!.querySelector("[data-modifier-tags]")?.textContent?.trim(),
      ).toBe("private_lobby.pvp_immunity: 0common.duration_second_short");
    });
  });
});
