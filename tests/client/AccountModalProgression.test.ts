import type {
  PublicProgress,
  Reward,
  UserMeResponse,
} from "@openfront/shared/ApiSchemas";
import { ProgressionConfigSchema } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserMeMock = vi.hoisted(() => vi.fn());
const claimRewardMock = vi.hoisted(() => vi.fn());
const fetchPublicPlayerProgressMock = vi.hoisted(() => vi.fn());
const fetchPlayerByIdMock = vi.hoisted(() =>
  vi.fn(async (): Promise<unknown> => null),
);
const reducedMotion = vi.hoisted(() => ({ value: false }));

// Mocks as in AccountModalPrestige.test.ts, plus the progression reads.
vi.mock("../../src/client/Api", () => ({
  getUserMe: getUserMeMock,
  invalidateUserMe: vi.fn(),
  claimReward: claimRewardMock,
  fetchPlayerById: fetchPlayerByIdMock,
  setMarketingConsent: vi.fn(async () => true),
  getApiBase: vi.fn(() => ""),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: fetchPublicPlayerProgressMock,
  fetchProgressionConfig: vi.fn(async () => config()),
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

vi.mock("../../src/client/utilities/ReducedMotion", () => ({
  prefersReducedMotion: () => reducedMotion.value,
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

// The tab fetches the reward track's code when it first opens; loaded up
// front here so the waits below are about the tab, not the test's
// first-time transform of that module.
import { AccountModal } from "../../src/client/AccountModal";
import { invalidateUserMe } from "../../src/client/Api";
import { ProfileProgression } from "../../src/client/components/ProfileProgression";
import "../../src/client/components/RewardTrack";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import {
  PENDING_XP_KEY,
  runCheck,
  startProvisionalProgress,
  stopProvisionalProgress,
} from "../../src/client/ProvisionalProgress";

// A track with Caps at every level.
function config() {
  return ProgressionConfigSchema.parse({
    version: 3,
    maxLevel: 100,
    maxPrestige: 10,
    levels: Array.from({ length: 100 }, (_, i) => ({
      level: i + 1,
      xpToNext: 100,
      cumulativeXp: 0,
      caps: i === 0 ? 0 : 50,
    })),
  });
}

const OWN_PROGRESS = {
  prestige: 2,
  level: 47,
  xpInLevel: 40,
  xpForNext: 150,
  lifetimeXp: 300000,
  legend: false,
  canPrestige: false,
};

// The public read: the same level, with the history and milestones.
const PUBLIC: PublicProgress = {
  prestige: 2,
  level: 47,
  lifetimeXp: 300000,
  legend: false,
  prestigeHistory: [
    { rank: 1, at: "2026-09-06T00:00:00.000Z" },
    { rank: 2, at: "2026-09-19T00:00:00.000Z" },
  ],
  milestones: [{ prestige: 2, level: 10, at: "2026-09-20T00:00:00.000Z" }],
};

function reward(id: string, extra: Partial<Reward> = {}): Reward {
  return {
    id,
    currencyType: "soft",
    amount: "50",
    reason: "level_up",
    note: null,
    ...extra,
  };
}

// L45-47 unclaimed on this run, and a win's Caps the track leaves alone.
function ownRewards(): Reward[] {
  return [
    reward("l45", { level: 45, prestige: 2 }),
    reward("l46", { level: 46, prestige: 2 }),
    reward("l47", { level: 47, prestige: 2 }),
    reward("win", { reason: "game_win", amount: "75" }),
  ];
}

function userMe(
  progress: typeof OWN_PROGRESS | undefined,
  rewards: Reward[] = ownRewards(),
): UserMeResponse {
  return {
    user: { discord: { id: "1", username: "lewis" } },
    player: {
      publicId: "me",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      subscription: null,
      currency: { soft: 100, hard: 10 },
      progress,
      rewards,
    },
  } as unknown as UserMeResponse;
}

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

describe("AccountModal — Progression tab", () => {
  let modal: AccountModal;
  let playPage: HTMLElement;
  let me: UserMeResponse;
  let broadcasts: UserMeResponse[];
  const onUserMe = (e: Event) =>
    broadcasts.push((e as CustomEvent<UserMeResponse>).detail);

  async function settle(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await modal.updateComplete;
      const shell = modal.querySelector("o-modal") as ModalShell | null;
      await shell?.updateComplete;
      await modal.querySelector<ProfileProgression>("profile-progression")
        ?.updateComplete;
      assertion();
    });
  }

  const tabText = () =>
    (modal.querySelector("o-modal") as ModalShell).shadowRoot?.textContent ??
    "";
  const progression = () =>
    modal.querySelector<ProfileProgression>("profile-progression");
  const own = () =>
    (modal as unknown as { userMeResponse: UserMeResponse }).userMeResponse;

  async function openOnProgression(): Promise<ProfileProgression> {
    modal.open({ tab: "progression" });
    await settle(() => {
      expect(
        progression()?.querySelector("[data-track-claim]") ?? null,
      ).not.toBe(null);
    });
    // orderPop runs after the track's own render.
    await new Promise((r) => setTimeout(r, 0));
    return progression()!;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    reducedMotion.value = false;
    me = userMe(OWN_PROGRESS);
    getUserMeMock.mockImplementation(async () => me);
    fetchPublicPlayerProgressMock.mockResolvedValue(PUBLIC);
    claimRewardMock.mockImplementation(async () => ({
      currency: { soft: 250, hard: 10 },
    }));
    broadcasts = [];
    document.addEventListener("userMeResponse", onUserMe);
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
    document.removeEventListener("userMeResponse", onUserMe);
    window.showPage?.("page-play");
    modal.remove();
    playPage.remove();
    history.replaceState(null, "", "/");
    vi.restoreAllMocks();
  });

  it("adds the tab after Games, before Friends, for a player with a level", async () => {
    modal.open();
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_progression");
    });
    const text = tabText();
    expect(text.indexOf("account_modal.tab_games")).toBeLessThan(
      text.indexOf("account_modal.tab_progression"),
    );
    expect(text.indexOf("account_modal.tab_progression")).toBeLessThan(
      text.indexOf("account_modal.tab_friends"),
    );
    // Nothing read until the tab shows.
    expect(fetchPublicPlayerProgressMock).not.toHaveBeenCalled();
  });

  it("has no tab for a player without a level (progression off)", async () => {
    me = userMe(undefined);
    modal.open({ tab: "progression" });
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_friends");
    });
    expect(tabText()).not.toContain("account_modal.tab_progression");
    // Asked for, it isn't there: the account shows instead.
    expect(progression()).toBeNull();
    expect(modal.querySelector("discord-user-header")).not.toBeNull();
    expect(fetchPublicPlayerProgressMock).not.toHaveBeenCalled();
  });

  it("shows the player's own track, with its claim bar, history and milestones", async () => {
    const el = await openOnProgression();
    expect(fetchPublicPlayerProgressMock).toHaveBeenCalledWith("me");
    expect(el.publicId).toBe("me");
    // The owner's view: claim status, and Claim all for the three levels.
    expect(el.querySelector("[data-track-claim]")).not.toBeNull();
    expect(el.querySelectorAll(`[data-status="ready"]`)).toHaveLength(3);
    expect(el.querySelectorAll("[data-prestige-tile]")).toHaveLength(2);
    expect(el.querySelector("[data-current-run]")).not.toBeNull();
  });

  it("Claim all updates the account and tells the page", async () => {
    const el = await openOnProgression();
    const after = ownRewards().filter((r) => r.id === "win");
    // The account as the API has it after the claims.
    me = userMe(OWN_PROGRESS, after);
    me.player.currency = { soft: 250, hard: 10 };
    vi.mocked(invalidateUserMe).mockClear();

    el.querySelector<HTMLElement>("[data-claim-all]")!.click();
    await vi.waitFor(() => expect(broadcasts).toHaveLength(1));
    expect(claimRewardMock.mock.calls.map((c) => c[0])).toEqual([
      "l45",
      "l46",
      "l47",
    ]);
    // /users/@me read afresh and handed to the page (the header's menu).
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(broadcasts[0].player.rewards).toEqual(after);
    // The account's own copy: the rewards list and the balances.
    expect(own().player.rewards?.map((r) => r.id)).toEqual(["win"]);
    expect(own().player.currency).toEqual({ soft: 250, hard: 10 });

    // The track shows them claimed.
    await settle(() => {
      expect(el.querySelector("[data-track-claim]")).toBeNull();
    });
    expect(el.querySelector(`[data-status="ready"]`)).toBeNull();

    // And the Account tab's rewards list has only the win left.
    modal.setActiveTab("account");
    await settle(() => {
      const panel = modal.querySelector("rewards-panel") as unknown as {
        rewards: Reward[];
      } | null;
      expect(panel?.rewards.map((r) => r.id)).toEqual(["win"]);
    });
  });

  it("leaves held rewards pending, as on the profile", async () => {
    me = userMe(
      OWN_PROGRESS,
      ownRewards().map((r) => (r.id === "l46" ? { ...r, held: "trust" } : r)),
    );
    const el = await openOnProgression();
    // Two ready; the held one isn't offered.
    expect(el.querySelectorAll(`[data-status="ready"]`)).toHaveLength(2);
    el.querySelector<HTMLElement>("[data-claim-all]")!.click();
    await vi.waitFor(() => expect(broadcasts).toHaveLength(1));
    expect(claimRewardMock.mock.calls.map((c) => c[0])).toEqual(["l45", "l47"]);
    expect(own().player.rewards?.find((r) => r.id === "l46")?.held).toBe(
      "trust",
    );
  });

  it("shows the rest without the track when the track can't be fetched", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The element the modal renders fetches the track in its first update
    // (willUpdate): make that fetch fail. (Not connectedCallback: the
    // registry keeps the one the element was defined with.)
    const proto = ProfileProgression.prototype as unknown as {
      willUpdate(changed: unknown): void;
    };
    const willUpdate = proto.willUpdate;
    vi.spyOn(proto, "willUpdate").mockImplementation(function (
      this: ProfileProgression,
      changed: unknown,
    ) {
      this.loadTrackModule = () => Promise.reject(new Error("offline"));
      willUpdate.call(this, changed);
    });
    modal.open({ tab: "progression" });
    await settle(() => {
      expect(
        progression()?.querySelector("[data-milestones]") ?? null,
      ).not.toBeNull();
    });
    expect(progression()!.querySelector("[data-prestige-history]")).not.toBe(
      null,
    );
    expect(progression()!.querySelector("reward-track")).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "ProfileProgression: reward track failed to load",
      expect.any(Error),
    );
  });

  it("pops in once per opening, not again on switching back", async () => {
    expect((await openOnProgression()).classList.contains("pp-anim")).toBe(
      true,
    );
    modal.setActiveTab("stats");
    await settle(() => expect(progression()).toBeNull());
    modal.setActiveTab("progression");
    await settle(() => {
      expect(
        progression()?.querySelector("[data-milestones]") ?? null,
      ).not.toBeNull();
    });
    expect(progression()!.classList.contains("pp-anim")).toBe(false);

    // A new opening pops in again, with the progress read afresh.
    modal.close();
    fetchPublicPlayerProgressMock.mockClear();
    expect((await openOnProgression()).classList.contains("pp-anim")).toBe(
      true,
    );
    expect(fetchPublicPlayerProgressMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't pop in for a player who asked for less motion", async () => {
    reducedMotion.value = true;
    const el = await openOnProgression();
    expect(el.classList.contains("pp-anim")).toBe(false);
  });

  it("falls back to the account's own level when the public read fails", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    modal.open({ tab: "progression" });
    await settle(() => {
      expect(
        progression()?.querySelector("[data-milestones]") ?? null,
      ).not.toBeNull();
    });
    // Both ranks still show, undated.
    expect(
      progression()!.querySelectorAll("[data-prestige-tile]"),
    ).toHaveLength(2);
    expect(progression()!.querySelector("[data-date]")).toBeNull();
  });

  it("puts the profile's displayClanTag on the account card", async () => {
    // AUS sorts first in the clans list, which the card used to show.
    const clan = (tag: string) => ({
      tag,
      name: `${tag} clan`,
      role: "member",
      joinedAt: "2026-01-01T00:00:00.000Z",
      memberCount: 3,
    });
    me = {
      ...me,
      player: { ...me.player!, clans: [clan("AUS"), clan("LUX")] },
    } as UserMeResponse;
    fetchPlayerByIdMock.mockResolvedValueOnce({
      createdAt: "2026-01-01T00:00:00.000Z",
      stats: {},
      clans: [clan("AUS"), clan("LUX")],
      displayClanTag: "LUX",
    });
    modal.open();
    await settle(() => {
      expect(
        modal.querySelector<HTMLElement & { clanTag: string | null }>(
          "profile-card",
        )?.clanTag,
      ).toBe("LUX");
    });
    expect(fetchPlayerByIdMock).toHaveBeenCalledWith("me");
  });

  it("opens on the tab from a link", async () => {
    history.replaceState(null, "", "/#modal=account&tab=progression");
    expect(modalRouter.routeFromHash()).toBe(true);
    await settle(() => {
      expect(
        progression()?.querySelector("[data-milestones]") ?? null,
      ).not.toBeNull();
    });
    expect(window.location.hash).toBe("#modal=account&tab=progression");
  });

  it("writes the tab to the link when it's picked", async () => {
    modal.open();
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_progression");
    });
    modal.setActiveTab("progression");
    expect(window.location.hash).toBe("#modal=account&tab=progression");
  });

  // A game the player died in, still waiting to be scored: 250 XP on top of
  // L47 at 40 (100 a level here) is L49 at 90, shown provisionally.
  describe("with XP still waiting to be scored", () => {
    // The public read with the place in the level, as the API sends it.
    const PUBLIC_WITH_XP: PublicProgress = {
      ...PUBLIC,
      xpInLevel: 40,
      xpForNext: 150,
    };

    beforeEach(() => {
      vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
        key === PENDING_XP_KEY
          ? JSON.stringify({
              me: [{ gameId: "g1", xp: 250, at: Date.now(), notIn: 300000 }],
            })
          : null,
      );
      fetchPublicPlayerProgressMock.mockResolvedValue(PUBLIC_WITH_XP);
      startProvisionalProgress({
        fetchXp: async () => ({ status: "pending", notFound: true }),
        loadConfig: async () => config(),
        refreshUserMe: async () => undefined,
      });
      document.dispatchEvent(new CustomEvent("userMeResponse", { detail: me }));
    });

    afterEach(() => {
      stopProvisionalProgress();
      vi.mocked(localStorage.getItem).mockImplementation(() => null);
    });

    type CardEl = HTMLElement & {
      progress: { level: number; xpInLevel: number; canPrestige?: boolean };
      provisional: boolean;
    };

    it("shows the projected level on the account card, marked provisional", async () => {
      await runCheck();
      modal.open();
      await settle(() => {
        const card = modal.querySelector<CardEl>("profile-card");
        expect(card?.provisional).toBe(true);
        expect(card?.progress.level).toBe(49);
        expect(card?.progress.xpInLevel).toBe(90);
      });
      // Never offers Prestige on a provisional level.
      expect(
        modal.querySelector<CardEl>("profile-card")!.progress.canPrestige,
      ).toBe(false);
    });

    it('puts "You" on the projected level, with the levels past the confirmed one pending', async () => {
      await runCheck();
      modal.open({ tab: "progression" });
      await settle(() => {
        const el = progression();
        expect(el?.confirmedLevel).toBe(47);
        expect(el?.querySelector('[data-level="49"][data-current]')).not.toBe(
          null,
        );
      });
      const el = progression()!;
      expect(
        el.querySelector('[data-level="48"]')!.getAttribute("data-status"),
      ).toBe("pending");
      expect(
        el.querySelector('[data-level="49"]')!.getAttribute("data-status"),
      ).toBe("pending");
      // The confirmed levels' rewards are still the only ones to claim.
      expect(el.querySelectorAll('[data-status="ready"]')).toHaveLength(3);
      expect(el.querySelector("[data-track-provisional]")).not.toBeNull();
    });

    it("reads the track again when the game is scored, holding the level on a stale read", async () => {
      // Storage that marking a game scored really changes.
      let stored: string | null = JSON.stringify({
        me: [{ gameId: "g1", xp: 250, at: Date.now() }],
      });
      vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
        key === PENDING_XP_KEY ? stored : null,
      );
      vi.mocked(localStorage.setItem).mockImplementation(
        (key: string, value: string) => {
          if (key === PENDING_XP_KEY) stored = value;
        },
      );
      vi.mocked(localStorage.removeItem).mockImplementation((key: string) => {
        if (key === PENDING_XP_KEY) stored = null;
      });
      let scored = false;
      stopProvisionalProgress();
      startProvisionalProgress({
        fetchXp: async (gameId) =>
          scored
            ? {
                status: "ok",
                data: {
                  gameId,
                  eligible: true,
                  breakdown: {
                    leftEarly: false,
                    played: 250,
                    time: 0,
                    placement: 0,
                    win: 0,
                    firstGame: 0,
                    feats: 0,
                    subtotal: 250,
                    gamePermille: 1000,
                    subscriberPermille: 1000,
                    total: 250,
                  },
                  before: {
                    prestige: 2,
                    level: 47,
                    xpInLevel: 40,
                    xpForNext: 100,
                  },
                  after: {
                    ...OWN_PROGRESS,
                    level: 49,
                    xpInLevel: 90,
                    lifetimeXp: 300250,
                  },
                  levelsReached: [],
                },
              }
            : { status: "pending", notFound: true },
        loadConfig: async () => config(),
        refreshUserMe: async () => undefined,
      });
      document.dispatchEvent(new CustomEvent("userMeResponse", { detail: me }));
      try {
        await runCheck();
        modal.open({ tab: "progression" });
        await settle(() => {
          const el = progression();
          expect(el?.confirmedLevel).toBe(47);
          expect(
            el?.querySelector('[data-level="49"][data-current]'),
          ).not.toBeNull();
        });

        // The game is scored at what it showed; the new read takes a while.
        let land!: (progress: PublicProgress) => void;
        fetchPublicPlayerProgressMock.mockClear();
        fetchPublicPlayerProgressMock.mockReturnValueOnce(
          new Promise<PublicProgress>((resolve) => (land = resolve)),
        );
        scored = true;
        await runCheck();
        await modal.updateComplete;
        expect(fetchPublicPlayerProgressMock).toHaveBeenCalledTimes(1);
        // Still on 49 while it reads, now confirmed (no provisional label):
        // not back on the old 47. Levels 48-49 are pending, never Claimed:
        // the rewards list was read before they were reached.
        const trackLevel = () =>
          progression()?.querySelector<
            HTMLElement & {
              confirmedLevel: number | null;
            }
          >("reward-track")?.confirmedLevel;
        await settle(() => {
          const el = progression();
          expect(el?.provisional).toBe(false);
          // The track's rewards were read at 47.
          expect(trackLevel()).toBe(47);
          expect(el?.querySelector("[data-track-provisional]")).toBeNull();
          expect(
            el?.querySelector('[data-level="48"]')?.getAttribute("data-status"),
          ).toBe("pending");
          expect(
            el?.querySelector('[data-level="49"][data-current]'),
          ).not.toBeNull();
        });

        // The public read comes back stale (cached, a replica from before
        // the game): the level still holds, confirmed.
        land({ ...PUBLIC_WITH_XP });
        await settle(() => {
          const el = progression();
          expect(el?.progress?.lifetimeXp).toBe(300250);
          expect(el?.provisional).toBe(false);
          expect(trackLevel()).toBe(47);
          expect(
            el?.querySelector('[data-level="49"][data-current]'),
          ).not.toBeNull();
          expect(
            el?.querySelectorAll('[data-status="claimed"][data-level="48"]'),
          ).toHaveLength(0);
        });

        // The account is broadcast with the game: its rewards (48 and 49
        // unclaimed) replace the track's, and the levels are judged by them.
        document.dispatchEvent(
          new CustomEvent("userMeResponse", {
            detail: userMe(
              { ...OWN_PROGRESS, level: 49, xpInLevel: 90, lifetimeXp: 300250 },
              [
                ...ownRewards(),
                reward("l48", { level: 48, prestige: 2 }),
                reward("l49", { level: 49, prestige: 2 }),
              ],
            ),
          }),
        );
        await settle(() => {
          const el = progression();
          expect(trackLevel()).toBe(49);
          expect(
            el?.querySelector('[data-level="48"]')?.getAttribute("data-status"),
          ).toBe("ready");
        });
      } finally {
        vi.mocked(localStorage.setItem).mockImplementation(() => undefined);
        vi.mocked(localStorage.removeItem).mockImplementation(() => undefined);
      }
    });

    it("shows the confirmed level for an account with nothing pending", async () => {
      vi.mocked(localStorage.getItem).mockImplementation(() => null);
      // As another tab clearing it would: the store reads storage afresh.
      window.dispatchEvent(
        new StorageEvent("storage", { key: PENDING_XP_KEY }),
      );
      modal.open();
      await settle(() => {
        expect(modal.querySelector<CardEl>("profile-card")).not.toBeNull();
      });
      const card = modal.querySelector<CardEl>("profile-card")!;
      expect(card.provisional).toBe(false);
      expect(card.progress.level).toBe(47);
    });
  });
});
