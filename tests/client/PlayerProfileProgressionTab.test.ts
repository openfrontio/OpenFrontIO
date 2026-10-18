import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchPublicPlayerProgressMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: vi.fn(async () => ({
    createdAt: "2026-01-01T00:00:00.000Z",
    username: "SomePlayer",
    stats: {},
    clans: [],
  })),
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [],
    nextCursor: null,
  })),
  claimReward: vi.fn(),
  getUserMe: vi.fn(async () => false),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: fetchPublicPlayerProgressMock,
  fetchProgressionConfig: vi.fn(async () => false),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => {}),
}));

// The visitor banner asks who is viewing; these tests don't sign anyone in.
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

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  copyToClipboard: vi.fn(),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerGameHistoryView",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);

// The tab fetches the reward track's code when it first opens; loaded up
// front here so the waits below are about the tab, not the test's
// first-time transform of that module.
import "../../src/client/components/RewardTrack";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";
import {
  PROVISIONAL_PROGRESS_CHANGED,
  recordPendingXp,
  runCheck,
  startProvisionalProgress,
  stopProvisionalProgress,
} from "../../src/client/ProvisionalProgress";
import { playerProfileRouteArgs } from "../../src/client/utilities/PlayerProfileUrl";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

const withProgress = {
  prestige: 2,
  level: 30,
  lifetimeXp: 50000,
  legend: false,
  prestigeHistory: [
    { rank: 1, at: "2026-09-06T00:00:00.000Z" },
    { rank: 2, at: "2026-09-19T00:00:00.000Z" },
  ],
  milestones: [{ prestige: 2, level: 10, at: "2026-09-20T00:00:00.000Z" }],
};

describe("Player profile Progression tab", () => {
  let modal: PlayerProfileModal;
  let playPage: HTMLElement;

  async function settle(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await modal.updateComplete;
      const shell = modal.querySelector("o-modal") as ModalShell | null;
      await shell?.updateComplete;
      assertion();
    });
  }

  const tabText = () =>
    (modal.querySelector("o-modal") as ModalShell).shadowRoot?.textContent ??
    "";

  beforeEach(async () => {
    vi.clearAllMocks();
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

  it("adds the tab after Clans when the player has progress", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    modal.open({ publicID: "abcd1234" });
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_progression");
    });
    const text = tabText();
    expect(text.indexOf("account_modal.tab_clans")).toBeLessThan(
      text.indexOf("account_modal.tab_progression"),
    );

    modal.setActiveTab("progression");
    await settle(() => {
      expect(modal.querySelector("profile-progression")).not.toBeNull();
      expect(modal.querySelectorAll("[data-prestige-tile]")).toHaveLength(2);
    });
    expect(modal.querySelector("[data-current-run]")).not.toBeNull();
  });

  it("pops the tab in once per opening, not again on switching back", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    const shown = async () => {
      let el: Element | null = null;
      await settle(() => {
        el = modal.querySelector("profile-progression");
        expect(el?.querySelector("[data-milestones]")).not.toBeNull();
      });
      return el as unknown as HTMLElement;
    };
    modal.open({ publicID: "abcd1234" });
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_progression");
    });
    modal.setActiveTab("progression");
    expect((await shown()).classList.contains("pp-anim")).toBe(true);

    modal.setActiveTab("stats");
    await settle(() => {
      expect(modal.querySelector("profile-progression")).toBeNull();
    });
    modal.setActiveTab("progression");
    const again = await shown();
    expect(again.classList.contains("pp-anim")).toBe(false);
    expect(
      again
        .querySelector<HTMLElement>("[data-pp]")
        ?.style.getPropertyValue("--i"),
    ).toBe("");

    // A fresh opening of the profile pops in again.
    modal.open({ publicID: "abcd1234", tab: "progression" });
    expect((await shown()).classList.contains("pp-anim")).toBe(true);
  });

  it("has no tab for a player without progress", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    modal.open({ publicID: "abcd1234" });
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_clans");
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
    });
    await modal.updateComplete;
    expect(tabText()).not.toContain("account_modal.tab_progression");
    modal.setActiveTab("progression");
    await modal.updateComplete;
    expect(modal.querySelector("profile-progression")).toBeNull();
  });

  it("opens on the tab when asked, once the progress arrives", async () => {
    let resolve!: (value: unknown) => void;
    fetchPublicPlayerProgressMock.mockReturnValue(
      new Promise((r) => (resolve = r)),
    );
    modal.open({ publicID: "abcd1234", tab: "progression" });
    await modal.updateComplete;
    expect(modal.querySelector("profile-progression")).toBeNull();

    resolve(withProgress);
    await settle(() => {
      expect(modal.querySelector("profile-progression")).not.toBeNull();
    });
  });

  async function openOnProgression(): Promise<void> {
    modal.open({ publicID: "abcd1234", tab: "progression" });
    await settle(() => {
      expect(modal.querySelector("profile-progression")).not.toBeNull();
    });
  }

  it("honours an explicit Stats request while open on Progression", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    await openOnProgression();
    fetchPublicPlayerProgressMock.mockClear();

    modal.open({ publicID: "abcd1234", tab: "stats" });
    await settle(() => {
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
      expect(tabText()).toContain("account_modal.tab_progression");
      expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    });
    // Let the progress response land: it must not pull the tab back.
    await new Promise((r) => setTimeout(r, 0));
    await modal.updateComplete;
    expect(modal.querySelector("profile-progression")).toBeNull();
    expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
  });

  it("keeps Progression when reopened without a tab", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    await openOnProgression();
    fetchPublicPlayerProgressMock.mockClear();

    modal.open({ publicID: "abcd1234" });
    await settle(() => {
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
      expect(modal.querySelector("profile-progression")).not.toBeNull();
    });
  });

  it("doesn't pick the tab for a profile closed before its progress came", async () => {
    let resolve!: (value: unknown) => void;
    fetchPublicPlayerProgressMock.mockReturnValueOnce(
      new Promise((r) => (resolve = r)),
    );
    modal.open({ publicID: "abcd1234", tab: "progression" });
    await modal.updateComplete;
    modal.close();
    resolve(withProgress);
    await new Promise((r) => setTimeout(r, 0));

    // The next opening asks for no tab: it starts on Stats.
    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    modal.open({ publicID: "efgh5678" });
    await settle(() => {
      expect(tabText()).toContain("account_modal.tab_progression");
      expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    });
    expect(modal.querySelector("profile-progression")).toBeNull();
  });

  it("stays on Stats when the asked-for tab has nothing to show", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    modal.open({ publicID: "abcd1234", tab: "progression" });
    await settle(() => {
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
      expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    });
    expect(modal.querySelector("profile-progression")).toBeNull();
  });

  for (const tab of ["games", "clans"]) {
    it(`switches an open profile on ${tab} to a linked Progression tab once its progress arrives`, async () => {
      fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
      modal.open({ publicID: "abcd1234", tab });
      await settle(() => {
        expect(tabText()).toContain("account_modal.tab_progression");
      });
      expect(modal.querySelector("profile-progression")).toBeNull();

      // A link to another player's Progression tab, routed while open.
      let resolve!: (value: unknown) => void;
      fetchPublicPlayerProgressMock.mockReturnValueOnce(
        new Promise((r) => (resolve = r)),
      );
      modalRouter.registerPath("profile", playerProfileRouteArgs);
      history.replaceState(null, "", "/player/efgh5678?tab=progression");
      expect(modalRouter.routeFromPath()).toBe(true);
      await vi.waitFor(() => {
        expect(fetchPublicPlayerProgressMock).toHaveBeenCalledWith("efgh5678");
      });
      resolve(withProgress);
      await settle(() => {
        expect(modal.querySelector("profile-progression")).not.toBeNull();
      });
    });
  }

  it("switches to an asked-for Progression tab from a profile without one", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    modal.open({ publicID: "abcd1234", tab: "games" });
    await settle(() => {
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
    });
    expect(tabText()).not.toContain("account_modal.tab_progression");

    fetchPublicPlayerProgressMock.mockResolvedValue(withProgress);
    modal.open({ publicID: "efgh5678", tab: "progression" });
    await settle(() => {
      expect(modal.querySelector("profile-progression")).not.toBeNull();
    });
  });

  // The viewer's own profile, with a game they died in still waiting to be
  // scored: 250 XP on top of L30 at 40 (100 a level here) is L32 at 90.
  describe("with XP still waiting to be scored", () => {
    const OWN = { ...withProgress, xpInLevel: 40, xpForNext: 100 };

    type CardEl = HTMLElement & {
      progress: { level: number; xpInLevel: number };
      provisional: boolean;
    };
    const card = () => modal.querySelector<CardEl>("profile-card");

    beforeEach(() => {
      localStorage.clear();
      fetchPublicPlayerProgressMock.mockImplementation(async () => ({
        ...OWN,
      }));
      startProvisionalProgress({
        fetchXp: async () => ({ status: "pending", notFound: true }),
        loadConfig: async () => ({
          version: 1,
          maxLevel: 100,
          maxPrestige: 10,
          levels: Array.from({ length: 100 }, (_, i) => ({
            level: i + 1,
            xpToNext: i + 1 >= 100 ? 0 : 100,
            cumulativeXp: 0,
          })),
          flares: [],
        }),
        refreshUserMe: async () => undefined,
      });
      recordPendingXp("abcd1234", { gameId: "g1", xp: 250 });
      document.dispatchEvent(
        new CustomEvent("userMeResponse", {
          detail: {
            user: { email: "wonder@example.com" },
            player: {
              publicId: "abcd1234",
              progress: { ...OWN, canPrestige: false },
            },
          },
        }),
      );
    });

    afterEach(() => {
      stopProvisionalProgress();
      localStorage.clear();
    });

    it("shows the projected level on the player's own profile, marked provisional", async () => {
      await runCheck();
      modal.open({ publicID: "abcd1234" });
      await settle(() => {
        expect(card()?.provisional).toBe(true);
        expect(card()?.progress.level).toBe(32);
        expect(card()?.progress.xpInLevel).toBe(90);
      });
      modal.setActiveTab("progression");
      await settle(() => {
        const el = modal.querySelector<
          HTMLElement & { confirmedLevel: number | null }
        >("profile-progression");
        expect(el?.confirmedLevel).toBe(30);
      });
    });

    it("keeps the last reread when two overlap", async () => {
      await runCheck();
      modal.open({ publicID: "abcd1234" });
      await settle(() => expect(card()?.progress.level).toBe(32));
      // Two scored games, two rereads; the first one's answer lands last.
      const answers: ((p: unknown) => void)[] = [];
      fetchPublicPlayerProgressMock.mockImplementation(
        () => new Promise((resolve) => answers.push(resolve)),
      );
      for (const gameId of ["g8", "g9"]) {
        document.dispatchEvent(
          new CustomEvent(PROVISIONAL_PROGRESS_CHANGED, {
            detail: { scored: [gameId] },
          }),
        );
      }
      expect(answers).toHaveLength(2);
      answers[1]({ ...OWN, level: 35, xpInLevel: 0, lifetimeXp: 60000 });
      answers[0]({ ...OWN, level: 33, xpInLevel: 0, lifetimeXp: 55000 });
      // The second read wins (35, its rise past g1's notIn unexplained), not
      // the first (33).
      await settle(() => expect(card()?.progress.level).toBe(35));
      await new Promise((r) => setTimeout(r, 0));
      expect(card()?.progress.level).toBe(35);
    });

    it("never shows it on anyone else's profile", async () => {
      await runCheck();
      modal.open({ publicID: "someone-else" });
      await settle(() => {
        expect(card()).not.toBeNull();
      });
      // Let any check the render asked for finish.
      await runCheck();
      await modal.updateComplete;
      expect(card()!.provisional).toBe(false);
      expect(card()!.progress.level).toBe(30);
    });
  });
});
