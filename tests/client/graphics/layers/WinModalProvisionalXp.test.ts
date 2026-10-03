import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMe, invalidateUserMe, fetchProgressionConfig, isLoggedIn } =
  vi.hoisted(() => ({
    getUserMe: vi.fn(),
    invalidateUserMe: vi.fn(),
    fetchProgressionConfig: vi.fn(),
    isLoggedIn: vi.fn(),
  }));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  getGamesPlayed: vi.fn(() => 10),
  isInIframe: vi.fn(() => false),
  homeHref: vi.fn(() => "/"),
  TUTORIAL_VIDEO_URL: "https://example.com/tutorial",
}));

vi.mock("../../../../src/client/Api", () => ({ getUserMe, invalidateUserMe }));

vi.mock("../../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
  isLoggedIn,
}));

vi.mock("../../../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

// Only the config lookup is replaced: the poll and the XP fetch run for real
// against the stubbed fetch below.
vi.mock("../../../../src/client/ProgressionApi", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/ProgressionApi")
  >()),
  fetchProgressionConfig,
}));

vi.mock("../../../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../../src/client/Cosmetics")
  >()),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn(() => []),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
  },
}));

import type { GameXpPanel } from "../../../../src/client/components/GameXpPanel";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import { GameMode, GameType } from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import type { HumanStatsSnapshot } from "../../../../src/core/game/HumanStats";

const GAME_ID = "gPROVXP01";
const XP_URL = `https://api.test/users/@me/xp/${GAME_ID}`;

// Test inputs: the expectations below are worked out from these, not from
// the API's live tuning.
const RULES = {
  minAliveTicks: 1200,
  gameXp: 50,
  xpPerMinute: 17,
  timeCapMinutes: 30,
  ffaPlacementMax: 150,
  ffaWin: 300,
  fullLobbyHumans: 20,
  teamWin: 150,
  teamWinMinAlivePermille: 500,
  hvnWin: 100,
  firstGameOfDay: 100,
  // Feats pay nothing, as the API's defaults have it.
  featXp: 0,
  maxFeatsPerGame: 3,
  publicPermille: 1000,
  rankedPermille: 1250,
  privatePermille: 500,
  singleplayerPermille: 250,
  privateMinHumans: 4,
  privateGamesPerDay: 10,
  singleplayerGamesPerDay: 5,
};

// A flat curve, 100 XP a level.
const CONFIG = {
  version: 2,
  maxLevel: 100,
  maxPrestige: 10,
  levels: Array.from({ length: 100 }, (_, i) => ({
    level: i + 1,
    xpToNext: i + 1 < 100 ? 100 : 0,
    cumulativeXp: 100 * i,
  })),
  formula: 1,
  xp: RULES,
};

// Level 9, halfway: a provisional figure of 50+ XP reaches the level-10
// milestone. Today's first public game is still open.
const PROGRESS = {
  prestige: 0,
  level: 9,
  xpInLevel: 50,
  xpForNext: 100,
  lifetimeXp: 850,
  legend: false,
  canPrestige: false,
  daily: { privateGames: 0, singleplayerGames: 0, firstGameClaimed: false },
  subscriberPermille: 1000,
};

const signedIn = {
  user: { email: "player@example.com" },
  player: { publicId: "me", progress: PROGRESS },
};

// "me" died at tick 4000 having attacked; one opponent was out before.
// Provisional FFA figure: 50 played + floor(4000 * 17 / 600) = 113 time +
// floor(150 * 1 * 3 / (2 * 20)) = 11 placement + 100 first game = 274.
// In a team game: no placement, so 263.
function snapshot(): HumanStatsSnapshot {
  return {
    tick: 4100,
    stats: {
      me: { killedAt: 4000n, attacks: [100n] },
      early: { killedAt: 2000n },
      alive: { attacks: [5n] },
    },
    disconnectedAt: {},
  };
}

const BREAKDOWN = {
  leftEarly: false,
  played: 50,
  time: 113,
  placement: 11,
  win: 0,
  firstGame: 100,
  feats: 0,
  subtotal: 274,
  gamePermille: 1000,
  subscriberPermille: 1000,
  total: 274,
};

const levels = (...ls: number[]) => ls.map((level) => ({ prestige: 0, level }));

// The server's figure. By default the provisional one exactly: 50 + 274 is
// three levels up (the level-10 milestone among them), 24 into level 12.
function serverXp(overrides: Record<string, unknown> = {}) {
  return {
    gameId: GAME_ID,
    eligible: true,
    breakdown: BREAKDOWN,
    before: { prestige: 0, level: 9, xpInLevel: 50, xpForNext: 100 },
    after: {
      prestige: 0,
      level: 12,
      xpInLevel: 24,
      xpForNext: 100,
      lifetimeXp: 1124,
      legend: false,
      canPrestige: false,
    },
    levelsReached: levels(10, 11, 12),
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubXpEndpoint(answer: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== XP_URL) throw new Error(`unexpected fetch ${url}`);
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A game the local player has just died in. `end()` delivers the win update
// on the next tick.
function makeGame(
  opts: { gameMode?: GameMode; stats?: () => HumanStatsSnapshot } = {},
) {
  let ended = false;
  let delivered = false;
  const humanStats = vi.fn(async () => (opts.stats ?? snapshot)());
  const game = {
    gameID: () => GAME_ID,
    myClientID: () => "me",
    myPlayer: () => ({
      isAlive: () => false,
      hasSpawned: () => true,
      team: () => "Red",
      clientID: () => "me",
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => {
      if (!ended || delivered) return {};
      delivered = true;
      return {
        [GameUpdateType.Win]: [
          { winner: ["team", "Red"], allPlayersStats: {} },
        ],
      };
    },
    playerByClientID: () => undefined,
    worker: { humanStats },
    config: () => ({
      gameConfig: () => ({
        gameType: GameType.Public,
        gameMode: opts.gameMode ?? GameMode.FFA,
        playerTeams: opts.gameMode === GameMode.Team ? 2 : undefined,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
      }),
      isReplay: () => false,
    }),
  } as unknown as GameView;
  return { game, humanStats, end: () => (ended = true) };
}

describe("WinModal provisional XP at death", () => {
  let modal: WinModal;

  beforeEach(() => {
    vi.useFakeTimers();
    getUserMe.mockResolvedValue(signedIn);
    isLoggedIn.mockResolvedValue(true);
    fetchProgressionConfig.mockResolvedValue(CONFIG);
    vi.spyOn(history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    modal?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    invalidateUserMe.mockClear();
  });

  async function mount(game: GameView): Promise<void> {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = new EventBus();
    Object.assign(modal as unknown as { rand: number }, { rand: 0.75 });
    document.body.appendChild(modal);
    modal.tick();
    await settle();
  }

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await modal.updateComplete;
    await modal.querySelector<GameXpPanel>("game-xp-panel")?.updateComplete;
  }

  function panel(): HTMLElement | null {
    return modal.querySelector<HTMLElement>("game-xp-panel [data-xp-panel]");
  }

  function xpState(): string {
    return panel()?.getAttribute("data-xp-state") ?? "hidden";
  }

  function notes(): string[] {
    return [...panel()!.querySelectorAll("[data-xp-note]")].map((el) =>
      el.textContent!.trim(),
    );
  }

  function total(): string {
    return panel()!.querySelector("[data-xp-total]")!.textContent!;
  }

  function currentLevel(): number | undefined {
    return (
      panel()!.querySelector("[data-xp-current-badge] level-badge") as
        | (HTMLElement & { level: number })
        | null
    )?.level;
  }

  function milestoneCard(): HTMLElement | null {
    return panel()!.querySelector<HTMLElement>("[data-xp-levelup]");
  }

  function revealing(): boolean {
    return panel()?.getAttribute("data-xp-revealing") === "true";
  }

  async function finishReveal(): Promise<void> {
    panel()?.click();
    await settle();
  }

  // Lets a reveal play out, collecting each level-up moment it pauses on and
  // each milestone card it lands.
  async function playOut(): Promise<{ moments: string[]; cards: string[] }> {
    const moments: string[] = [];
    const cards: string[] = [];
    for (let i = 0; i < 400; i++) {
      const moment = panel()
        ?.querySelector("[data-xp-caption-levelup]")
        ?.getAttribute("data-xp-caption-levelup");
      if (moment && moment !== moments[moments.length - 1]) {
        moments.push(moment);
      }
      const card = panel()?.querySelector(
        "[data-xp-levelup]:not([data-xp-slot-hidden])",
      );
      const landed = card?.classList.contains("xp-card-in")
        ? card.getAttribute("data-xp-milestone")
        : null;
      if (landed && landed !== cards[cards.length - 1]) cards.push(landed);
      if (!revealing()) break;
      await settle(50);
    }
    return { moments, cards };
  }

  async function endGame(end: () => void): Promise<void> {
    end();
    modal.tick();
    await settle();
  }

  it("plays the full reveal at death, levels and milestones included", async () => {
    const fetchMock = stubXpEndpoint(() => json(serverXp()));
    const { game } = makeGame();
    await mount(game);

    expect(xpState()).toBe("provisional");
    // Fresh account state for today's allowances.
    expect(invalidateUserMe).toHaveBeenCalled();
    expect(
      panel()!.querySelector("[data-xp-provisional]")!.textContent,
    ).toContain("progression.provisional_label");
    // Every level-up plays, and the level-10 milestone card lands.
    expect(await playOut()).toEqual({
      moments: ["10", "11", "12"],
      cards: ["10"],
    });
    // The first game of the day is in the figure: it is known at death.
    expect(total()).toContain('"xp":"274"');
    expect(panel()!.querySelector('[data-xp-line="firstGame"]')).not.toBeNull();
    expect(
      panel()!.querySelector("[data-xp-header-level]")!.textContent,
    ).toContain('progression.xp_progress:{"current":"24","next":"100"}');
    expect(currentLevel()).toBe(12);
    expect(milestoneCard()?.getAttribute("data-xp-milestone")).toBe("10");
    // Still labelled provisional once the reveal is over.
    expect(panel()!.querySelector("[data-xp-provisional]")).not.toBeNull();
    // Feats pay nothing: nothing for the end of an FFA game to add.
    expect(panel()!.querySelector("[data-xp-reconcile]")).toBeNull();
    // Nothing is asked of the server until the game ends.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says what the end of the game may still add", async () => {
    stubXpEndpoint(() => json(serverXp()));
    await mount(makeGame({ gameMode: GameMode.Team }).game);
    await finishReveal();
    expect(notes()).toEqual(["progression.provisional_team_win_pending"]);
    modal.remove();

    // Feats only while they pay XP.
    fetchProgressionConfig.mockResolvedValue({
      ...CONFIG,
      xp: { ...RULES, featXp: 50 },
    });
    await mount(makeGame().game);
    await finishReveal();
    expect(notes()).toEqual(["progression.provisional_feats_pending"]);
  });

  it("confirms a matching figure quietly, with no second celebration", async () => {
    // Not processed yet on the first ask.
    let asked = 0;
    stubXpEndpoint(() =>
      asked++ === 0 ? new Response("", { status: 404 }) : json(serverXp()),
    );
    const { game, end } = makeGame();
    await mount(game);
    await playOut();

    await endGame(end);
    // While the server is asked, the figure stays up.
    expect(xpState()).toBe("provisional");
    expect(panel()!.querySelector("[data-xp-confirming]")).not.toBeNull();
    expect(
      panel()!.querySelector("[data-xp-provisional]")!.textContent,
    ).toContain("progression.provisional_confirming");
    await settle(3_000);

    expect(xpState()).toBe("result");
    expect(
      panel()!.querySelector("[data-xp-confirmed]")!.textContent,
    ).toContain("progression.xp_confirmed");
    // Nothing replays: no reveal, no level-up, the milestone card in place.
    expect(revealing()).toBe(false);
    expect(await playOut()).toEqual({ moments: [], cards: [] });
    expect(panel()!.querySelector("[data-xp-slot-hidden]")).toBeNull();
    expect(milestoneCard()?.getAttribute("data-xp-milestone")).toBe("10");
    expect(total()).toContain('"xp":"274"');
    expect(panel()!.querySelector("[data-xp-reconcile]")).toBeNull();
  });

  it("celebrates only the new levels when the team's win adds more", async () => {
    const warn = vi.spyOn(console, "warn");
    // 50 + 113 (no placement in a team game) + 100 first game + 150 team win
    // = 413: 50 + 413 reaches level 13, one past the provisional 12.
    stubXpEndpoint(() =>
      json(
        serverXp({
          breakdown: {
            ...BREAKDOWN,
            placement: 0,
            win: 150,
            subtotal: 413,
            total: 413,
          },
          after: { ...serverXp().after, level: 13, xpInLevel: 63 },
          levelsReached: levels(10, 11, 12, 13),
        }),
      ),
    );
    const { game, end } = makeGame({ gameMode: GameMode.Team });
    await mount(game);

    expect(xpState()).toBe("provisional");
    expect(await playOut()).toEqual({
      moments: ["10", "11", "12"],
      cards: ["10"],
    });
    expect(total()).toContain('"xp":"263"');

    await endGame(end);
    expect(xpState()).toBe("result");
    expect(panel()!.querySelector("[data-xp-confirmed]")).toBeNull();
    // The milestone already celebrated stays put.
    expect(milestoneCard()?.getAttribute("data-xp-milestone")).toBe("10");
    expect(milestoneCard()?.hasAttribute("data-xp-slot-hidden")).toBe(false);
    expect(milestoneCard()?.classList.contains("xp-card-in")).toBe(false);
    expect(await playOut()).toEqual({ moments: ["13"], cards: [] });
    expect(total()).toContain('"xp":"413"');
    expect(currentLevel()).toBe(13);
    expect(notes()).toEqual([
      'progression.provisional_was:{"xp":"263"}',
      "progression.reconcile_team_win",
    ]);
    // Explained by the win: not a formula drift.
    expect(warn).not.toHaveBeenCalledWith(
      "Provisional XP differed from the server's",
      expect.anything(),
    );
  });

  it("adjusts the level, without celebrating, when the server's figure is lower", async () => {
    const warn = vi.spyOn(console, "warn");
    // Another public game took today's first-game bonus first: 174, and
    // 50 + 174 only reaches level 11.
    stubXpEndpoint(() =>
      json(
        serverXp({
          breakdown: { ...BREAKDOWN, firstGame: 0, subtotal: 174, total: 174 },
          after: { ...serverXp().after, level: 11, lifetimeXp: 1024 },
          levelsReached: levels(10, 11),
        }),
      ),
    );
    const { game, end } = makeGame();
    await mount(game);
    expect((await playOut()).moments).toEqual(["10", "11", "12"]);

    await endGame(end);
    expect(xpState()).toBe("result");
    expect(revealing()).toBe(false);
    expect(await playOut()).toEqual({ moments: [], cards: [] });
    expect(panel()!.querySelector("[data-xp-confirmed]")).toBeNull();
    expect(total()).toContain('"xp":"174"');
    expect(currentLevel()).toBe(11);
    // No "Level 11!" either: the caption rests on the heading.
    expect(panel()!.querySelector("[data-xp-caption]")!.textContent).toContain(
      "progression.xp_heading",
    );
    expect(notes()).toEqual([
      'progression.provisional_was:{"xp":"274"}',
      "progression.reconcile_daily_cap",
      'progression.reconcile_level_adjusted:{"level":"11"}',
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      "Provisional XP differed from the server's",
      expect.anything(),
    );
  });

  it("logs a difference nothing at the end of the game explains", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubXpEndpoint(() =>
      json(
        serverXp({
          breakdown: { ...BREAKDOWN, time: 120, subtotal: 281, total: 281 },
          after: { ...serverXp().after, xpInLevel: 31 },
        }),
      ),
    );
    const { game, end } = makeGame();
    await mount(game);
    await finishReveal();
    await endGame(end);
    // More XP, but no level past those already celebrated.
    expect(await playOut()).toEqual({ moments: [], cards: [] });
    expect(total()).toContain('"xp":"281"');

    expect(notes()).toEqual([
      'progression.provisional_was:{"xp":"274"}',
      "progression.reconcile_other",
    ]);
    expect(warn).toHaveBeenCalledWith(
      "Provisional XP differed from the server's",
      expect.objectContaining({
        provisional: 274,
        server: 281,
        inputs: expect.objectContaining({
          gameMode: GameMode.FFA,
          spawnedHumans: 3,
          opponentsOutlasted: 1,
        }),
      }),
    );
  });

  it("says when the server couldn't verify the game, and where that leaves the level", async () => {
    stubXpEndpoint(() =>
      json({ gameId: GAME_ID, eligible: false, reason: "unverified" }),
    );
    const { game, end } = makeGame();
    await mount(game);
    await finishReveal();
    await endGame(end);

    expect(xpState()).toBe("ineligible");
    expect(panel()!.textContent).toContain("progression.ineligible_unverified");
    expect(notes()).toEqual([
      'progression.provisional_was:{"xp":"274"}',
      'progression.reconcile_level_adjusted:{"level":"9"}',
    ]);
  });

  it("marks an ineligible death as provisional too, then confirms it", async () => {
    stubXpEndpoint(() =>
      json({ gameId: GAME_ID, eligible: false, reason: "no_action" }),
    );
    const { game, end } = makeGame({
      stats: () => ({
        ...snapshot(),
        stats: { ...snapshot().stats, me: { killedAt: 4000n } },
      }),
    });
    await mount(game);

    expect(xpState()).toBe("provisional_ineligible");
    expect(panel()!.textContent).toContain("progression.ineligible_no_action");
    expect(panel()!.textContent).toContain("progression.provisional_label");

    await endGame(end);
    expect(xpState()).toBe("ineligible");
    expect(panel()!.querySelector("[data-xp-confirmed]")).not.toBeNull();
  });

  it("keeps the provisional figure, still provisional, if the server never answers", async () => {
    stubXpEndpoint(() => new Response("", { status: 404 }));
    const { game, end } = makeGame();
    await mount(game);
    await finishReveal();
    await endGame(end);
    await settle(60_000);

    expect(xpState()).toBe("provisional");
    expect(panel()!.querySelector("[data-xp-confirming]")).toBeNull();
    expect(panel()!.querySelector("[data-xp-provisional]")).not.toBeNull();
    expect(total()).toContain('"xp":"274"');
  });

  describe("falls back to 'XP is awarded when the game ends'", () => {
    it("for another formula revision", async () => {
      fetchProgressionConfig.mockResolvedValue({ ...CONFIG, formula: 2 });
      const { game, humanStats } = makeGame();
      await mount(game);
      expect(xpState()).toBe("awaiting_end");
      expect(humanStats).not.toHaveBeenCalled();
      expect(invalidateUserMe).not.toHaveBeenCalled();
    });

    it("for an API without the formula or its rules", async () => {
      fetchProgressionConfig.mockResolvedValue({
        ...CONFIG,
        formula: undefined,
        xp: undefined,
      });
      const { game, humanStats } = makeGame();
      await mount(game);
      expect(xpState()).toBe("awaiting_end");
      expect(humanStats).not.toHaveBeenCalled();
    });

    it("when the game's stats never show the death", async () => {
      const { game } = makeGame({
        stats: () => ({
          ...snapshot(),
          stats: { ...snapshot().stats, me: { attacks: [100n] } },
        }),
      });
      await mount(game);
      await settle(5_000);
      expect(xpState()).toBe("awaiting_end");
    });
  });
});
