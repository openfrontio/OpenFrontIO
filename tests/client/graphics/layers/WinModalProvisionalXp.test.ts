import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUserMe,
  fetchUserMeUncached,
  invalidateUserMe,
  fetchProgressionConfig,
  isLoggedIn,
} = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  fetchUserMeUncached: vi.fn(),
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

vi.mock("../../../../src/client/Api", () => ({
  getUserMe,
  fetchUserMeUncached,
  invalidateUserMe,
}));

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

import type { HumanStatsSnapshot } from "@openfront/engine-api/game/GameTypes";
import { GameMode, GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import type { AllPlayersStats, Winner } from "@openfront/engine-api/Schemas";
import { EventBus } from "@openfront/shared/EventBus";
import "../../../../src/client/components/GameXpPanel";
import type { GameXpPanel } from "../../../../src/client/components/GameXpPanel";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import {
  readPendingXp,
  recordPendingXp,
  stopProvisionalProgress,
} from "../../../../src/client/ProvisionalProgress";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";

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
  daily: {
    // The server's day, as /users/@me stamps it.
    day: new Date().toISOString().slice(0, 10),
    privateGames: 0,
    singleplayerGames: 0,
    firstGameClaimed: false,
  },
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

// The server's figure for a team game the player's team won: 50 + 113 (no
// placement in a team game) + 100 first game + 150 team win = 413, and 50 +
// 413 reaches level 13, one past the provisional 12.
function teamWinXp() {
  return serverXp({
    breakdown: {
      ...BREAKDOWN,
      placement: 0,
      win: 150,
      subtotal: 413,
      total: 413,
    },
    after: { ...serverXp().after, level: 13, xpInLevel: 63 },
    levelsReached: levels(10, 11, 12, 13),
  });
}

// The end of an FFA game "me" won, still standing at tick 6000, as the Win
// update's stats have it (final tiles recorded). Provisional figure: 50
// played + floor(6000 * 17 / 600) = 170 time + floor(150 * 2 * 3 / (2 * 20))
// = 22 placement + floor(300 * 3 / 20) = 45 win + 100 first game = 387.
function endStats(): AllPlayersStats {
  return {
    me: { attacks: [100n], finalTiles: 900n },
    early: { killedAt: 2000n, finalTiles: 0n },
    late: { killedAt: 5000n, finalTiles: 0n },
  };
}

// The worker's snapshot a moment after: how far the game has got, and who
// is disconnected.
function endSnapshot(): HumanStatsSnapshot {
  return { tick: 6000, stats: endStats(), disconnectedAt: {} };
}

const END_BREAKDOWN = {
  leftEarly: false,
  played: 50,
  time: 170,
  placement: 22,
  win: 45,
  firstGame: 100,
  feats: 0,
  subtotal: 387,
  gamePermille: 1000,
  subscriberPermille: 1000,
  total: 387,
};

// The server's figure for it. By default the provisional one exactly: 50 +
// 387 is four levels up (the level-10 milestone among them), 37 into 13.
function endServerXp(overrides: Record<string, unknown> = {}) {
  return serverXp({
    breakdown: END_BREAKDOWN,
    after: { ...serverXp().after, level: 13, xpInLevel: 37, lifetimeXp: 1237 },
    levelsReached: levels(10, 11, 12, 13),
    ...overrides,
  });
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

// A game the local player has just died in (or, `alive`, is still playing).
// `end()` delivers the win update on the next tick, with `winner` and the
// voted stats `winStats`.
function makeGame(
  opts: {
    gameMode?: GameMode;
    stats?: () => HumanStatsSnapshot | Promise<HumanStatsSnapshot>;
    alive?: boolean;
    winner?: Winner;
    winStats?: AllPlayersStats;
    // The tick the Win update comes on.
    winTick?: number;
    // The player the result names can't be found: this client doesn't vote.
    unknownWinner?: boolean;
  } = {},
) {
  let ended = false;
  let delivered = false;
  const humanStats = vi.fn(async () => (opts.stats ?? snapshot)());
  // The worker's narrow answer at the end: the same snapshot, without stats.
  const humanDisconnects = vi.fn(async () => {
    const { tick, disconnectedAt } = await (opts.stats ?? snapshot)();
    return { tick, disconnectedAt };
  });
  const game = {
    gameID: () => GAME_ID,
    ticks: () => opts.winTick ?? 6000,
    myClientID: () => "me",
    myPlayer: () => ({
      isAlive: () => opts.alive ?? false,
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
          {
            winner: "winner" in opts ? opts.winner : ["team", "Red"],
            allPlayersStats: opts.winStats ?? {},
          },
        ],
      };
    },
    playerByClientID: (id: string) =>
      opts.unknownWinner
        ? undefined
        : {
            isPlayer: () => true,
            clientID: () => id,
            displayName: () => id,
          },
    worker: { humanStats, humanDisconnects },
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
    resumedFromSave: () => false,
  } as unknown as GameView;
  return { game, humanStats, humanDisconnects, end: () => (ended = true) };
}

describe("WinModal provisional XP at death", () => {
  let modal: WinModal;

  beforeEach(() => {
    vi.useFakeTimers();
    getUserMe.mockResolvedValue(signedIn);
    fetchUserMeUncached.mockResolvedValue(signedIn);
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
    fetchUserMeUncached.mockReset();
  });

  // `hidden`: the player closes the death modal straight away, before the
  // provisional figure arrives.
  async function mount(game: GameView, hidden = false): Promise<void> {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = new EventBus();
    Object.assign(modal as unknown as { rand: number }, { rand: 0.75 });
    document.body.appendChild(modal);
    modal.tick();
    if (hidden) modal.hide();
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
    // Fresh account state for today's allowances, past the page's cache.
    expect(fetchUserMeUncached).toHaveBeenCalled();
    expect(invalidateUserMe).not.toHaveBeenCalled();
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
    stubXpEndpoint(() => json(teamWinXp()));
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

  it("carries a provisional reveal still playing on into the team win's levels", async () => {
    stubXpEndpoint(() => json(teamWinXp()));
    const { game, end } = makeGame({ gameMode: GameMode.Team });
    await mount(game);

    // The game ends while the provisional reveal is at its first level-up.
    for (let i = 0; i < 400 && currentLevel() !== 10; i++) await settle(50);
    expect(currentLevel()).toBe(10);
    expect(revealing()).toBe(true);

    await endGame(end);
    expect(xpState()).toBe("result");
    // Nothing the bar hadn't reached is skipped: 11 and 12 still get their
    // moment, then the win's 13. Level 10 isn't celebrated twice.
    expect((await playOut()).moments).toEqual(["11", "12", "13"]);
    expect(total()).toContain('"xp":"413"');
    expect(currentLevel()).toBe(13);
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

  it("puts a lower placement down to an opponent who came back, without logging drift", async () => {
    const warn = vi.spyOn(console, "warn");
    // "blip" had disconnected when "me" died, so counted as out before:
    // placement floor(150 * 2 * 4 / (3 * 20)) = 20, 283 in all. Back a moment
    // later, the server doesn't count them: floor(150 * 1 * 4 / (3 * 20)) =
    // 10 placement, 273.
    const withBlip = (): HumanStatsSnapshot => {
      const s = snapshot();
      return {
        ...s,
        stats: { ...s.stats, blip: { attacks: [5n] } },
        disconnectedAt: { blip: 3900 },
      };
    };
    stubXpEndpoint(() =>
      json(
        serverXp({
          breakdown: { ...BREAKDOWN, placement: 10, subtotal: 273, total: 273 },
          after: { ...serverXp().after, xpInLevel: 23, lifetimeXp: 1123 },
        }),
      ),
    );
    const { game, end } = makeGame({ stats: withBlip });
    await mount(game);
    await finishReveal();
    expect(total()).toContain('"xp":"283"');

    await endGame(end);
    expect(xpState()).toBe("result");
    expect(notes()).toEqual([
      'progression.provisional_was:{"xp":"283"}',
      "progression.reconcile_reconnect",
    ]);
    expect(warn).not.toHaveBeenCalledWith(
      "Provisional XP differed from the server's",
      expect.anything(),
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

  describe("kept for the account menu and profile", () => {
    beforeEach(() => {
      localStorage.clear();
      // Drops the store's parsed copy too.
      stopProvisionalProgress();
    });
    afterEach(() => localStorage.clear());

    it("keeps an eligible figure for the account, marked scored once it is", async () => {
      let asked = 0;
      stubXpEndpoint(() =>
        asked++ === 0 ? new Response("", { status: 404 }) : json(serverXp()),
      );
      const { game, end } = makeGame();
      await mount(game);
      // Counted on the account as read at death (lifetime 850), unasked.
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({ gameId: GAME_ID, xp: 274, notIn: 850 }),
      ]);
      // Another account on this browser has none.
      expect(readPendingXp("someone-else")).toEqual([]);

      await endGame(end);
      await settle(3_000);
      expect(xpState()).toBe("result");
      // Kept, with the API's figure: a stale read of the account still
      // shows the game, and a fresh one doesn't count it again.
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({
          gameId: GAME_ID,
          scored: { xp: 274, lifetimeAfter: 1124 },
        }),
      ]);
    });

    it("keeps it while the server hasn't scored the game", async () => {
      stubXpEndpoint(() => new Response("", { status: 404 }));
      const { game, end } = makeGame();
      await mount(game);
      await endGame(end);
      await settle(60_000);
      expect(readPendingXp("me")).toHaveLength(1);
    });

    it("starts the next game's figure from the pending game's level, without its first-game bonus", async () => {
      // Game A, left earlier today and not scored yet: 250 provisional XP
      // (with today's first-game bonus) takes level 9 at 50 to level 12 at 0.
      recordPendingXp("me", {
        gameId: "gA",
        xp: 250,
        day: PROGRESS.daily.day,
        kind: "public",
        firstGame: 100,
        // Recorded at A's death, from the account then.
        notIn: PROGRESS.lifetimeXp,
      });
      const asked: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          asked.push(String(input));
          return new Response("", { status: 404 });
        }),
      );
      const { game } = makeGame();
      await mount(game);
      // Death asks nothing: the stored answers decide.
      expect(asked).toEqual([]);
      expect(xpState()).toBe("provisional");
      const { moments, cards } = await playOut();
      // From level 12, 174 XP reaches level 13; A's levels (and its level-10
      // milestone) aren't celebrated again.
      expect(moments.join(" ")).not.toContain('"level":10');
      expect(cards).toEqual([]);
      await finishReveal();
      expect(currentLevel()).toBe(13);
      // Game B: 274 less the first-game bonus A took.
      expect(total()).toContain('"xp":"174"');
      // Both stay pending, stacked, for the account menu and profile.
      expect(
        readPendingXp("me").map((e) => [e.gameId, e.xp, e.firstGame]),
      ).toEqual([
        ["gA", 250, 100],
        [GAME_ID, 174, 0],
      ]);
    });

    it("keeps nothing for an ineligible death", async () => {
      stubXpEndpoint(() => new Response("", { status: 404 }));
      const { game } = makeGame({
        stats: () => ({
          ...snapshot(),
          stats: { ...snapshot().stats, me: { killedAt: 4000n } },
        }),
      });
      await mount(game);
      expect(xpState()).toBe("provisional_ineligible");
      expect(readPendingXp("me")).toEqual([]);
    });
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

  it("confirms afresh when detached mid-confirm and re-attached", async () => {
    // Not processed yet on the first ask.
    const firstFetch = stubXpEndpoint(() => new Response("", { status: 404 }));
    const { game, end } = makeGame();
    await mount(game);
    await playOut();
    await endGame(end);
    expect(panel()!.querySelector("[data-xp-confirming]")).not.toBeNull();
    const view = () =>
      (
        modal as unknown as {
          xpView: { kind: string; confirming?: boolean; reconciled?: unknown };
        }
      ).xpView;

    // Detaching aborts the poll: the provisional figure stays, confirming.
    modal.remove();
    await settle(3_000);
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(view()).toMatchObject({ kind: "provisional", confirming: true });

    // The Win update is spent: re-attaching alone asks again, and the
    // server's figure is reconciled with the provisional one.
    const fetchMock = stubXpEndpoint(() => json(serverXp()));
    document.body.appendChild(modal);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(xpState()).toBe("result");
    expect(view().reconciled).toBeDefined();
    expect(panel()!.querySelector("[data-xp-confirmed]")).not.toBeNull();
    // Nothing replays: the levels were celebrated at death.
    expect(await playOut()).toEqual({ moments: [], cards: [] });
    expect(total()).toContain('"xp":"274"');
  });

  describe("a fresh /users/@me at death", () => {
    it("counts today's allowances from it", async () => {
      // Another public game has been scored since this one started.
      fetchUserMeUncached.mockResolvedValue({
        ...signedIn,
        player: {
          ...signedIn.player,
          progress: {
            ...PROGRESS,
            daily: { ...PROGRESS.daily, firstGameClaimed: true },
          },
        },
      });
      stubXpEndpoint(() => json(serverXp()));
      await mount(makeGame().game);
      await finishReveal();
      expect(total()).toContain('"xp":"174"');
      expect(panel()!.querySelector('[data-xp-line="firstGame"]')).toBeNull();
    });

    it("falls back to the page's copy when it fails, and the game end still confirms", async () => {
      fetchUserMeUncached.mockResolvedValue(false);
      stubXpEndpoint(() => json(serverXp()));
      const { game, end } = makeGame();
      await mount(game);

      expect(xpState()).toBe("provisional");
      expect(await playOut()).toEqual({
        moments: ["10", "11", "12"],
        cards: ["10"],
      });
      expect(total()).toContain('"xp":"274"');

      await endGame(end);
      expect(xpState()).toBe("result");
      expect(panel()!.querySelector("[data-xp-confirmed]")).not.toBeNull();
      expect(total()).toContain('"xp":"274"');
      // The page's copy was never dropped.
      expect(invalidateUserMe).not.toHaveBeenCalled();
    });
  });

  // The provisional reveal never played if the death modal was closed before
  // the figure arrived, or mid-reveal: the server's figure gets it in full.
  describe("a provisional figure the player never saw", () => {
    it("plays the matching server figure in full", async () => {
      stubXpEndpoint(() => json(serverXp()));
      const { game, end } = makeGame();
      await mount(game, true);
      expect(xpState()).toBe("provisional");
      expect(revealing()).toBe(false);

      await endGame(end);
      expect(xpState()).toBe("result");
      expect(panel()!.querySelector("[data-xp-confirmed]")).not.toBeNull();
      expect(await playOut()).toEqual({
        moments: ["10", "11", "12"],
        cards: ["10"],
      });
      expect(currentLevel()).toBe(12);
    });

    it("plays a higher server figure in full, not just the extra levels", async () => {
      stubXpEndpoint(() => json(teamWinXp()));
      const { game, end } = makeGame({ gameMode: GameMode.Team });
      await mount(game, true);
      expect(xpState()).toBe("provisional");

      await endGame(end);
      expect(xpState()).toBe("result");
      expect(await playOut()).toEqual({
        moments: ["10", "11", "12", "13"],
        cards: ["10"],
      });
      expect(total()).toContain('"xp":"413"');
      expect(currentLevel()).toBe(13);
    });

    it("plays the server figure in full when the provisional reveal was cut short", async () => {
      stubXpEndpoint(() => json(serverXp()));
      const { game, end } = makeGame();
      await mount(game);
      await settle(100);
      expect(revealing()).toBe(true);
      modal.hide();
      await settle();
      expect(revealing()).toBe(false);

      await endGame(end);
      expect(await playOut()).toEqual({
        moments: ["10", "11", "12"],
        cards: ["10"],
      });
    });
  });

  describe("falls back to 'XP is awarded when the game ends'", () => {
    it("for another formula revision", async () => {
      fetchProgressionConfig.mockResolvedValue({ ...CONFIG, formula: 2 });
      const { game, humanStats } = makeGame();
      await mount(game);
      expect(xpState()).toBe("awaiting_end");
      expect(humanStats).not.toHaveBeenCalled();
      expect(fetchUserMeUncached).not.toHaveBeenCalled();
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

  describe("a player still in the game when it ends", () => {
    beforeEach(() => {
      localStorage.clear();
      stopProvisionalProgress();
    });
    afterEach(() => localStorage.clear());

    function aliveGame(
      opts: Partial<Parameters<typeof makeGame>[0]> = {},
    ): ReturnType<typeof makeGame> {
      return makeGame({
        alive: true,
        winner: ["player", "me"],
        winStats: endStats(),
        stats: endSnapshot,
        ...opts,
      });
    }

    const view = () =>
      (
        modal as unknown as {
          xpView: {
            kind: string;
            provisional?: { inputs: { atGameEnd: boolean } };
            reconciled?: unknown;
          };
        }
      ).xpView;

    it("counts time played up to the Win update, not the later snapshot", async () => {
      stubXpEndpoint(() => new Response("", { status: 404 }));
      // The worker's snapshot is taken 3,000 ticks after the win (the game
      // ran on): 255 time XP there, 170 at the win.
      const { game, end } = aliveGame({
        winTick: 6000,
        stats: () => ({ ...endSnapshot(), tick: 9000 }),
      });
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("provisional");
      await playOut();
      expect(total()).toContain('"xp":"387"');
    });

    it("sees a provisional figure at once, the win included, while the server is asked", async () => {
      const fetchMock = stubXpEndpoint(() => new Response("", { status: 404 }));
      const { game, end } = aliveGame();
      await mount(game);
      // Nothing while the game runs.
      expect(xpState()).toBe("hidden");

      await endGame(end);
      expect(xpState()).toBe("provisional");
      expect(panel()!.querySelector("[data-xp-confirming]")).not.toBeNull();
      expect(
        panel()!.querySelector("[data-xp-provisional]")!.textContent,
      ).toContain("progression.provisional_confirming");
      // The server is asked straight away; the account isn't read again.
      expect(fetchMock).toHaveBeenCalled();
      expect(fetchUserMeUncached).not.toHaveBeenCalled();
      // The normal reveal, every level-up and the milestone included.
      expect(await playOut()).toEqual({
        moments: ["10", "11", "12", "13"],
        cards: ["10"],
      });
      expect(total()).toContain('"xp":"387"');
      expect(panel()!.querySelector('[data-xp-line="win"]')).not.toBeNull();
      expect(currentLevel()).toBe(13);
      // The end has settled what was pending: nothing left to add.
      expect(panel()!.querySelector("[data-xp-reconcile]")).toBeNull();
    });

    it("knows the team's win in a team game", async () => {
      stubXpEndpoint(() => new Response("", { status: 404 }));
      const { game, end } = aliveGame({
        gameMode: GameMode.Team,
        winner: ["team", "Red", "me"],
      });
      await mount(game);
      await endGame(end);
      await finishReveal();
      // 50 + 170 + 150 team win + 100: no placement in a team game.
      expect(total()).toContain('"xp":"470"');
      expect(panel()!.querySelector("[data-xp-reconcile]")).toBeNull();
    });

    it("swaps in the server's figure, confirming a match quietly", async () => {
      let asked = 0;
      stubXpEndpoint(() =>
        asked++ === 0 ? new Response("", { status: 404 }) : json(endServerXp()),
      );
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("provisional");
      await finishReveal();

      await settle(3_000);
      expect(xpState()).toBe("result");
      expect(view().reconciled).toBeDefined();
      expect(
        panel()!.querySelector("[data-xp-confirmed]")!.textContent,
      ).toContain("progression.xp_confirmed");
      // Nothing replays.
      expect(await playOut()).toEqual({ moments: [], cards: [] });
      expect(total()).toContain('"xp":"387"');
    });

    it("confirms quietly when the server only counted the game a little longer", async () => {
      const warn = vi.spyOn(console, "warn");
      // The server counted the game a few turns longer: one more XP.
      let asked = 0;
      stubXpEndpoint(() =>
        asked++ === 0
          ? new Response("", { status: 404 })
          : json(
              endServerXp({
                breakdown: {
                  ...END_BREAKDOWN,
                  time: 171,
                  subtotal: 388,
                  total: 388,
                },
                after: {
                  ...endServerXp().after,
                  xpInLevel: 38,
                  lifetimeXp: 1238,
                },
              }),
            ),
      );
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("provisional");
      await finishReveal();
      await settle(3_000);
      expect(xpState()).toBe("result");
      // "XP confirmed", nothing replayed, no note: but the server's numbers.
      expect(
        panel()!.querySelector("[data-xp-confirmed]")!.textContent,
      ).toContain("progression.xp_confirmed");
      expect(revealing()).toBe(false);
      expect(await playOut()).toEqual({ moments: [], cards: [] });
      expect(panel()!.querySelector("[data-xp-reconcile]")).toBeNull();
      expect(total()).toContain('"xp":"388"');
      expect(
        panel()!.querySelector("[data-xp-header-level]")!.textContent,
      ).toContain('progression.xp_progress:{"current":"38","next":"100"}');
      expect(warn).not.toHaveBeenCalledWith(
        "Provisional XP differed from the server's",
        expect.anything(),
      );
    });

    it("shows the server's figure alone when it answers before one is worked out", async () => {
      stubXpEndpoint(() => json(endServerXp()));
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("result");
      expect(view().reconciled).toBeUndefined();
      expect(panel()!.querySelector("[data-xp-confirmed]")).toBeNull();
      expect((await playOut()).moments).toEqual(["10", "11", "12", "13"]);
    });

    it("keeps the figure, still provisional, if the server never answers", async () => {
      stubXpEndpoint(() => new Response("", { status: 404 }));
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      await finishReveal();
      await settle(60_000);

      expect(xpState()).toBe("provisional");
      expect(panel()!.querySelector("[data-xp-confirming]")).toBeNull();
      expect(
        panel()!.querySelector("[data-xp-provisional]")!.textContent,
      ).toContain("progression.provisional_label");
      expect(total()).toContain('"xp":"387"');
    });

    it("keeps the figure for the account menu and profile until it is scored", async () => {
      let asked = 0;
      stubXpEndpoint(() =>
        asked++ === 0 ? new Response("", { status: 404 }) : json(endServerXp()),
      );
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      // Counted on the account as the page read it before the game ended.
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({
          gameId: GAME_ID,
          xp: 387,
          firstGame: 100,
          kind: "public",
          notIn: 850,
        }),
      ]);

      await settle(3_000);
      expect(xpState()).toBe("result");
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({
          gameId: GAME_ID,
          scored: { xp: 387, lifetimeAfter: 1237 },
        }),
      ]);
    });

    it("still shows and keeps the figure when the poll gives up before it is ready", async () => {
      // Signed out of the API (401): the poll answers null at once, while
      // the worker is still to answer.
      stubXpEndpoint(() => new Response("", { status: 401 }));
      let answer: () => void = () => {};
      const ready = new Promise<void>((resolve) => (answer = resolve));
      const { game, end } = aliveGame({
        stats: async () => {
          await ready;
          return endSnapshot();
        },
      });
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("hidden");

      answer();
      await settle();
      expect(xpState()).toBe("provisional");
      // No answer is coming: provisional, not confirming.
      expect(panel()!.querySelector("[data-xp-confirming]")).toBeNull();
      await finishReveal();
      expect(total()).toContain('"xp":"387"');
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({ gameId: GAME_ID, xp: 387 }),
      ]);
    });

    it("stops working out the figure once the server has answered", async () => {
      stubXpEndpoint(() => json(endServerXp()));
      // The rules come slowly: the server's figure arrives first.
      let answer: () => void = () => {};
      fetchProgressionConfig.mockReturnValue(
        new Promise((resolve) => (answer = () => resolve(CONFIG))),
      );
      const { game, end, humanDisconnects } = aliveGame();
      await mount(game);
      await endGame(end);
      expect(xpState()).toBe("result");

      answer();
      await settle(1_000);
      // The leftover load was called off before asking the worker.
      expect(humanDisconnects).not.toHaveBeenCalled();
      expect(view().reconciled).toBeUndefined();
      expect(readPendingXp("me")).toEqual([
        expect.objectContaining({ scored: { xp: 387, lifetimeAfter: 1237 } }),
      ]);
    });

    it("takes away the win the server's result gave someone else", async () => {
      let asked = 0;
      // The server's replay named "late": 387 less the 45 win is 342, and
      // 50 + 342 is level 12 at 92.
      stubXpEndpoint(() =>
        asked++ === 0
          ? new Response("", { status: 404 })
          : json(
              endServerXp({
                breakdown: {
                  ...END_BREAKDOWN,
                  win: 0,
                  subtotal: 342,
                  total: 342,
                },
                after: {
                  ...endServerXp().after,
                  level: 12,
                  xpInLevel: 92,
                  lifetimeXp: 1192,
                },
                levelsReached: levels(10, 11, 12),
              }),
            ),
      );
      const warn = vi.spyOn(console, "warn");
      const { game, end } = aliveGame();
      await mount(game);
      await endGame(end);
      await finishReveal();
      await settle(3_000);
      expect(xpState()).toBe("result");
      expect(total()).toContain('"xp":"342"');
      expect(notes()).toEqual([
        'progression.provisional_was:{"xp":"387"}',
        "progression.reconcile_win_removed",
        'progression.reconcile_level_adjusted:{"level":"12"}',
      ]);
      expect(warn).not.toHaveBeenCalledWith(
        "Provisional XP differed from the server's",
        expect.anything(),
      );
    });

    it("adds a win the server's result gave this player, in FFA", async () => {
      let asked = 0;
      stubXpEndpoint(() =>
        asked++ === 0 ? new Response("", { status: 404 }) : json(endServerXp()),
      );
      // This client's simulation named "late": no win in its figure, 342.
      const { game, end } = aliveGame({ winner: ["player", "late"] });
      await mount(game);
      await endGame(end);
      await finishReveal();
      expect(total()).toContain('"xp":"342"');
      await settle(3_000);
      expect(xpState()).toBe("result");
      await finishReveal();
      expect(total()).toContain('"xp":"387"');
      // Not "your team won": this is FFA.
      expect(notes()).toEqual([
        'progression.provisional_was:{"xp":"342"}',
        "progression.reconcile_win",
      ]);
    });

    describe("the account it starts from", () => {
      // The account once this game is scored: 850 + 387, the day's first
      // game taken by it.
      const afterThisGame = {
        ...signedIn,
        player: {
          ...signedIn.player,
          progress: {
            ...PROGRESS,
            level: 13,
            xpInLevel: 37,
            lifetimeXp: 1237,
            daily: { ...PROGRESS.daily, firstGameClaimed: true },
          },
        },
      };

      it("is the one read while the game was on, even if the page's copy was refetched since", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        const { game, end } = aliveGame();
        await mount(game);
        modal.init();
        await settle();
        // Mid-game the page's copy is dropped (an earlier game scored, say)
        // and refetched at the end, by when the server has scored this one.
        getUserMe.mockResolvedValue(afterThisGame);
        await endGame(end);
        await finishReveal();
        // From level 9 at 50, the first game of the day included.
        expect(total()).toContain('"xp":"387"');
        expect(currentLevel()).toBe(13);
        expect(readPendingXp("me")).toEqual([
          expect.objectContaining({ xp: 387, notIn: 850 }),
        ]);
      });

      it("is the page's copy when nothing was read while the game was on", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        const { game, end } = aliveGame();
        await mount(game);
        getUserMe.mockResolvedValue(afterThisGame);
        await endGame(end);
        await finishReveal();
        // Today's behaviour: the page's copy, as it now stands.
        expect(total()).toContain('"xp":"287"');
      });
    });

    describe("falls back to 'Calculating XP…'", () => {
      it("for another formula revision", async () => {
        fetchProgressionConfig.mockResolvedValue({ ...CONFIG, formula: 2 });
        stubXpEndpoint(() => new Response("", { status: 404 }));
        const { game, end, humanDisconnects } = aliveGame();
        await mount(game);
        await endGame(end);
        expect(xpState()).toBe("calculating");
        expect(humanDisconnects).not.toHaveBeenCalled();
        expect(readPendingXp("me")).toEqual([]);
      });

      it("when this client cast no vote, rather than a figure with the win", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        const sent: unknown[] = [];
        // The winner named can't be found here: no vote goes out.
        const { game, end, humanDisconnects } = aliveGame({
          unknownWinner: true,
        });
        await mount(game);
        modal.eventBus.on(SendWinnerEvent, (e) => sent.push(e));
        await endGame(end);
        expect(sent).toEqual([]);
        expect(xpState()).toBe("calculating");
        expect(humanDisconnects).not.toHaveBeenCalled();
        expect(readPendingXp("me")).toEqual([]);
      });

      it("for a singleplayer game the API doesn't score", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        const { game, end, humanDisconnects: humanStats } = aliveGame();
        const config = game.config().gameConfig();
        (game as unknown as { config: () => unknown }).config = () => ({
          gameConfig: () => ({ ...config, gameType: GameType.Singleplayer }),
          isReplay: () => false,
        });
        await mount(game);
        await endGame(end);
        expect(xpState()).toBe("calculating");
        expect(humanStats).not.toHaveBeenCalled();
      });

      it("while the game is slow to answer, and the server's figure then plays in full", async () => {
        let asked = 0;
        stubXpEndpoint(() =>
          asked++ === 0
            ? new Response("", { status: 404 })
            : json(endServerXp()),
        );
        const { game, end } = aliveGame({ stats: () => new Promise(() => {}) });
        await mount(game);
        await endGame(end);
        // A moment's grace, then the wait is said.
        expect(xpState()).toBe("hidden");
        await settle(500);
        expect(xpState()).toBe("calculating");

        await settle(2_500);
        expect(xpState()).toBe("result");
        expect(view().reconciled).toBeUndefined();
        expect((await playOut()).moments).toEqual(["10", "11", "12", "13"]);
        expect(readPendingXp("me")).toEqual([
          expect.objectContaining({ scored: { xp: 387, lifetimeAfter: 1237 } }),
        ]);
      });
    });

    describe("no second figure for a player who already died", () => {
      it("keeps the one from the death", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        // Died at 4000 (the death figure: 274); someone else won.
        const { game, end, humanStats, humanDisconnects } = makeGame({
          winner: ["player", "alive"],
          winStats: snapshot().stats,
        });
        await mount(game);
        expect(xpState()).toBe("provisional");
        expect(humanStats).toHaveBeenCalledTimes(1);

        await endGame(end);
        expect(xpState()).toBe("provisional");
        expect(view().provisional?.inputs.atGameEnd).toBe(false);
        expect(humanStats).toHaveBeenCalledTimes(1);
        expect(humanDisconnects).not.toHaveBeenCalled();
        expect(readPendingXp("me")).toEqual([
          expect.objectContaining({ gameId: GAME_ID, xp: 274 }),
        ]);
        await finishReveal();
        expect(total()).toContain('"xp":"274"');
      });

      it("works out one only once when the game ends before the death's figure is ready", async () => {
        stubXpEndpoint(() => new Response("", { status: 404 }));
        // The death's fresh read of the account never comes back.
        fetchUserMeUncached.mockReturnValue(new Promise(() => {}));
        const { game, end } = makeGame({
          winner: ["player", "alive"],
          winStats: snapshot().stats,
        });
        await mount(game);
        expect(xpState()).toBe("hidden");

        await endGame(end);
        expect(xpState()).toBe("provisional");
        expect(view().provisional?.inputs.atGameEnd).toBe(true);
        await finishReveal();
        // The death's figure, from the finished game: 274 as before.
        expect(total()).toContain('"xp":"274"');
        expect(readPendingXp("me")).toHaveLength(1);
      });
    });
  });
});
