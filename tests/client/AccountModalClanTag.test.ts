import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMeMock = vi.hoisted(() => vi.fn());
const fetchPlayerByIdMock = vi.hoisted(() => vi.fn());

// Mocks as in AccountModalProgression.test.ts, plus the games read.
vi.mock("../../src/client/Api", () => ({
  getUserMe: getUserMeMock,
  invalidateUserMe: vi.fn(),
  claimReward: vi.fn(),
  fetchPlayerById: fetchPlayerByIdMock,
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [],
    nextCursor: null,
  })),
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

  it("shows the tag the API picked", async () => {
    fetchPlayerByIdMock.mockResolvedValue({ stats: {}, displayClanTag: "NU" });
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("NU"));
    expect(fetchPlayerByIdMock).toHaveBeenCalledWith("wonder01");
  });

  it("shows no tag when the API has none", async () => {
    fetchPlayerByIdMock.mockResolvedValue({ stats: {}, displayClanTag: null });
    modal.open();
    await settle(() =>
      expect(fetchPlayerByIdMock).toHaveBeenCalledWith("wonder01"),
    );
    await settle(() => expect(card()?.clanTag).toBeNull());
  });

  it("an API without the field shows the first clan, as before", async () => {
    fetchPlayerByIdMock.mockResolvedValue({ stats: {} });
    modal.open();
    await settle(() => expect(card()?.clanTag).toBe("AUS"));
  });
});
