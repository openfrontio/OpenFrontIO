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

const fetchPublicPlayerProfileMock = vi.hoisted(() => vi.fn());
const viewer = vi.hoisted(() => ({ kind: "unknown" as string }));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  copyToClipboard: vi.fn(async () => undefined),
  showToast: vi.fn(),
}));

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: fetchPublicPlayerProfileMock,
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [],
    nextCursor: null,
  })),
}));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: vi.fn(async () => false),
}));

vi.mock("../../src/client/ProgressionAccount", () => ({
  resolveXpAccount: vi.fn(async () => ({ kind: viewer.kind })),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerGameHistoryView",
  () => ({}),
);

import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";
import { playerProfileRouteArgs } from "../../src/client/utilities/PlayerProfileUrl";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

const profile = {
  createdAt: "2026-01-01T00:00:00.000Z",
  username: "Wonder",
  stats: { Public: {} },
  clans: [],
};

describe("public profile page", () => {
  let modal: PlayerProfileModal;
  let playPage: HTMLElement;
  let leaderboard: HTMLElement & { open: () => void };
  let leaderboardOpens: number;

  async function settle(assertion: () => void): Promise<void> {
    await vi.waitFor(async () => {
      await modal.updateComplete;
      const shell = modal.querySelector("o-modal") as ModalShell | null;
      await shell?.updateComplete;
      assertion();
    });
  }

  const url = () =>
    window.location.pathname + window.location.search + window.location.hash;

  beforeAll(() => {
    playPage = document.createElement("div");
    playPage.id = "page-play";
    document.body.appendChild(playPage);
    initNavigation();
    modalRouter.register("profile", {
      tag: "player-profile-modal",
      pageId: "page-profile",
    });
    modalRouter.registerPath("profile", playerProfileRouteArgs);
    if (!customElements.get("player-profile-modal")) {
      customElements.define("player-profile-modal", PlayerProfileModal);
    }
  });

  afterAll(() => {
    playPage.remove();
  });

  beforeEach(async () => {
    fetchPublicPlayerProfileMock.mockReset();
    fetchPublicPlayerProfileMock.mockResolvedValue(profile);
    viewer.kind = "unknown";
    history.replaceState(null, "", "/");

    leaderboardOpens = 0;
    leaderboard = document.createElement("leaderboard-modal") as HTMLElement & {
      open: () => void;
    };
    leaderboard.open = () => {
      leaderboardOpens++;
    };
    document.body.appendChild(leaderboard);

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
    leaderboard.remove();
    history.replaceState(null, "", "/");
  });

  async function openFromPath(path: string): Promise<void> {
    history.replaceState(null, "", path);
    expect(modalRouter.routeFromPath()).toBe(true);
    await settle(() => expect(modal.isOpen()).toBe(true));
  }

  describe("opening from a /player/<id> link", () => {
    it("opens that player's profile and keeps the link in the address bar", async () => {
      await openFromPath("/player/aB3dE5fX");
      await settle(() =>
        expect(modal.querySelector("player-stats-tree-view")).not.toBeNull(),
      );
      expect(fetchPublicPlayerProfileMock).toHaveBeenCalledWith("aB3dE5fX");
      expect(url()).toBe("/player/aB3dE5fX");
    });

    it("accepts the trailing-slash and worker-prefixed forms", async () => {
      await openFromPath("/w0/player/aB3dE5fX/");
      expect(fetchPublicPlayerProfileMock).toHaveBeenCalledWith("aB3dE5fX");
    });

    it("ignores a path that isn't a profile link", () => {
      history.replaceState(null, "", "/player/not!an!id");
      expect(modalRouter.routeFromPath()).toBe(false);
      history.replaceState(null, "", "/news");
      expect(modalRouter.routeFromPath()).toBe(false);
      expect(modal.isOpen()).toBe(false);
    });

    it("opens on the tab ?tab= names, and writes tab changes back to it", async () => {
      await openFromPath("/player/aB3dE5fX?tab=clans");
      await settle(() =>
        expect(modal.textContent).toContain("player_profile.no_clans"),
      );

      modal.setActiveTab("games");
      expect(url()).toBe("/player/aB3dE5fX?tab=games");
      expect(window.location.hash).toBe("");
    });

    it("goes home on Back and resets the URL so a reload doesn't reopen it", async () => {
      await openFromPath("/player/aB3dE5fX");
      (modal.querySelector('[slot="header"] button') as HTMLElement).click();
      expect(modal.isOpen()).toBe(false);
      expect(url()).toBe("/");
      expect(playPage.classList.contains("hidden")).toBe(false);
      expect(modalRouter.isPathRouted("profile")).toBe(false);
    });

    it("goes home on Escape too", async () => {
      await openFromPath("/player/aB3dE5fX?tab=games");
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await vi.waitFor(() => expect(modal.isOpen()).toBe(false));
      expect(url()).toBe("/");
    });

    it("hands the URL back to the hash once the profile is reopened in-app", async () => {
      await openFromPath("/player/aB3dE5fX");
      modal.close();
      modal.openFromLeaderboard("other123");
      expect(url()).toBe("/#modal=profile&publicID=other123");
    });

    it("still opens from the hash form", async () => {
      history.replaceState(null, "", "/#modal=profile&publicID=aB3dE5fX");
      expect(modalRouter.routeFromHash()).toBe(true);
      await settle(() => expect(modal.isOpen()).toBe(true));
      expect(fetchPublicPlayerProfileMock).toHaveBeenCalledWith("aB3dE5fX");
      expect(modalRouter.isPathRouted("profile")).toBe(false);
    });
  });

  describe("visitor banner", () => {
    it("invites a signed-out viewer to play, and Play goes home", async () => {
      viewer.kind = "signed_out";
      await openFromPath("/player/aB3dE5fX");
      await settle(() =>
        expect(modal.querySelector("[data-visitor-banner]")).not.toBeNull(),
      );
      const banner = modal.querySelector("[data-visitor-banner]")!;
      expect(banner.textContent).toContain("player_profile.visitor_title");
      expect(banner.textContent).toContain("player_profile.visitor_body");

      (banner.querySelector("o-button button") as HTMLElement).click();
      expect(modal.isOpen()).toBe(false);
      expect(url()).toBe("/");
    });

    it("is hidden from a signed-in player", async () => {
      viewer.kind = "signed_in";
      await openFromPath("/player/aB3dE5fX");
      await settle(() =>
        expect(modal.querySelector("profile-share")).not.toBeNull(),
      );
      await new Promise((r) => setTimeout(r, 0));
      await modal.updateComplete;
      expect(modal.querySelector("[data-visitor-banner]")).toBeNull();
    });
  });

  it("offers the canonical link to share", async () => {
    await openFromPath("/player/aB3dE5fX");
    await settle(() =>
      expect(modal.querySelector("profile-share")).not.toBeNull(),
    );
    const share = modal.querySelector("profile-share") as HTMLElement & {
      url: string;
      name: string;
    };
    expect(share.url).toBe(`${window.location.origin}/player/aB3dE5fX`);
    expect(share.name).toBe("Wonder");
  });

  describe("not found", () => {
    it("explains, shows the link that was opened, and offers a way on", async () => {
      fetchPublicPlayerProfileMock.mockResolvedValue(false);
      await openFromPath("/player/missing1");
      await settle(() =>
        expect(modal.querySelector("[data-not-found]")).not.toBeNull(),
      );
      const panel = modal.querySelector("[data-not-found]")!;
      expect(panel.textContent).toContain("player_profile.not_found_title");
      expect(panel.textContent).toContain("player_profile.not_found_body");
      expect(
        panel.querySelector("[data-opened-link]")?.textContent?.trim(),
      ).toBe(`${window.location.host}/player/missing1`);
      expect(panel.querySelector("svg")).not.toBeNull();
    });

    it("leaves the link out when the profile wasn't opened from one", async () => {
      fetchPublicPlayerProfileMock.mockResolvedValue(false);
      modal.openFromLeaderboard("missing1");
      await settle(() =>
        expect(modal.querySelector("[data-not-found]")).not.toBeNull(),
      );
      expect(modal.querySelector("[data-opened-link]")).toBeNull();
    });

    it("Play OpenFront goes home", async () => {
      fetchPublicPlayerProfileMock.mockResolvedValue(false);
      await openFromPath("/player/missing1");
      await settle(() =>
        expect(modal.querySelector('[data-action="play"]')).not.toBeNull(),
      );
      (
        modal.querySelector('[data-action="play"] button') as HTMLElement
      ).click();
      expect(modal.isOpen()).toBe(false);
      expect(url()).toBe("/");
    });

    it("View leaderboard opens the leaderboard", async () => {
      fetchPublicPlayerProfileMock.mockResolvedValue(false);
      await openFromPath("/player/missing1");
      await settle(() =>
        expect(
          modal.querySelector('[data-action="leaderboard"]'),
        ).not.toBeNull(),
      );
      (
        modal.querySelector('[data-action="leaderboard"] button') as HTMLElement
      ).click();
      expect(modal.isOpen()).toBe(false);
      expect(leaderboardOpens).toBe(1);
      expect(url()).toBe("/");
    });
  });
});
