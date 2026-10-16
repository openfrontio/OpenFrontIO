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
function userMe(): UserMeResponse {
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
      publicId: "wonder01",
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
});
