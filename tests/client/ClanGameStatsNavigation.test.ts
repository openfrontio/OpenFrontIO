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

import { apiMockFactory, clanApiMockFactory } from "./clan/ClanModalTestUtils";

vi.mock("../../src/client/Api", () => apiMockFactory());
vi.mock("../../src/client/ClanApi", () => clanApiMockFactory());

vi.mock("../../src/client/ClientEnv", () => ({
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
  showToast: vi.fn(),
  translateText: vi.fn((key: string) => key),
}));

vi.mock("../../src/client/components/CopyButton", () => ({}));

vi.mock("../../src/client/components/baseComponents/stats/GameInfoView", () => {
  class FakeGameInfoView extends HTMLElement {}
  if (!customElements.get("game-info-view")) {
    customElements.define("game-info-view", FakeGameInfoView);
  }
  return { GameInfoView: FakeGameInfoView };
});

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

import { fetchClanGames } from "../../src/client/ClanApi";
import { ClanModal } from "../../src/client/ClanModal";
import { GameStatsModal } from "../../src/client/GameStatsModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";

type ModalShell = HTMLElement & {
  getScrollTop(): number;
  setScrollTop(value: number): void;
  updateComplete: Promise<boolean>;
};

async function waitForClanModal(
  modal: ClanModal,
  assertion: () => void,
): Promise<void> {
  await vi.waitFor(async () => {
    await modal.updateComplete;
    const shell = modal.querySelector("o-modal") as ModalShell | null;
    await shell?.updateComplete;
    const gameHistory = modal.querySelector("clan-game-history-view") as
      | (HTMLElement & { updateComplete: Promise<boolean> })
      | null;
    await gameHistory?.updateComplete;
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

describe("Clan Games stats navigation", () => {
  let modal: ClanModal;
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
    (fetchClanGames as ReturnType<typeof vi.fn>).mockResolvedValue({
      results: [
        {
          gameId: "clan-game-1",
          start: "2026-07-01T12:00:00.000Z",
          durationSeconds: 600,
          map: "World",
          mode: "Team",
          playerTeams: "Duos",
          rankedType: undefined,
          result: "victory",
          totalPlayers: 8,
          clanPlayers: [
            { publicId: "player-1", username: "Player", won: true },
          ],
        },
      ],
      nextCursor: null,
    });
    history.replaceState(null, "", "/");
    modalRouter.register("clan", {
      tag: "clan-modal",
      pageId: "page-clan",
    });
    modalRouter.register("stats", {
      tag: "game-stats-modal",
      pageId: "page-stats",
    });
    if (!customElements.get("clan-modal")) {
      customElements.define("clan-modal", ClanModal);
    }
    if (!customElements.get("game-stats-modal")) {
      customElements.define("game-stats-modal", GameStatsModal);
    }

    modal = document.createElement("clan-modal") as ClanModal;
    modal.id = "page-clan";
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
    window.showPage?.("page-clan");
    modal.open({ clan: "TST" });
    await waitForClanModal(modal, () => {
      const shell = modal.querySelector("o-modal") as ModalShell;
      expect(shell.shadowRoot?.textContent).toContain(
        "clan_modal.tab_game_history",
      );
    });
    modal.setActiveTab("game-history");
    await waitForClanModal(modal, () => {
      expect(modal.querySelector("clan-game-history-view")).not.toBeNull();
      expect(modal.textContent).toContain("game_list.stats");
    });
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    statsModal.remove();
    history.replaceState(null, "", "/");
  });

  it("drills into Stats and returns to the cached clan Games scroll position", async () => {
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
    expect(statsView.gameId).toBe("clan-game-1");
    expect(window.location.hash).toBe("#modal=stats&gameID=clan-game-1");

    const backButton = statsModal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();
    await waitForClanModal(modal, () => {
      expect(modal.isOpen()).toBe(true);
      expect(modal.querySelector("clan-game-history-view")).not.toBeNull();
      expect(shell.getScrollTop()).toBe(420);
    });
    expect(window.location.hash).toBe("#modal=clan&clan=TST&tab=game-history");

    expect(fetchClanGames).toHaveBeenCalledOnce();
  });
});
