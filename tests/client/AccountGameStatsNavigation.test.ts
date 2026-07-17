import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  fetchPlayerById: vi.fn(async () => ({ stats: {} })),
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [
      {
        gameId: "game-1",
        start: "2026-07-01T12:00:00.000Z",
        durationSeconds: 600,
        map: "World",
        mode: "FFA",
        type: "public",
        playerTeams: null,
        rankedType: "",
        result: "victory",
        totalPlayers: 8,
        username: "Player",
        clanTag: null,
      },
    ],
    nextCursor: null,
  })),
  getUserMe: vi.fn(async () => ({
    user: { email: "player@example.com" },
    player: {
      publicId: "player-1",
      friends: [],
      rewards: [],
      clans: [],
      clanRequests: [],
    },
  })),
  invalidateUserMe: vi.fn(),
  setMarketingConsent: vi.fn(async () => true),
}));

vi.mock("../../src/client/Auth", () => ({
  discordLogin: vi.fn(),
  googleLogin: vi.fn(),
  linkGoogle: vi.fn(),
  logOut: vi.fn(),
  reauthAfterCrazyGamesChange: vi.fn(),
  sendMagicLink: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    getUserProfile: vi.fn(async () => null),
    isOnCrazyGames: vi.fn(() => false),
  },
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
}));

vi.mock("../../src/client/components/baseComponents/stats/GameInfoView", () => {
  class FakeGameInfoView extends HTMLElement {}
  if (!customElements.get("game-info-view")) {
    customElements.define("game-info-view", FakeGameInfoView);
  }
  return { GameInfoView: FakeGameInfoView };
});

vi.mock(
  "../../src/client/components/baseComponents/stats/DiscordUserHeader",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTable",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);
vi.mock("../../src/client/components/CopyButton", () => ({}));
vi.mock("../../src/client/components/CurrencyDisplay", () => ({}));
vi.mock("../../src/client/components/Difficulties", () => ({}));
vi.mock("../../src/client/components/FriendsList", () => ({}));
vi.mock("../../src/client/components/RewardsPanel", () => ({}));
vi.mock("../../src/client/components/SubscriptionPanel", () => ({}));

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

import { AccountModal } from "../../src/client/AccountModal";
import { fetchPublicPlayerGames } from "../../src/client/Api";
import { modalRouter } from "../../src/client/ModalRouter";

type ModalShell = HTMLElement & {
  getScrollTop(): number;
  setScrollTop(value: number): void;
  updateComplete: Promise<boolean>;
};

async function waitForModal(
  modal: AccountModal,
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

describe("Account Games stats navigation", () => {
  let modal: AccountModal;

  beforeEach(async () => {
    vi.clearAllMocks();
    history.replaceState(null, "", "/");
    modalRouter.register("account", { tag: "account-modal" });
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    modal = document.createElement("account-modal") as AccountModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
    modal.open();
    await waitForModal(modal, () => {
      const shell = modal.querySelector("o-modal") as ModalShell;
      expect(shell.shadowRoot?.textContent).toContain(
        "account_modal.tab_games",
      );
    });
    modal.setActiveTab("games");
    await waitForModal(modal, () => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
    });
  });

  afterEach(() => {
    modal.close();
    modal.remove();
    history.replaceState(null, "", "/");
  });

  it("drills into Stats and returns to the cached Games scroll position", async () => {
    const shell = modal.querySelector("o-modal") as ModalShell;
    shell.setScrollTop(420);

    const statsButton = Array.from(modal.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "game_list.stats",
    );
    expect(statsButton).toBeTruthy();
    statsButton!.click();
    await waitForModal(modal, () => {
      expect(modal.querySelector("game-info-view")).not.toBeNull();
    });

    expect(modal.textContent).toContain("game_list.stats");
    const statsView = modal.querySelector("game-info-view") as HTMLElement & {
      gameId: string;
    };
    expect(statsView.gameId).toBe("game-1");
    expect(shell.shadowRoot?.querySelector('[role="tablist"]')).toBeNull();
    expect(shell.getScrollTop()).toBe(0);
    expect(window.location.hash).toBe("#modal=account&gameID=game-1");

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();
    await waitForModal(modal, () => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
      expect(shell.getScrollTop()).toBe(420);
    });
    expect(window.location.hash).toBe("#modal=account&tab=games");

    expect(fetchPublicPlayerGames).toHaveBeenCalledOnce();
  });

  it("opens a gameID route directly and returns to Games", async () => {
    modal.setActiveTab("account");
    modal.close();
    modal.open({ gameID: "game-1" });

    await waitForModal(modal, () => {
      const statsView = modal.querySelector("game-info-view") as
        | (HTMLElement & { gameId: string })
        | null;
      expect(statsView?.gameId).toBe("game-1");
    });
    expect(window.location.hash).toBe("#modal=account&gameID=game-1");

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    await waitForModal(modal, () => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
    });
    expect(window.location.hash).toBe("#modal=account&tab=games");
  });
});
