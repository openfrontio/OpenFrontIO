import type {
  PublicPlayerGame,
  PublicPlayerGamesResponse,
} from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicPlayerProfileMock = vi.hoisted(() => vi.fn());
const fetchPublicPlayerGamesMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: fetchPublicPlayerProfileMock,
  fetchPublicPlayerGames: fetchPublicPlayerGamesMock,
  claimReward: vi.fn(),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: vi.fn(async () => ({
    prestige: 1,
    level: 42,
    lifetimeXp: 260000,
    legend: false,
    prestigeHistory: [],
    milestones: [],
  })),
  fetchProgressionConfig: vi.fn(async () => false),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock("../../src/client/ProgressionAccount", () => ({
  resolveXpAccount: vi.fn(async () => ({ kind: "unknown" })),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: vi.fn(() => "w0"),
    shareOrigin: vi.fn(() => window.location.origin),
    shareBase: vi.fn(
      () => `${window.location.origin}${window.location.pathname}`,
    ),
  },
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
  copyToClipboard: vi.fn(),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
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

import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };
type CardEl = HTMLElement & { clanTag: string | null };

// Sample data: "Wonder", in AUS, LUX and NU.
const clan = (tag: string) => ({
  tag,
  name: `${tag} clan`,
  role: "member",
  joinedAt: "2026-01-01T00:00:00.000Z",
  memberCount: 3,
});

function game(id: string, clanTag: string | null): PublicPlayerGame {
  return {
    gameId: id,
    start: "2026-10-01T12:00:00.000Z",
    durationSeconds: 600,
    map: "World",
    mode: "Free For All",
    type: "public",
    playerTeams: null,
    rankedType: "unranked",
    result: "victory",
    totalPlayers: 20,
    username: "Wonder",
    clanTag,
  };
}

const page = (...tags: (string | null)[]): PublicPlayerGamesResponse => ({
  results: tags.map((t, i) => game(`g${i}`, t)),
  nextCursor: null,
});

describe("player profile card clan tag", () => {
  let modal: PlayerProfileModal;
  let playPage: HTMLElement;

  async function settle(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await modal.updateComplete;
      await (modal.querySelector("o-modal") as ModalShell | null)
        ?.updateComplete;
      assertion();
    });
  }

  const card = () => modal.querySelector<CardEl>("profile-card");

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchPublicPlayerProfileMock.mockResolvedValue({
      createdAt: "2026-01-01T00:00:00.000Z",
      username: "Wonder",
      stats: {},
      clans: [clan("AUS"), clan("LUX"), clan("NU")],
    });
    history.replaceState(null, "", "/");
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    if (!customElements.get("player-profile-modal")) {
      customElements.define("player-profile-modal", PlayerProfileModal);
    }
    modal = document.createElement(
      "player-profile-modal",
    ) as PlayerProfileModal;
    modal.id = "page-profile";
    modal.setAttribute("inline", "");
    modal.className = "hidden page-content";
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    playPage.remove();
    history.replaceState(null, "", "/");
  });

  it("shows the tag of the latest game under a clan they're still in", async () => {
    // Newest first: untagged, a clan they've left, then LUX.
    fetchPublicPlayerGamesMock.mockResolvedValue(
      page(null, "OLD", "LUX", "AUS"),
    );
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
  });

  it("shows no tag when no recent game had one of their clans", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null, "OLD", null));
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
  });

  it("shows the card with no tag until the games arrive", async () => {
    let answer: (res: PublicPlayerGamesResponse) => void = () => {};
    fetchPublicPlayerGamesMock.mockReturnValue(
      new Promise<PublicPlayerGamesResponse>((r) => (answer = r)),
    );
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
    answer(page("NU"));
    await settle(() => expect(card()?.clanTag).toBe("NU"));
  });

  it("makes no extra request: the Games tab reuses the same page", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page("AUS"));
    modal.open({ publicID: "wonder01" });
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
    modal.setActiveTab("games");
    await settle(() => {
      expect(modal.querySelector("player-game-history-view")).not.toBeNull();
      expect(
        modal.querySelector("player-game-history-view")?.textContent,
      ).toContain("World");
    });
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1);
  });

  it("opened on the Games tab, takes the tag from that tab's own request", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null, "LUX"));
    modal.open({ publicID: "wonder01", tab: "games" });
    await settle(() =>
      expect(
        modal.querySelector("player-game-history-view")?.textContent,
      ).toContain("World"),
    );
    modal.setActiveTab("stats");
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1);
  });

  it("reopening the same player left on the Games tab still finds the tag", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null, "LUX"));
    modal.open({ publicID: "wonder01", tab: "games" });
    await settle(() =>
      expect(
        modal.querySelector("player-game-history-view")?.textContent,
      ).toContain("World"),
    );
    modal.close();
    // The Games tab stays mounted for the same player, so it won't load again:
    // the card needs its own read this time.
    modal.open({ publicID: "wonder01" });
    modal.setActiveTab("stats");
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
  });

  it("older games loaded further down the Games tab don't change the tag", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null));
    modal.open({ publicID: "wonder01" });
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1),
    );
    await settle(() => expect(card()).not.toBeNull());
    modal.setActiveTab("games");
    await settle(() =>
      expect(modal.querySelector("player-game-history-view")).not.toBeNull(),
    );
    modal.querySelector("player-game-history-view")!.dispatchEvent(
      new CustomEvent("history-updated", {
        detail: {
          publicId: "wonder01",
          typeFilter: "all",
          modeFilter: "all",
          games: [...page(null).results, ...page("LUX").results],
          nextCursor: null,
        },
      }),
    );
    modal.setActiveTab("stats");
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
  });

  it("a reopening still on the Games tab reads the games once, for the card and the tab", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null, "LUX"));
    modal.open({ publicID: "wonder01", tab: "games" });
    const view = () => modal.querySelector("player-game-history-view");
    await settle(() => expect(view()?.textContent).toContain("World"));
    modal.close();
    const newer = page("NU");
    newer.results[0] = { ...newer.results[0], gameId: "g-new", map: "Africa" };
    fetchPublicPlayerGamesMock.mockResolvedValue(newer);
    // Still on the Games tab, mounted for the same player: it won't load
    // again, so the card reads the games itself.
    modal.open({ publicID: "wonder01" });
    modal.setActiveTab("stats");
    await settle(() => expect(card()?.clanTag).toBe("NU"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(2);
  });

  it("opened on the Games tab, still finds the tag when that tab's load fails", async () => {
    fetchPublicPlayerGamesMock
      .mockResolvedValueOnce({ error: "network" })
      .mockResolvedValue(page(null, "LUX"));
    modal.open({ publicID: "wonder01", tab: "games" });
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1),
    );
    modal.setActiveTab("stats");
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(2);
  });
});
