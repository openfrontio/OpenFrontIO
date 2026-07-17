import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../src/core/game/Game";
import type { AnalyticsRecord, GameConfig } from "../../src/core/Schemas";

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
import { GameInfoView } from "../../src/client/components/baseComponents/stats/GameInfoView";
import { LangSelector } from "../../src/client/LangSelector";

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
      expect(view!.querySelector("ranking-header")).not.toBeNull();
      expect(view!.querySelectorAll("player-row")).toHaveLength(1);
    });
  });

  it("renders the no-winner state for a game without ranked players", async () => {
    fetchMock.mockResolvedValue(
      makeSession("empty", GameMapType.Montreal, false),
    );
    view = mountView("empty");

    await waitForRender(view, () => {
      expect(view!.textContent).toContain("game_info_modal.no_winner");
      expect(view!.querySelector("player-row")).toBeNull();
    });
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

  it("refreshes the stats view and translated ranking children", async () => {
    fetchMock.mockResolvedValue(makeSession("game-1", GameMapType.Montreal));
    view = mountView("game-1");

    await waitForRender(view, () => {
      expect(view!.querySelector("ranking-controls")).not.toBeNull();
      expect(view!.querySelector("ranking-header")).not.toBeNull();
    });

    const controls = view.querySelector<
      HTMLElement & { requestUpdate(): void }
    >("ranking-controls")!;
    const header = view.querySelector<HTMLElement & { requestUpdate(): void }>(
      "ranking-header",
    )!;
    const viewUpdate = vi.spyOn(view, "requestUpdate");
    const controlsUpdate = vi.spyOn(controls, "requestUpdate");
    const headerUpdate = vi.spyOn(header, "requestUpdate");
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
    expect(headerUpdate).toHaveBeenCalled();
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
});
