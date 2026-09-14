import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ProfileClan = {
  tag: string;
  name: string;
  role: string;
  joinedAt: string;
  memberCount: number;
};

let profileClans: ProfileClan[] | undefined;
// fetchPublicPlayerProfile() returns false when the load fails.
let profileFails = false;

vi.mock("../../src/client/Api", () => ({
  fetchPublicPlayerProfile: vi.fn(async () =>
    profileFails
      ? false
      : {
          createdAt: "2026-01-01T00:00:00.000Z",
          username: "SomePlayer",
          stats: {},
          clans: profileClans,
        },
  ),
  fetchPublicPlayerGames: vi.fn(async () => ({
    results: [],
    nextCursor: null,
  })),
}));

vi.mock("src/client/ClientEnv", () => ({
  ClientEnv: { workerPath: vi.fn(() => "w0") },
}));

vi.mock("../../src/client/Utils", () => ({
  getMapName: vi.fn((name: string) => name),
  renderDuration: vi.fn((seconds: number) => `${seconds}s`),
  translateText: vi.fn((key: string) => key),
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerGameHistoryView",
  () => ({}),
);
vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => ({}),
);

import { fetchPublicPlayerProfile } from "../../src/client/Api";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

async function waitForModal(
  modal: PlayerProfileModal,
  assertion: () => void,
): Promise<void> {
  await vi.waitFor(async () => {
    await modal.updateComplete;
    const shell = modal.querySelector("o-modal") as ModalShell | null;
    await shell?.updateComplete;
    assertion();
  });
}

describe("Player profile Clans tab", () => {
  let modal: PlayerProfileModal;
  let clanModal: HTMLElement;
  let playPage: HTMLElement;
  let clanOpenArgs: Record<string, unknown> | undefined;
  let clanOpenCalls: number;
  let leaderboardModal: HTMLElement;
  let leaderboardOpenCalls: number;

  beforeEach(async () => {
    vi.clearAllMocks();
    profileClans = undefined;
    profileFails = false;
    clanOpenArgs = undefined;
    clanOpenCalls = 0;
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

    // Stand-in for the real clan modal.
    clanModal = document.createElement("clan-modal");
    clanModal.id = "page-clan";
    (clanModal as HTMLElement & { openFromProfile: unknown }).openFromProfile =
      (tag: string, publicId: string, origin: string | null) => {
        clanOpenCalls++;
        clanOpenArgs = { tag, publicId, origin };
        // The real modal switches pages, closing this one.
        window.showPage?.("page-clan");
      };
    document.body.appendChild(clanModal);

    leaderboardOpenCalls = 0;
    leaderboardModal = document.createElement("leaderboard-modal");
    (leaderboardModal as HTMLElement & { open: unknown }).open = () => {
      leaderboardOpenCalls++;
    };
    document.body.appendChild(leaderboardModal);

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
    clanModal.remove();
    leaderboardModal.remove();
    playPage.remove();
    history.replaceState(null, "", "/");
  });

  async function openClansTab(): Promise<void> {
    modal.open({ publicID: "nmTH13FD" });
    await waitForModal(modal, () => {
      const shell = modal.querySelector("o-modal") as ModalShell;
      expect(shell.shadowRoot?.textContent).toContain(
        "account_modal.tab_clans",
      );
    });
    modal.setActiveTab("clans");
    await modal.updateComplete;
  }

  // Clans tab → click the first clan card, handing off to the clan modal.
  async function selectClan(): Promise<void> {
    await waitForModal(modal, () => {
      const shell = modal.querySelector("o-modal") as ModalShell;
      expect(shell.shadowRoot?.textContent).toContain(
        "account_modal.tab_clans",
      );
    });
    modal.setActiveTab("clans");
    await waitForModal(modal, () => {
      expect(modal.querySelector("clan-card button")).not.toBeNull();
    });
    (modal.querySelector("clan-card button") as HTMLButtonElement).click();
  }

  it("lists the viewed player's clans with role and member count", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "leader",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 12,
      },
      {
        tag: "ZET",
        name: "Zeta Clan",
        role: "member",
        joinedAt: "2026-03-01T00:00:00.000Z",
        memberCount: 4,
      },
    ];

    await openClansTab();

    await waitForModal(modal, () => {
      expect(modal.querySelectorAll("clan-card")).toHaveLength(2);
    });
    const first = modal.querySelector("clan-card") as HTMLElement & {
      clan: { tag: string; name: string; memberCount: number };
      clanRole: string;
    };
    expect(first.clan.tag).toBe("ALP");
    expect(first.clan.name).toBe("Alpha Clan");
    expect(first.clan.memberCount).toBe(12);
    expect(first.clanRole).toBe("leader");
    expect(modal.textContent).toContain("clan_modal.role_leader");
  });

  it("opens the clan modal on the selected clan's detail", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "officer",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 3,
      },
    ];

    await openClansTab();
    await waitForModal(modal, () => {
      expect(modal.querySelector("clan-card button")).not.toBeNull();
    });

    (modal.querySelector("clan-card button") as HTMLButtonElement).click();

    expect(clanOpenCalls).toBe(1);
    // The publicId rides along so Back can return here.
    expect(clanOpenArgs).toEqual({
      tag: "ALP",
      publicId: "nmTH13FD",
      origin: null,
    });
  });

  it("hands this profile's own origin to the clan modal", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "officer",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 3,
      },
    ];

    modal.openFromLeaderboard("nmTH13FD");
    await selectClan();

    expect(clanOpenArgs).toEqual({
      tag: "ALP",
      publicId: "nmTH13FD",
      origin: "leaderboard",
    });
  });

  it("returns to the Clans tab from the clan modal, refreshing the data", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "officer",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 3,
      },
    ];

    await openClansTab();
    await waitForModal(modal, () => {
      expect(modal.querySelector("clan-card button")).not.toBeNull();
    });
    (modal.querySelector("clan-card button") as HTMLButtonElement).click();
    expect(modal.isOpen()).toBe(false);

    // The detour can rename the clan or move its member count.
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan Renamed",
        role: "member",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 9,
      },
    ];
    modal.returnFromClan("nmTH13FD", null);

    await waitForModal(modal, () => {
      expect(modal.querySelectorAll("clan-card")).toHaveLength(1);
    });
    expect(modal.isOpen()).toBe(true);
    expect(window.location.hash).toContain("tab=clans");
    expect(fetchPublicPlayerProfile).toHaveBeenCalledTimes(2);
    const card = modal.querySelector("clan-card") as HTMLElement & {
      clan: { name: string; memberCount: number };
      clanRole: string;
    };
    expect(card.clan.name).toBe("Alpha Clan Renamed");
    expect(card.clan.memberCount).toBe(9);
    expect(card.clanRole).toBe("member");
  });

  it("keeps the profile's own origin across the clan detour", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "officer",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 3,
      },
    ];

    // Opened from the leaderboard, so Back must still return there.
    modal.openFromLeaderboard("nmTH13FD");
    await selectClan();

    // A member's profile reuses this element and overwrites its origin.
    modal.openFromClan("otherPlayer");
    await modal.updateComplete;

    modal.returnFromClan("nmTH13FD", "leaderboard");
    await waitForModal(modal, () => {
      expect(modal.querySelectorAll("clan-card")).toHaveLength(1);
    });

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    expect(leaderboardOpenCalls).toBe(1);
  });

  it("keeps the profile's own origin across a nested clan detour", async () => {
    profileClans = [
      {
        tag: "ALP",
        name: "Alpha Clan",
        role: "officer",
        joinedAt: "2026-02-01T00:00:00.000Z",
        memberCount: 3,
      },
    ];

    // leaderboard → P → clan B → member Q → Q's own clan C → Back ×3.
    modal.openFromLeaderboard("player-P");
    await selectClan();
    modal.openFromClan("player-Q");
    await selectClan();
    expect(clanOpenArgs).toEqual({
      tag: "ALP",
      publicId: "player-Q",
      origin: "clan",
    });

    // C's Back lands on Q, then Q's Back lands on B, whose Back lands here.
    modal.returnFromClan("player-Q", "clan");
    await modal.updateComplete;
    modal.returnFromClan("player-P", "leaderboard");
    await waitForModal(modal, () => {
      expect(modal.querySelectorAll("clan-card")).toHaveLength(1);
    });

    const backButton = modal.querySelector(
      '[slot="header"] button',
    ) as HTMLButtonElement;
    backButton.click();

    expect(leaderboardOpenCalls).toBe(1);
  });

  it("shows an empty state when the API omits clans (older backend)", async () => {
    profileClans = undefined;

    await openClansTab();

    await waitForModal(modal, () => {
      expect(modal.textContent).toContain("player_profile.no_clans");
    });
    expect(modal.querySelectorAll("clan-card")).toHaveLength(0);
  });

  it("shows not-found — not an empty clan list — when the profile fails to load", async () => {
    profileFails = true;

    await openClansTab();

    await waitForModal(modal, () => {
      expect(modal.textContent).toContain("player_profile.not_found");
    });
    // Must not read as "in no clans".
    expect(modal.textContent).not.toContain("player_profile.no_clans");
    expect(modal.querySelectorAll("clan-card")).toHaveLength(0);
  });
});
