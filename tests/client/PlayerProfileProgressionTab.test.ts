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

import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";

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
    });
    expect(modal.querySelectorAll("[data-prestige-tile]")).toHaveLength(2);
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

  it("stays on Stats when the asked-for tab has nothing to show", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    modal.open({ publicID: "abcd1234", tab: "progression" });
    await settle(() => {
      expect(fetchPublicPlayerProgressMock).toHaveBeenCalled();
      expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    });
    expect(modal.querySelector("profile-progression")).toBeNull();
  });
});
