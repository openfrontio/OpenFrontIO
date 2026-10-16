import type {
  PublicPlayerGamesResponse,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMeMock = vi.hoisted(() => vi.fn());
const fetchPublicPlayerGamesMock = vi.hoisted(() => vi.fn());

// Mocks as in AccountModalProgression.test.ts, plus the games read.
vi.mock("../../src/client/Api", () => ({
  getUserMe: getUserMeMock,
  invalidateUserMe: vi.fn(),
  claimReward: vi.fn(),
  fetchPlayerById: vi.fn(async () => null),
  fetchPublicPlayerGames: fetchPublicPlayerGamesMock,
  setMarketingConsent: vi.fn(async () => true),
  getApiBase: vi.fn(() => ""),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: vi.fn(async () => false),
  fetchProgressionConfig: vi.fn(async () => false),
}));

vi.mock("../../src/client/Auth", () => ({
  discordLogin: vi.fn(),
  googleLogin: vi.fn(),
  linkGoogle: vi.fn(async () => true),
  linkSteam: vi.fn(async () => true),
  steamLogin: vi.fn(),
  logOut: vi.fn(async () => true),
  reauthAfterPortalChange: vi.fn(async () => false),
  sendMagicLink: vi.fn(async () => true),
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
  getDiscordAvatarUrl: vi.fn(() => null),
  copyToClipboard: vi.fn(),
  renderNumber: vi.fn((n: number) => String(n)),
  getMapName: vi.fn((m: string) => m),
  renderDuration: vi.fn(() => ""),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
    showAuthPrompt: vi.fn(async () => null),
    isAvailable: false,
  },
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics: vi.fn(async () => null),
  translateCosmetic: vi.fn((v: unknown) => v),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerGameHistoryView",
  () => ({}),
);
vi.mock("../../src/client/components/FriendsList", () => ({}));

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
});

import { AccountModal } from "../../src/client/AccountModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };
type CardEl = HTMLElement & { clanTag: string | null };

// Sample data: "Wonder", in AUS, LUX and NU.
function userMe(publicId = "wonder01"): UserMeResponse {
  const clan = (tag: string) => ({
    tag,
    name: `${tag} clan`,
    role: "member",
    joinedAt: "2026-01-01T00:00:00.000Z",
    memberCount: 3,
  });
  return {
    user: { discord: { id: "1", username: "wonder" } },
    player: {
      publicId,
      username: "Wonder",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
      currency: { soft: 100, hard: 10 },
      rewards: [],
      clans: [clan("AUS"), clan("LUX"), clan("NU")],
      progress: {
        prestige: 1,
        level: 42,
        xpInLevel: 40,
        xpForNext: 150,
        lifetimeXp: 260000,
        legend: false,
        canPrestige: false,
      },
    },
  } as unknown as UserMeResponse;
}

const page = (...tags: (string | null)[]): PublicPlayerGamesResponse => ({
  results: tags.map((clanTag, i) => ({
    gameId: `g${i}`,
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
  })),
  nextCursor: null,
});

describe("account profile card clan tag", () => {
  let modal: AccountModal;
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
    getUserMeMock.mockResolvedValue(userMe());
    history.replaceState(null, "", "/");
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
    modalRouter.register("account", {
      tag: "account-modal",
      pageId: "page-account",
    });
    if (!customElements.get("account-modal")) {
      customElements.define("account-modal", AccountModal);
    }
    modal = document.createElement("account-modal") as AccountModal;
    modal.id = "page-account";
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
    vi.useRealTimers();
  });

  it("shows the tag of the latest game under a clan they're still in", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(
      page(null, "OLD", "NU", "LUX"),
    );
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("NU"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledWith("wonder01", {});
  });

  it("shows no tag when no recent game had one of their clans", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null, null));
    modal.open();
    await settle(() => expect(card()).not.toBeNull());
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1),
    );
    expect(card()!.clanTag).toBeNull();
  });

  it("shows the card with no tag until the games arrive", async () => {
    let answer: (res: PublicPlayerGamesResponse) => void = () => {};
    fetchPublicPlayerGamesMock.mockReturnValue(
      new Promise<PublicPlayerGamesResponse>((r) => (answer = r)),
    );
    modal.open();
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
    answer(page("LUX"));
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
  });

  it("reuses the games for a reopening within a minute", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page("AUS"));
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
    modal.close();
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1);
  });

  it("reads them again on an opening after that, picking up a newer game", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    fetchPublicPlayerGamesMock.mockResolvedValue(page("AUS"));
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
    modal.close();
    vi.setSystemTime(new Date("2026-10-16T12:02:00.000Z"));
    fetchPublicPlayerGamesMock.mockResolvedValue(page("LUX", "AUS"));
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(2);
  });

  const historyView = () =>
    modal.querySelector<HTMLElement>("player-game-history-view");

  it("a read still pending for the previous account doesn't hold up the next one", async () => {
    let answerA: (res: PublicPlayerGamesResponse) => void = () => {};
    fetchPublicPlayerGamesMock.mockReturnValueOnce(
      new Promise<PublicPlayerGamesResponse>((r) => (answerA = r)),
    );
    modal.open();
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledWith("wonder01", {}),
    );
    // Another account signs in while the first account's read is in flight.
    getUserMeMock.mockResolvedValue(userMe("nova02"));
    document.dispatchEvent(
      new CustomEvent("userMeResponse", { detail: userMe("nova02") }),
    );
    fetchPublicPlayerGamesMock.mockResolvedValue(page("LUX"));
    modal.close();
    modal.open();
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledWith("nova02", {}),
    );
    answerA(page("AUS"));
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
  });

  it("older games loaded further down the Games tab don't change the tag", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page(null));
    modal.open();
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1),
    );
    await settle(() => expect(card()).not.toBeNull());
    modal.setActiveTab("games");
    await settle(() => expect(historyView()).not.toBeNull());
    // The tab appends an older page with a LUX game.
    historyView()!.dispatchEvent(
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
    modal.setActiveTab("account");
    await settle(() => expect(card()).not.toBeNull());
    expect(card()!.clanTag).toBeNull();
  });

  const cachedGames = () =>
    (
      historyView() as unknown as {
        cachedState?: { games: { gameId: string }[] } | null;
      } | null
    )?.cachedState?.games.map((g) => g.gameId);

  const scrolledHistory = (n: number) => ({
    publicId: "wonder01",
    typeFilter: "all",
    modeFilter: "all",
    games: Array.from({ length: n }, (_, i) => ({
      ...page("AUS").results[0],
      gameId: `s${i}`,
    })),
    nextCursor: "more",
  });

  it("coming back to a scrolled Games tab after a minute keeps the whole list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T12:00:00.000Z"));
    fetchPublicPlayerGamesMock.mockResolvedValue(page("AUS"));
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
    modal.setActiveTab("games");
    await settle(() => expect(historyView()).not.toBeNull());
    // The player scrolled down three pages.
    historyView()!.dispatchEvent(
      new CustomEvent("history-updated", { detail: scrolledHistory(5) }),
    );
    // Away on a game's stats for over a minute, then back.
    vi.setSystemTime(new Date("2026-10-16T12:02:00.000Z"));
    fetchPublicPlayerGamesMock.mockResolvedValue(page("LUX"));
    modal.returnToGames();
    await settle(() =>
      expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(2),
    );
    await settle(() => expect(cachedGames()).toHaveLength(5));
  });

  it("opened on the Games tab, the card takes that tab's first page: no read of its own", async () => {
    modal.open({ tab: "games" });
    await settle(() => expect(historyView()).not.toBeNull());
    expect(fetchPublicPlayerGamesMock).not.toHaveBeenCalled();
    historyView()!.dispatchEvent(
      new CustomEvent("history-updated", {
        detail: {
          publicId: "wonder01",
          typeFilter: "all",
          modeFilter: "all",
          games: page(null, "NU").results,
          nextCursor: null,
        },
      }),
    );
    modal.setActiveTab("account");
    await settle(() => expect(card()?.clanTag).toBe("NU"));
    expect(fetchPublicPlayerGamesMock).not.toHaveBeenCalled();
  });

  it("opened on the Games tab, reads the games itself when the tab didn't give them", async () => {
    fetchPublicPlayerGamesMock.mockResolvedValue(page("LUX"));
    modal.open({ tab: "games" });
    await settle(() => expect(historyView()).not.toBeNull());
    // A filter was picked before the tab's first load landed.
    historyView()!.dispatchEvent(
      new CustomEvent("history-updated", {
        detail: { ...scrolledHistory(1), typeFilter: "public" },
      }),
    );
    modal.setActiveTab("account");
    await settle(() => expect(card()?.clanTag).toBe("LUX"));
    expect(fetchPublicPlayerGamesMock).toHaveBeenCalledTimes(1);
  });
});
