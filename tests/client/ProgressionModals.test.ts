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

const {
  getUserMe,
  fetchPublicPlayerProfile,
  fetchPublicPlayerProgress,
  fetchMyGameXp,
  isLoggedIn,
  crazyGamesSDK,
} = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  fetchPublicPlayerProfile: vi.fn(),
  fetchPublicPlayerProgress: vi.fn(),
  fetchMyGameXp: vi.fn(),
  isLoggedIn: vi.fn(async () => true),
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async (): Promise<unknown> => null),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  copyToClipboard: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("../../src/client/Api", () => ({
  getUserMe,
  fetchPublicPlayerProfile,
}));

vi.mock("../../src/client/Auth", () => ({ isLoggedIn }));

vi.mock("../../src/client/CrazyGamesSDK", () => ({ crazyGamesSDK }));

vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress,
  fetchMyGameXp,
}));

vi.mock(
  "../../src/client/components/baseComponents/stats/PlayerStatsTree",
  () => {
    class FakePlayerStatsTreeView extends HTMLElement {}
    if (!customElements.get("player-stats-tree-view")) {
      customElements.define("player-stats-tree-view", FakePlayerStatsTreeView);
    }
    return { PlayerStatsTreeView: FakePlayerStatsTreeView };
  },
);

vi.mock("../../src/client/components/baseComponents/stats/GameInfoView", () => {
  class FakeGameInfoView extends HTMLElement {}
  if (!customElements.get("game-info-view")) {
    customElements.define("game-info-view", FakeGameInfoView);
  }
  return { GameInfoView: FakeGameInfoView };
});

import { GameStatsModal } from "../../src/client/GameStatsModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { PlayerProfileModal } from "../../src/client/PlayerProfileModal";

type ModalShell = HTMLElement & { updateComplete: Promise<boolean> };

const me = {
  user: { email: "player@example.com" },
  player: {
    publicId: "me",
    progress: {
      prestige: 2,
      level: 64,
      xpInLevel: 10,
      xpForNext: 900,
      lifetimeXp: 123_456,
      legend: false,
      canPrestige: false,
    },
  },
};

const eligibleXp = {
  gameId: "g1",
  eligible: true,
  breakdown: {
    leftEarly: false,
    played: 50,
    time: 0,
    placement: 25,
    win: 0,
    firstWin: 0,
    feats: 0,
    subtotal: 75,
    gamePermille: 1000,
    subscriberPermille: 1000,
    total: 75,
  },
  before: { prestige: 0, level: 3, xpInLevel: 10, xpForNext: 300 },
  after: {
    prestige: 0,
    level: 3,
    xpInLevel: 85,
    xpForNext: 300,
    lifetimeXp: 700,
    legend: false,
    canPrestige: false,
  },
  levelsReached: [],
};

let playPage: HTMLElement;

beforeAll(() => {
  playPage = document.createElement("div");
  playPage.id = "page-play";
  document.body.appendChild(playPage);
  initNavigation();
  modalRouter.register("profile", {
    tag: "player-profile-modal",
    pageId: "page-profile",
  });
  modalRouter.register("stats", {
    tag: "game-stats-modal",
    pageId: "page-stats",
  });
  if (!customElements.get("player-profile-modal")) {
    customElements.define("player-profile-modal", PlayerProfileModal);
  }
  if (!customElements.get("game-stats-modal")) {
    customElements.define("game-stats-modal", GameStatsModal);
  }
});

afterAll(() => {
  playPage.remove();
});

async function mountModal<T extends HTMLElement>(
  tag: string,
  id: string,
): Promise<T & ModalShell> {
  const modal = document.createElement(tag) as T & ModalShell;
  modal.id = id;
  modal.setAttribute("inline", "");
  modal.className = "hidden page-content";
  document.body.appendChild(modal);
  await modal.updateComplete;
  return modal;
}

async function settled(modal: ModalShell): Promise<void> {
  await modal.updateComplete;
  const shell = modal.querySelector("o-modal") as ModalShell | null;
  await shell?.updateComplete;
}

describe("player profile level", () => {
  let modal: PlayerProfileModal & ModalShell;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    fetchPublicPlayerProfile.mockResolvedValue({
      createdAt: "2026-01-01T00:00:00.000Z",
      stats: { Public: {} },
    });
    getUserMe.mockResolvedValue(me);
    fetchPublicPlayerProgress.mockReset();
    modal = await mountModal<PlayerProfileModal>(
      "player-profile-modal",
      "page-profile",
    );
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  async function open(publicId: string): Promise<void> {
    history.replaceState(null, "", `/#modal=profile&publicID=${publicId}`);
    expect(modalRouter.routeFromHash()).toBe(true);
    await vi.waitFor(async () => {
      await settled(modal);
      expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    });
  }

  it("shows another player's level from the public endpoint", async () => {
    fetchPublicPlayerProgress.mockResolvedValue({
      prestige: 0,
      level: 12,
      lifetimeXp: 4200,
      legend: false,
    });
    await open("someone-else");
    const level = modal.querySelector("[data-profile-level]");
    expect(level).not.toBeNull();
    expect(level!.textContent).toContain('progression.level:{"level":12}');
    expect(level!.textContent).toContain("progression.lifetime_xp");
    expect(level!.textContent).not.toContain("progression.prestige");
    expect(fetchPublicPlayerProgress).toHaveBeenCalledWith("someone-else");
  });

  it("uses /users/@me for your own profile", async () => {
    await open("me");
    const level = modal.querySelector("[data-profile-level]");
    expect(level!.textContent).toContain('progression.level:{"level":64}');
    expect(level!.textContent).toContain('progression.prestige:{"prestige":2}');
    expect(fetchPublicPlayerProgress).not.toHaveBeenCalled();
  });

  it("hides the level when there is no progress", async () => {
    fetchPublicPlayerProgress.mockResolvedValue(false);
    await open("no-progress");
    expect(modal.querySelector("[data-profile-level]")).toBeNull();
  });

  it("shows the profile without waiting for the level, which lands later", async () => {
    let resolveProgress!: (p: unknown) => void;
    fetchPublicPlayerProgress.mockReturnValue(
      new Promise((resolve) => (resolveProgress = resolve)),
    );
    await open("slow-progress");
    // The stats are up while the level is still on its way.
    expect(modal.querySelector("[data-profile-level]")).toBeNull();
    resolveProgress({
      prestige: 0,
      level: 33,
      lifetimeXp: 9000,
      legend: false,
    });
    await vi.waitFor(async () => {
      await settled(modal);
      expect(
        modal.querySelector("[data-profile-level]")?.textContent,
      ).toContain('progression.level:{"level":33}');
    });
  });

  it("never puts a stale level on another player's profile", async () => {
    let resolveFirst!: (p: unknown) => void;
    fetchPublicPlayerProgress.mockImplementation((publicId: string) =>
      publicId === "first"
        ? new Promise((resolve) => (resolveFirst = resolve))
        : Promise.resolve(false),
    );
    await open("first");
    await open("second");
    resolveFirst({ prestige: 0, level: 77, lifetimeXp: 1, legend: false });
    await new Promise((r) => setTimeout(r, 0));
    await settled(modal);
    expect(modal.querySelector("[data-profile-level]")).toBeNull();
  });
});

describe("game stats XP", () => {
  let modal: GameStatsModal & ModalShell;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    getUserMe.mockResolvedValue(me);
    fetchMyGameXp.mockReset();
    modal = await mountModal<GameStatsModal>("game-stats-modal", "page-stats");
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  async function open(gameId: string): Promise<void> {
    history.replaceState(null, "", `/#modal=stats&gameID=${gameId}`);
    expect(modalRouter.routeFromHash()).toBe(true);
    await vi.waitFor(async () => {
      await settled(modal);
      expect(modal.querySelector("game-info-view")).not.toBeNull();
    });
  }

  async function panelState(): Promise<string | null> {
    const panel = modal.querySelector("game-xp-panel") as ModalShell | null;
    await panel?.updateComplete;
    return (
      panel?.querySelector("[data-xp-panel]")?.getAttribute("data-xp-state") ??
      null
    );
  }

  it("shows the XP a past game earned", async () => {
    fetchMyGameXp.mockResolvedValue({ status: "ok", data: eligibleXp });
    await open("g1");
    await vi.waitFor(async () => expect(await panelState()).toBe("result"));
    const text = modal.querySelector("[data-xp-panel]")!.textContent!;
    expect(text).toContain('progression.xp_total:{"xp":"75"}');
    expect(modal.querySelector("[data-xp-levelup]")).toBeNull();
    expect(fetchMyGameXp).toHaveBeenCalledWith("g1");
  });

  it("hides an ineligible or unprocessed game", async () => {
    fetchMyGameXp.mockResolvedValue({
      status: "ok",
      data: { gameId: "g2", eligible: false, reason: "not_spawned" },
    });
    await open("g2");
    await vi.waitFor(() => expect(fetchMyGameXp).toHaveBeenCalled());
    await settled(modal);
    expect(await panelState()).toBeNull();

    fetchMyGameXp.mockResolvedValue({ status: "pending" });
    await open("g3");
    await vi.waitFor(() =>
      expect(fetchMyGameXp).toHaveBeenLastCalledWith("g3"),
    );
    await settled(modal);
    expect(await panelState()).toBeNull();
  });

  it("does not ask when progression is off", async () => {
    getUserMe.mockResolvedValue({ ...me, player: { publicId: "me" } });
    await open("g5");
    await settled(modal);
    expect(fetchMyGameXp).not.toHaveBeenCalled();
    expect(await panelState()).toBeNull();
  });

  it("shows XP to a CrazyGames player, the same as the end-of-game panel", async () => {
    getUserMe.mockResolvedValue({ ...me, user: {} });
    crazyGamesSDK.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDK.getUserProfile.mockResolvedValue({ username: "cg" });
    fetchMyGameXp.mockResolvedValue({ status: "ok", data: eligibleXp });
    try {
      await open("g6");
      await vi.waitFor(async () => expect(await panelState()).toBe("result"));
    } finally {
      crazyGamesSDK.isOnCrazyGames.mockReturnValue(false);
      crazyGamesSDK.getUserProfile.mockResolvedValue(null);
    }
  });

  it("does not ask for a signed-out viewer", async () => {
    getUserMe.mockResolvedValue({ user: {}, player: { publicId: "anon" } });
    await open("g4");
    await settled(modal);
    expect(fetchMyGameXp).not.toHaveBeenCalled();
    expect(await panelState()).toBeNull();
  });
});
