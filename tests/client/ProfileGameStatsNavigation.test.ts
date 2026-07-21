import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string, onSuccess?: () => void) => onSuccess?.()),
);

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: vi.fn(async () => ({
    createdAt: "2026-01-01T00:00:00.000Z",
    stats: { Public: { "Free For All": {} } },
  })),
  fetchPublicPlayerGames: vi.fn(),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: { workerPath: vi.fn(() => "w0") },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({ webpPath: "/maps/world.webp" })),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  getMapName: vi.fn((name: string) => name),
  renderDuration: vi.fn((seconds: number) => `${seconds}s`),
  translateText: vi.fn((key: string) => key),
  copyToClipboard: copyToClipboardMock,
}));

vi.mock("../../src/client/components/baseComponents/stats/GameInfoView", () => {
  class FakeGameInfoView extends HTMLElement {}
  if (!customElements.get("game-info-view")) {
    customElements.define("game-info-view", FakeGameInfoView);
  }
  return { GameInfoView: FakeGameInfoView };
});

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => {
    class FakePlayerStatsTreeView extends HTMLElement {}
    if (!customElements.get("player-stats-tree-view")) {
      customElements.define("player-stats-tree-view", FakePlayerStatsTreeView);
    }
    return { PlayerStatsTreeView: FakePlayerStatsTreeView };
  },
);

class FakeIntersectionObserver {
  constructor(_callback: IntersectionObserverCallback) {}
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

import { fetchPublicPlayerGames } from "../../src/client/Api";
import { GameStatsModal } from "../../src/client/GameStatsModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";
import {
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { setup } from "../util/Setup";

type ModalShell = HTMLElement & {
  getScrollTop(): number;
  setScrollTop(value: number): void;
  updateComplete: Promise<boolean>;
};

async function waitForProfile(
  modal: PlayerProfileModal,
  assertion: () => void,
): Promise<void> {
  await vi.waitFor(async () => {
    await modal.updateComplete;
    const shell = modal.querySelector("o-modal") as ModalShell | null;
    await shell?.updateComplete;
    const history = modal.querySelector("player-game-history-view") as
      | (HTMLElement & { updateComplete: Promise<boolean> })
      | null;
    await history?.updateComplete;
    assertion();
  });
}

async function waitForStatsModal(
  modal: GameStatsModal,
  assertion: () => void,
): Promise<void> {
  await vi.waitFor(async () => {
    await modal.updateComplete;
    const shell = modal.querySelector("o-modal") as ModalShell | null;
    await shell?.updateComplete;
    assertion();
  });
}

describe("Profile Games stats navigation", () => {
  let modal: PlayerProfileModal;
  let statsModal: GameStatsModal;
  let playPage: HTMLElement;

  beforeAll(() => {
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
  });

  afterAll(() => {
    playPage.remove();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const game = await setup(
      "world",
      {
        gameMap: GameMapType.World,
        gameMode: GameMode.FFA,
        gameType: GameType.Public,
      },
      [new PlayerInfo("Player", PlayerType.Human, null, "player-1")],
    );
    const player = game.player("player-1");
    game.setWinner(player, game.stats().stats());
    const gameConfig = game.config().gameConfig();
    vi.mocked(fetchPublicPlayerGames).mockResolvedValue({
      results: [
        {
          gameId: "game-1",
          start: "2026-07-01T12:00:00.000Z",
          durationSeconds: game.elapsedGameSeconds(),
          map: gameConfig.gameMap,
          mode: gameConfig.gameMode,
          type: gameConfig.gameType.toLowerCase(),
          playerTeams: gameConfig.playerTeams?.toString() ?? null,
          rankedType: gameConfig.rankedType ?? "",
          result: game.getWinner() === player ? "victory" : "defeat",
          totalPlayers: game.players().length,
          username: player.name(),
          clanTag: player.info().clanTag,
        },
      ],
      nextCursor: null,
    });
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    history.replaceState(null, "", "/");
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    modalRouter.register("stats", {
      tag: "game-stats-modal",
      pageId: "page-stats",
    });
    if (!customElements.get("player-profile-modal")) {
      customElements.define("player-profile-modal", PlayerProfileModal);
    }
    if (!customElements.get("game-stats-modal")) {
      customElements.define("game-stats-modal", GameStatsModal);
    }

    modal = document.createElement(
      "player-profile-modal",
    ) as PlayerProfileModal;
    modal.id = "page-profile";
    modal.setAttribute("inline", "");
    modal.className = "hidden page-content";
    document.body.appendChild(modal);

    statsModal = document.createElement("game-stats-modal") as GameStatsModal;
    statsModal.id = "page-stats";
    statsModal.setAttribute("inline", "");
    statsModal.className = "hidden page-content";
    document.body.appendChild(statsModal);

    await modal.updateComplete;
    await statsModal.updateComplete;

    history.replaceState(null, "", "/#modal=profile&publicID=player-1");
    expect(modalRouter.routeFromHash()).toBe(true);
    await waitForProfile(modal, () => {
      expect(modal.isOpen()).toBe(true);
    });

    modal.setActiveTab("games");
    await waitForProfile(modal, () => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
    });
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    statsModal.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("drills into Stats and returns to the cached Games scroll position", async () => {
    const shell = modal.querySelector("o-modal") as ModalShell;
    shell.setScrollTop(420);

    const statsButton = Array.from(modal.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "game_list.stats",
    );
    expect(statsButton).toBeTruthy();
    statsButton!.click();
    await waitForStatsModal(statsModal, () => {
      expect(statsModal.isOpen()).toBe(true);
      expect(statsModal.querySelector("game-info-view")).not.toBeNull();
    });

    expect(modal.isOpen()).toBe(false);
    const statsView = statsModal.querySelector(
      "game-info-view",
    ) as HTMLElement & { gameId: string };
    expect(statsView.gameId).toBe("game-1");
    expect(window.location.hash).toBe("#modal=stats&gameID=game-1");

    const backButton = statsModal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();
    await waitForProfile(modal, () => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
      expect(shell.getScrollTop()).toBe(420);
    });
    expect(window.location.hash).toBe(
      "#modal=profile&publicID=player-1&tab=games",
    );

    // History wasn't refetched on return — the cached list was reused.
    expect(fetchPublicPlayerGames).toHaveBeenCalledOnce();
  });

  it("reloads the games history when the route changes to a different player", async () => {
    // beforeEach opened player-1's history.
    expect(fetchPublicPlayerGames).toHaveBeenCalledWith(
      "player-1",
      expect.anything(),
    );

    // Editing the hash to a different player re-routes the already-open modal.
    // Lit reuses the mounted history view, so it must load the new player's
    // games rather than keep showing player-1's.
    history.replaceState(
      null,
      "",
      "/#modal=profile&publicID=player-2&tab=games",
    );
    expect(modalRouter.routeFromHash()).toBe(true);

    await waitForProfile(modal, () => {
      expect(fetchPublicPlayerGames).toHaveBeenCalledWith(
        "player-2",
        expect.anything(),
      );
    });
  });

  it("resets filters to the default view when the route changes players", async () => {
    // Pick a non-default type filter on player-1 (translateText is mocked to
    // echo the key, so the Private tab's text is its label key).
    const privateTab = Array.from(modal.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "account_modal.games_type_private",
    );
    expect(privateTab).toBeTruthy();
    privateTab!.click();
    await waitForProfile(modal, () => {
      const call = vi
        .mocked(fetchPublicPlayerGames)
        .mock.calls.find(
          (c) => c[0] === "player-1" && c[1]?.type === "private",
        );
      expect(call).toBeTruthy();
    });

    // Routing to a different player must fall back to the default (All) view
    // rather than inheriting player-1's Private filter.
    history.replaceState(
      null,
      "",
      "/#modal=profile&publicID=player-2&tab=games",
    );
    expect(modalRouter.routeFromHash()).toBe(true);

    await waitForProfile(modal, () => {
      const player2Calls = vi
        .mocked(fetchPublicPlayerGames)
        .mock.calls.filter((c) => c[0] === "player-2");
      // Every player-2 request (there should only be the one reset reload) must
      // drop player-1's filters — asserting across all of them catches a stale
      // first request even if a later one happens to be clean.
      expect(player2Calls.length).toBeGreaterThan(0);
      for (const [, opts] of player2Calls) {
        expect(opts?.type).toBeUndefined();
        expect(opts?.filter).toBeUndefined();
      }
    });
  });
});
