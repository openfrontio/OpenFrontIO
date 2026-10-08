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
  pollGameXp,
  isLoggedIn,
  crazyGamesSDK,
} = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  fetchPublicPlayerProfile: vi.fn(),
  fetchPublicPlayerProgress: vi.fn(),
  fetchMyGameXp: vi.fn(),
  pollGameXp: vi.fn(),
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
  pollGameXp,
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

// Stands in for the real view: renders what goes under the game summary, and
// the tests say when the game "loaded" (see gameLoaded).
vi.mock(
  "../../src/client/components/baseComponents/stats/GameInfoView",
  async () => {
    const { nothing, render } = await import("lit");
    class FakeGameInfoView extends HTMLElement {
      gameId: string | null = null;
      private extra: unknown = nothing;
      set afterSummary(value: unknown) {
        this.extra = value;
        render(value, this);
      }
      get afterSummary(): unknown {
        return this.extra;
      }
    }
    if (!customElements.get("game-info-view")) {
      customElements.define("game-info-view", FakeGameInfoView);
    }
    return { GameInfoView: FakeGameInfoView };
  },
);

import { GameType } from "@openfront/engine-api/game/GameTypes";
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
    firstGame: 0,
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

  // The profile card's level parts.
  const levelLine = () =>
    modal.querySelector("profile-card [data-profile-level-line]");

  it("shows another player's level from the public endpoint", async () => {
    fetchPublicPlayerProgress.mockResolvedValue({
      prestige: 0,
      level: 12,
      lifetimeXp: 4200,
      legend: false,
    });
    await open("someone-else");
    expect(levelLine()!.textContent).toContain(
      'progression.level:{"level":12}',
    );
    expect(levelLine()!.textContent).not.toContain("progression.prestige");
    expect(
      modal.querySelector("[data-profile-lifetime]")!.textContent,
    ).toContain("4,200");
    // No XP-in-level from this API: no bar.
    expect(modal.querySelector("profile-card [data-xp-bar]")).toBeNull();
    expect(fetchPublicPlayerProgress).toHaveBeenCalledWith("someone-else");
  });

  it("draws the XP bar when the public endpoint says how far through the level", async () => {
    fetchPublicPlayerProgress.mockResolvedValue({
      prestige: 0,
      level: 12,
      lifetimeXp: 4200,
      legend: false,
      xpInLevel: 150,
      xpForNext: 600,
    });
    await open("someone-else");
    expect(
      modal
        .querySelector("profile-card [data-xp-bar]")!
        .getAttribute("aria-valuenow"),
    ).toBe("25");
  });

  it("reads your own level fresh, not from the page-load /users/@me", async () => {
    // The cached /users/@me still says level 64; games played since have
    // moved the player on, which only the public endpoint knows.
    fetchPublicPlayerProgress.mockResolvedValue({
      prestige: 2,
      level: 65,
      lifetimeXp: 130_000,
      legend: false,
    });
    await open("me");
    await vi.waitFor(async () => {
      await settled(modal);
      expect(levelLine()!.textContent).toContain(
        'progression.level:{"level":65}',
      );
      expect(levelLine()!.textContent).toContain(
        'progression.prestige:{"prestige":2}',
      );
    });
    expect(fetchPublicPlayerProgress).toHaveBeenCalledWith("me");
  });

  it("shows no card when there is no progress", async () => {
    fetchPublicPlayerProgress.mockResolvedValue(false);
    await open("no-progress");
    // No card at all: the stats below still show.
    expect(modal.querySelector("profile-card")).toBeNull();
    expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
  });

  it("shows the profile without waiting for the level, which lands later", async () => {
    let resolveProgress!: (p: unknown) => void;
    fetchPublicPlayerProgress.mockReturnValue(
      new Promise((resolve) => (resolveProgress = resolve)),
    );
    await open("slow-progress");
    // The stats are up while the level is still on its way.
    expect(modal.querySelector("player-stats-tree-view")).not.toBeNull();
    expect(modal.querySelector("profile-card")).toBeNull();
    resolveProgress({
      prestige: 0,
      level: 33,
      lifetimeXp: 9000,
      legend: false,
    });
    await vi.waitFor(async () => {
      await settled(modal);
      expect(levelLine()?.textContent).toContain(
        'progression.level:{"level":33}',
      );
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
    expect(modal.querySelector("profile-card")).toBeNull();
  });
});

describe("game stats XP", () => {
  let modal: GameStatsModal & ModalShell;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", { getItem: vi.fn(() => null) });
    getUserMe.mockResolvedValue(me);
    fetchMyGameXp.mockReset();
    pollGameXp.mockReset();
    modal = await mountModal<GameStatsModal>("game-stats-modal", "page-stats");
  });

  afterEach(() => {
    window.showPage?.("page-play");
    modal.remove();
    history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  async function shown(): Promise<void> {
    await vi.waitFor(async () => {
      await settled(modal);
      expect(modal.querySelector("game-info-view")).not.toBeNull();
    });
  }

  async function open(gameId: string): Promise<void> {
    history.replaceState(null, "", `/#modal=stats&gameID=${gameId}`);
    expect(modalRouter.routeFromHash()).toBe(true);
    await shown();
  }

  // GameInfoView has loaded the game: it ended `agoMs` ago.
  function gameLoaded(
    gameId: string,
    agoMs: number,
    gameType = GameType.Public,
  ): void {
    modal.querySelector("game-info-view")!.dispatchEvent(
      new CustomEvent("game-info-loaded", {
        detail: {
          gameId,
          info: { end: Date.now() - agoMs, config: { gameType } },
        },
        bubbles: true,
      }),
    );
  }

  async function cardState(): Promise<string | null> {
    await settled(modal);
    const card = modal.querySelector("past-game-xp-card") as ModalShell | null;
    await card?.updateComplete;
    return (
      card
        ?.querySelector("[data-past-xp]")
        ?.getAttribute("data-past-xp-state") ?? null
    );
  }

  // Lets a lookup that has nothing to show run to the end.
  async function idle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  }

  it("shows the XP a past game earned, under the game summary", async () => {
    fetchMyGameXp.mockResolvedValue({ status: "ok", data: eligibleXp });
    await open("g1");
    await vi.waitFor(async () => expect(await cardState()).toBe("result"));
    const card = modal.querySelector("game-info-view past-game-xp-card")!;
    expect(card.textContent).toContain('progression.xp_total:{"xp":"75"}');
    // Today's compact reveal panel is gone.
    expect(modal.querySelector("game-xp-panel")).toBeNull();
    expect(fetchMyGameXp).toHaveBeenCalledWith("g1", expect.any(AbortSignal));
  });

  it("explains a game that didn't earn XP: the record is always your own", async () => {
    fetchMyGameXp.mockResolvedValue({
      status: "ok",
      data: { gameId: "g2", eligible: false, reason: "not_spawned" },
    });
    await open("g2");
    await vi.waitFor(async () => expect(await cardState()).toBe("ineligible"));
    expect(modal.querySelector("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_not_spawned",
    );
  });

  it("tells a singleplayer game it doesn't earn XP, once the game has loaded", async () => {
    fetchMyGameXp.mockResolvedValue({
      status: "ok",
      data: { gameId: "g8", eligible: false, reason: "unverified" },
    });
    await open("g8");
    await vi.waitFor(() => expect(fetchMyGameXp).toHaveBeenCalled());
    await idle();
    // Never the multiplayer line first: it waits for the game's type.
    expect(await cardState()).toBeNull();
    gameLoaded("g8", 60_000, GameType.Singleplayer);
    await vi.waitFor(async () => expect(await cardState()).toBe("ineligible"));
    expect(modal.querySelector("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_singleplayer",
    );
  });

  it("says a multiplayer game's results couldn't be verified", async () => {
    fetchMyGameXp.mockResolvedValue({
      status: "ok",
      data: { gameId: "g9", eligible: false, reason: "unverified" },
    });
    await open("g9");
    gameLoaded("g9", 60_000, GameType.Public);
    await vi.waitFor(async () => expect(await cardState()).toBe("ineligible"));
    expect(modal.querySelector("[data-past-xp-note]")!.textContent).toBe(
      "progression.ineligible_unverified",
    );
  });

  it("says when a game was played before levels existed", async () => {
    fetchMyGameXp.mockResolvedValue({
      status: "ok",
      data: { gameId: "g7", eligible: false, reason: "before_progression" },
    });
    await open("g7");
    await vi.waitFor(async () =>
      expect(await cardState()).toBe("before_levels"),
    );
    expect(modal.querySelector("[data-past-xp-note]")!.textContent).toBe(
      "progression.xp_before_levels",
    );
  });

  describe("a game with no XP record yet (404)", () => {
    beforeEach(() => {
      fetchMyGameXp.mockResolvedValue({ status: "pending" });
    });

    it("calculates for your own game from your account, just finished, then shows it", async () => {
      let resolvePoll!: (r: unknown) => void;
      pollGameXp.mockReturnValue(
        new Promise((resolve) => (resolvePoll = resolve)),
      );
      modal.openFromAccount("g1");
      await shown();
      gameLoaded("g1", 2 * 60_000);
      await vi.waitFor(async () =>
        expect(await cardState()).toBe("calculating"),
      );
      expect(modal.querySelector("[data-past-xp-note]")!.textContent).toBe(
        "progression.calculating",
      );
      expect(pollGameXp).toHaveBeenCalledWith("g1", {
        signal: expect.any(AbortSignal),
      });
      resolvePoll(eligibleXp);
      await vi.waitFor(async () => expect(await cardState()).toBe("result"));
    });

    it("calculates for a just-finished game on your own profile", async () => {
      pollGameXp.mockReturnValue(new Promise(() => {}));
      modal.openFromProfile("g1", "me");
      await shown();
      gameLoaded("g1", 60_000);
      await vi.waitFor(async () =>
        expect(await cardState()).toBe("calculating"),
      );
    });

    it("hides the section when the polling gives up", async () => {
      pollGameXp.mockResolvedValue(null);
      modal.openFromAccount("g1");
      await shown();
      gameLoaded("g1", 60_000);
      await vi.waitFor(() => expect(pollGameXp).toHaveBeenCalled());
      await idle();
      expect(await cardState()).toBeNull();
    });

    it("shows nothing for an older game of your own", async () => {
      modal.openFromAccount("g1");
      await shown();
      gameLoaded("g1", 11 * 60_000);
      await idle();
      expect(await cardState()).toBeNull();
      expect(pollGameXp).not.toHaveBeenCalled();
    });

    it("shows nothing for a just-finished game on someone else's profile", async () => {
      modal.openFromProfile("g1", "someone-else");
      await shown();
      gameLoaded("g1", 60_000);
      await idle();
      expect(await cardState()).toBeNull();
      expect(pollGameXp).not.toHaveBeenCalled();
    });

    it("shows nothing for a just-finished game opened from a clan or a link", async () => {
      modal.openFromClan("g1");
      await shown();
      gameLoaded("g1", 60_000);
      await idle();
      expect(await cardState()).toBeNull();

      await open("g3");
      gameLoaded("g3", 60_000);
      await idle();
      expect(await cardState()).toBeNull();
      expect(pollGameXp).not.toHaveBeenCalled();
    });

    it("shows nothing when the game itself fails to load", async () => {
      modal.openFromAccount("g1");
      await shown();
      modal.querySelector("game-info-view")!.dispatchEvent(
        new CustomEvent("game-info-loaded", {
          detail: { gameId: "g1", info: null },
          bubbles: true,
        }),
      );
      await idle();
      expect(await cardState()).toBeNull();
      expect(pollGameXp).not.toHaveBeenCalled();
    });

    it("stops polling when the modal closes", async () => {
      let signal!: AbortSignal;
      pollGameXp.mockImplementation(
        (_id: string, opts: { signal: AbortSignal }) => {
          signal = opts.signal;
          return new Promise(() => {});
        },
      );
      modal.openFromAccount("g1");
      await shown();
      gameLoaded("g1", 60_000);
      await vi.waitFor(() => expect(pollGameXp).toHaveBeenCalled());
      modal.close();
      expect(signal.aborted).toBe(true);
    });
  });

  it("does not ask when progression is off", async () => {
    getUserMe.mockResolvedValue({ ...me, player: { publicId: "me" } });
    await open("g5");
    await idle();
    expect(fetchMyGameXp).not.toHaveBeenCalled();
    expect(await cardState()).toBeNull();
  });

  it("shows XP to a CrazyGames player, the same as the end-of-game panel", async () => {
    getUserMe.mockResolvedValue({ ...me, user: {} });
    crazyGamesSDK.isOnCrazyGames.mockReturnValue(true);
    crazyGamesSDK.getUserProfile.mockResolvedValue({ username: "cg" });
    fetchMyGameXp.mockResolvedValue({ status: "ok", data: eligibleXp });
    try {
      await open("g6");
      await vi.waitFor(async () => expect(await cardState()).toBe("result"));
    } finally {
      crazyGamesSDK.isOnCrazyGames.mockReturnValue(false);
      crazyGamesSDK.getUserProfile.mockResolvedValue(null);
    }
  });

  it("does not ask for a signed-out viewer", async () => {
    getUserMe.mockResolvedValue({ user: {}, player: { publicId: "anon" } });
    await open("g4");
    await idle();
    expect(fetchMyGameXp).not.toHaveBeenCalled();
    expect(await cardState()).toBeNull();
  });
});
