import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserMe, fetchProgressionConfig, isLoggedIn } = vi.hoisted(() => ({
  getUserMe: vi.fn(),
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

vi.mock("../../../../src/client/Api", () => ({ getUserMe }));

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

import { GameType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventBus } from "@openfront/shared/EventBus";
import type { GameXpPanel } from "../../../../src/client/components/GameXpPanel";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import type { GameView } from "../../../../src/client/view";

const GAME_ID = "gXPTEST01";
const XP_URL = `https://api.test/users/@me/xp/${GAME_ID}`;

// Progression on: /users/@me carries progress, level 1 before any XP.
const signedIn = {
  user: { email: "player@example.com" },
  player: {
    publicId: "me",
    progress: {
      prestige: 0,
      level: 1,
      xpInLevel: 0,
      xpForNext: 150,
      lifetimeXp: 0,
      legend: false,
      canPrestige: false,
    },
  },
};
const anonymous = { user: {}, player: { publicId: "anon" } };

function eligible(overrides: Record<string, unknown> = {}) {
  return {
    gameId: GAME_ID,
    eligible: true,
    breakdown: {
      leftEarly: false,
      played: 50,
      time: 20,
      placement: 0,
      win: 100,
      firstGame: 0,
      feats: 0,
      subtotal: 170,
      gamePermille: 1250,
      subscriberPermille: 1000,
      total: 212,
    },
    before: { prestige: 0, level: 4, xpInLevel: 300, xpForNext: 400 },
    after: {
      prestige: 0,
      level: 4,
      xpInLevel: 512,
      xpForNext: 400,
      lifetimeXp: 2000,
      legend: false,
      canPrestige: false,
    },
    levelsReached: [],
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Answers the XP endpoint from a queue; once it runs dry, the last answer
// repeats. Anything else is a test bug.
function stubXpEndpoint(answers: (() => Response)[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url !== XP_URL) throw new Error(`unexpected fetch ${url}`);
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const notFound = () => new Response("", { status: 404 });

function makeGame(opts: {
  ended: boolean;
  alive?: boolean;
  replay?: boolean;
  gameType?: GameType;
}) {
  const winUpdate = { winner: ["team", "Red"], allPlayersStats: {} };
  let delivered = false;
  return {
    gameID: () => GAME_ID,
    myPlayer: () => ({
      isAlive: () => opts.alive ?? true,
      hasSpawned: () => true,
      team: () => "Red",
      clientID: () => "me",
    }),
    inSpawnPhase: () => false,
    updatesSinceLastTick: () => {
      if (!opts.ended || delivered) return {};
      delivered = true;
      return { [GameUpdateType.Win]: [winUpdate] };
    },
    playerByClientID: () => undefined,
    config: () => ({
      gameConfig: () => ({
        rankedType: undefined,
        gameType: opts.gameType ?? GameType.Public,
      }),
      isReplay: () => opts.replay ?? false,
    }),
  } as unknown as GameView;
}

describe("WinModal XP section", () => {
  let modal: WinModal;

  beforeEach(() => {
    vi.useFakeTimers();
    getUserMe.mockResolvedValue(signedIn);
    isLoggedIn.mockResolvedValue(true);
    fetchProgressionConfig.mockResolvedValue({
      version: 1,
      maxLevel: 100,
      maxPrestige: 10,
      levels: [],
    });
    vi.spyOn(history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    modal?.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(game: GameView): Promise<void> {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = new EventBus();
    // Pin the promo slot to the pattern promo (the Steam wishlist one needs
    // ResizeObserver, which jsdom lacks).
    Object.assign(modal as unknown as { rand: number }, { rand: 0.75 });
    document.body.appendChild(modal);
    modal.tick();
    await settle();
  }

  async function settle(ms = 0): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
    await modal.updateComplete;
    const panel = modal.querySelector<GameXpPanel>("game-xp-panel");
    await panel?.updateComplete;
  }

  function panel(): HTMLElement | null {
    return modal.querySelector<HTMLElement>("game-xp-panel [data-xp-panel]");
  }

  // The result animates in (a caption per XP source, the bar climbing).
  // Tapping skips to the end, as a player can.
  async function finishReveal(): Promise<void> {
    panel()?.click();
    await settle();
  }

  function xpState(): string {
    return panel()?.getAttribute("data-xp-state") ?? "hidden";
  }

  it("shows calculating while the game is processed, then the breakdown", async () => {
    const fetchMock = stubXpEndpoint([
      notFound,
      notFound,
      () => json(eligible()),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();

    expect(xpState()).toBe("calculating");
    expect(panel()!.textContent).toContain("progression.calculating");
    // Never a number while pending.
    expect(panel()!.textContent).not.toContain("progression.xp_total");

    await settle(3_000);
    expect(xpState()).toBe("calculating");

    await settle(3_000);
    expect(xpState()).toBe("result");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await finishReveal();
    const text = panel()!.textContent!;
    expect(text).toContain('progression.xp_total:{"xp":"212"}');
    // Non-zero lines only.
    const lines = [...panel()!.querySelectorAll("[data-xp-line]")].map((el) =>
      el.getAttribute("data-xp-line"),
    );
    expect(lines).toEqual(["played", "time", "win"]);
    // Only multipliers other than 1x.
    const multipliers = [
      ...panel()!.querySelectorAll("[data-xp-multiplier]"),
    ].map((el) => el.getAttribute("data-xp-multiplier"));
    expect(multipliers).toEqual(["game"]);
    // Shown like a group bonus: "+25% XP (GAME TYPE)".
    expect(text).toContain(
      'progression.bonus_line:{"percent":25,"source":"progression.multiplier_game"}',
    );
    expect(panel()!.querySelector("[data-xp-levelup]")).toBeNull();
    expect(panel()!.querySelector("[data-xp-left-early]")).toBeNull();
  });

  it("hides the section when the game is never processed in time", async () => {
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("calculating");

    await settle(60_000);
    expect(xpState()).toBe("hidden");
    expect(modal.querySelector("[data-xp-panel]")).toBeNull();
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(10);

    // And it stops asking.
    await settle(30_000);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("shows one friendly line for an ineligible game", async () => {
    stubXpEndpoint([
      () => json({ gameId: GAME_ID, eligible: false, reason: "too_short" }),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("ineligible");
    expect(panel()!.textContent!.trim()).toBe(
      "progression.ineligible_too_short",
    );
  });

  it("falls back to a generic line for an unknown reason", async () => {
    stubXpEndpoint([
      () => json({ gameId: GAME_ID, eligible: false, reason: "new_rule" }),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(panel()!.textContent!.trim()).toBe("progression.ineligible_generic");
  });

  it("tells a singleplayer game it doesn't earn XP, not that it couldn't be verified", async () => {
    stubXpEndpoint([
      () => json({ gameId: GAME_ID, eligible: false, reason: "unverified" }),
    ]);
    await mount(makeGame({ ended: true, gameType: GameType.Singleplayer }));
    await finishReveal();
    expect(panel()!.textContent!.trim()).toBe(
      "progression.ineligible_singleplayer",
    );
  });

  it("still says a multiplayer game's results couldn't be verified", async () => {
    stubXpEndpoint([
      () => json({ gameId: GAME_ID, eligible: false, reason: "unverified" }),
    ]);
    await mount(makeGame({ ended: true, gameType: GameType.Public }));
    await finishReveal();
    expect(panel()!.textContent!.trim()).toBe(
      "progression.ineligible_unverified",
    );
  });
  it("explains a left-early forfeit", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            breakdown: {
              ...eligible().breakdown,
              leftEarly: true,
              played: 0,
              placement: 0,
              win: 0,
              total: 20,
            },
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("result");
    expect(
      panel()!.querySelector("[data-xp-left-early]")?.textContent,
    ).toContain("progression.left_early");
  });

  it("gives ordinary level-ups no card, just the caption and the badge", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 4, xpInLevel: 300, xpForNext: 400 },
            after: {
              ...eligible().after,
              level: 7,
              xpInLevel: 50,
              xpForNext: 600,
            },
            levelsReached: [
              { prestige: 0, level: 5 },
              { prestige: 0, level: 6 },
              { prestige: 0, level: 7 },
            ],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(panel()!.querySelector("[data-xp-levelup]")).toBeNull();
    expect(panel()!.querySelector("[data-xp-caption]")!.textContent).toContain(
      'progression.level_reached:{"level":7}',
    );
    // The bar runs from the level the player is now on to the next one.
    const badgeLevel = (sel: string) =>
      (
        panel()!.querySelector(`${sel} level-badge`) as HTMLElement & {
          level: number;
        }
      ).level;
    expect(badgeLevel("[data-xp-current-badge]")).toBe(7);
    expect(badgeLevel("[data-xp-next-badge]")).toBe(8);
  });

  it("gives a milestone reached this game its own card", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 9, xpInLevel: 300, xpForNext: 330 },
            after: {
              ...eligible().after,
              level: 11,
              xpInLevel: 10,
              xpForNext: 370,
            },
            levelsReached: [
              { prestige: 0, level: 10 },
              { prestige: 0, level: 11 },
            ],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    // Passed 10 on the way to 11: the card is for 10, the milestone.
    const cards = panel()!.querySelectorAll("[data-xp-levelup]");
    expect(cards).toHaveLength(1);
    expect(cards[0].getAttribute("data-xp-milestone")).toBe("10");
    expect(cards[0].textContent).toContain("progression.new_milestone");
    expect(cards[0].textContent).toContain('progression.level:{"level":10}');
  });

  it("never shows a prestige change as a level-up", async () => {
    // A game can't prestige a player; an entry at another prestige is noise.
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 5, xpInLevel: 0, xpForNext: 230 },
            levelsReached: [{ prestige: 1, level: 1 }],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("result");
    expect(panel()!.querySelector("[data-xp-levelup]")).toBeNull();
  });

  it("gives becoming a Legend its own moment", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: {
              prestige: 10,
              level: 99,
              xpInLevel: 4400,
              xpForNext: 4510,
            },
            after: {
              ...eligible().after,
              prestige: 10,
              level: 100,
              xpInLevel: 0,
              xpForNext: 0,
              legend: true,
              lifetimeXp: 2106720,
            },
            levelsReached: [{ prestige: 10, level: 100 }],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    // The caption announces it; the card carries the lifetime XP.
    expect(panel()!.querySelector("[data-xp-caption]")?.textContent).toContain(
      "progression.legend_reached_title",
    );
    expect(panel()!.querySelector("[data-xp-legend]")?.textContent).toContain(
      "progression.legend_reached_body",
    );
    expect(panel()!.querySelector("[data-xp-levelup]")).toBeNull();
    // The end of the track: the crown on the left, no next level.
    const current = panel()!.querySelector(
      "[data-xp-current-badge] level-badge",
    ) as HTMLElement & { level: number; legend: boolean };
    expect(current.level).toBe(100);
    expect(current.legend).toBe(true);
    expect(panel()!.querySelector("[data-xp-next-badge]")).toBeNull();
  });

  it("shows a player who was already a Legend as one throughout the reveal", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 10, level: 100, xpInLevel: 0, xpForNext: 0 },
            after: {
              ...eligible().after,
              prestige: 10,
              level: 100,
              xpInLevel: 0,
              xpForNext: 0,
              legend: true,
              lifetimeXp: 2200000,
            },
            levelsReached: [],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    const currentLegend = () =>
      (
        panel()!.querySelector("[data-xp-current-badge] level-badge") as
          | (HTMLElement & { legend: boolean; level: number })
          | null
      )?.legend;
    expect(panel()!.getAttribute("data-xp-revealing")).toBe("true");
    expect(currentLegend()).toBe(true);
    // And every frame of the reveal after it, not just the first.
    for (let i = 0; i < 400; i++) {
      await settle(50);
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
      expect(currentLegend()).toBe(true);
    }
    expect(currentLegend()).toBe(true);
    // Not this game's moment: no Legend card or caption.
    expect(panel()!.querySelector("[data-xp-legend]")).toBeNull();
    expect(panel()!.querySelector("[data-xp-caption-legend]")).toBeNull();
  });

  it("reveals the XP a source at a time, then settles on the award", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    expect(xpState()).toBe("result");
    expect(panel()!.getAttribute("data-xp-revealing")).toBe("true");
    // Nothing counted yet. Every card's slot is laid out from the start,
    // hidden, so the panel never changes size.
    expect(panel()!.querySelector("[data-xp-total]")!.textContent).toContain(
      '"xp":"0"',
    );
    const hiddenSlots = () =>
      panel()!.querySelectorAll("[data-xp-slot-hidden]").length;
    // A card for each of the three sources; the game-type multiplier is a
    // bonus line under the counter, not a card.
    expect(panel()!.querySelectorAll("[data-xp-card]")).toHaveLength(3);
    expect(panel()!.querySelector("[data-xp-bonuses]")).not.toBeNull();
    expect(hiddenSlots()).toBe(4);

    // The captions roll through the sources in order, and each source's card
    // lands as its caption finishes.
    const captions: string[] = [];
    const hiddenCounts: number[] = [];
    for (let i = 0; i < 40; i++) {
      await settle(100);
      const text =
        panel()?.querySelector("[data-xp-caption]")?.textContent ?? "";
      const last = captions[captions.length - 1];
      if (text.trim() !== "" && text !== last) captions.push(text);
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
      hiddenCounts.push(hiddenSlots());
    }
    const order = ["line_played", "line_time", "line_win"].map((key) =>
      captions.findIndex((c) => c.includes("progression." + key)),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // One at a time: 4 hidden, then 3, 2, and the bonus line last.
    expect([...new Set(hiddenCounts)].slice(0, 4)).toEqual([4, 3, 2, 1]);
    // The multiplier gets its own caption; the award never does, it is the
    // counter's number.
    expect(
      captions.some((c) => c.includes("progression.multiplier_game")),
    ).toBe(true);
    expect(captions.some((c) => c.includes('"xp":"212"'))).toBe(false);

    // Run it out: the counter lands on the award and every card is up.
    await settle(20_000);
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.querySelector("[data-xp-total]")!.textContent).toContain(
      '"xp":"212"',
    );
    expect(hiddenSlots()).toBe(0);
  });

  it("applies a multiplier to the cards, which add up to the award", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    const values = () =>
      [...panel()!.querySelectorAll("[data-xp-card]")]
        .filter((c) => c.querySelector("[data-xp-line]"))
        .map(
          (c) =>
            JSON.parse(
              c
                .querySelector("[data-xp-card-value]")!
                .textContent!.trim()
                .replace("progression.xp_total:", ""),
            ).xp,
        );
    // Face values while the sources come in.
    expect(values()).toEqual(["50", "20", "100"]);
    // The boost wipes across the cards, turning them over first to last:
    // at some point the first card is boosted while the last isn't yet.
    let wiped = false;
    let inOrder = false;
    for (let i = 0; i < 200; i++) {
      await settle(50);
      if (panel()!.querySelector(".xp-card-wipe")) wiped = true;
      const v = values();
      if (v[0] !== "50" && v[2] === "100") inOrder = true;
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
    }
    expect(wiped).toBe(true);
    expect(inOrder).toBe(true);
    // 170 x1.25, awarded as 212, split across the cards.
    expect(values()).toEqual(["62", "25", "125"]);
  });

  it("keeps no space for a milestone or a bonus until the reveal gets to it", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 9, xpInLevel: 300, xpForNext: 330 },
            after: {
              ...eligible().after,
              level: 10,
              xpInLevel: 182,
              xpForNext: 370,
            },
            levelsReached: [{ prestige: 0, level: 10 }],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    const space = (sel: string) =>
      panel()!
        .querySelector(sel)!
        .closest("[data-xp-collapsible]")!
        .getAttribute("data-xp-collapsible");
    // Closed at the start: nothing hints at what is coming.
    expect(space("[data-xp-levelup]")).toBe("closed");
    expect(space("[data-xp-bonuses]")).toBe("closed");
    // The milestone opens its space when the bar reaches it, before the
    // bonus does.
    let milestoneFirst = false;
    for (let i = 0; i < 400; i++) {
      await settle(50);
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
      if (
        space("[data-xp-levelup]") === "open" &&
        space("[data-xp-bonuses]") === "closed"
      ) {
        milestoneFirst = true;
      }
    }
    expect(milestoneFirst).toBe(true);
    expect(space("[data-xp-levelup]")).toBe("open");
    expect(space("[data-xp-bonuses]")).toBe("open");
  });

  it("shows a subscription tier's boost under its name, in its colours", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            breakdown: {
              ...eligible().breakdown,
              gamePermille: 1000,
              subscriberPermille: 2000,
              total: 340,
            },
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    const line = panel()!.querySelector("[data-xp-multiplier='subscriber']")!;
    expect(line.getAttribute("data-xp-tier")).toBe("sovereign");
    expect(line.textContent).toContain(
      'progression.bonus_line:{"percent":100,"source":"progression.multiplier_sovereign"}',
    );
    // Sovereign's gold, on the line and across the panel's boosted cards.
    expect(line.getAttribute("style")).toContain("--accent-a: #ffc713");
    expect(panel()!.getAttribute("style")).toContain("--accent-b: #ffde90");
  });

  it("shows an unknown subscriber boost as a plain subscriber bonus", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            breakdown: {
              ...eligible().breakdown,
              gamePermille: 1000,
              subscriberPermille: 1200,
              total: 204,
            },
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    const line = panel()!.querySelector("[data-xp-multiplier='subscriber']")!;
    expect(line.getAttribute("data-xp-tier")).toBeNull();
    expect(line.textContent).toContain("progression.multiplier_subscriber");
    expect(panel()!.getAttribute("style")).toBeNull();
  });

  it("rolls the closing caption in once, not again when the reveal ends", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 4, xpInLevel: 300, xpForNext: 400 },
            after: {
              ...eligible().after,
              level: 5,
              xpInLevel: 10,
              xpForNext: 430,
            },
            levelsReached: [{ prestige: 0, level: 5 }],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    // Wait for the closing "Level 5!" caption, while still revealing.
    let closing: Element | null = null;
    for (let i = 0; i < 400 && closing === null; i++) {
      await settle(50);
      const el = panel()!.querySelector("[data-xp-caption-step]");
      if (
        panel()!.getAttribute("data-xp-revealing") === "true" &&
        el?.textContent?.includes("progression.level_reached")
      ) {
        closing = el;
      }
    }
    expect(closing).not.toBeNull();
    await settle(20_000);
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    // The same element: no second roll-in.
    expect(panel()!.querySelector("[data-xp-caption-step]")).toBe(closing);
  });

  it("pauses on every level reached during the reveal", async () => {
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 4, xpInLevel: 300, xpForNext: 400 },
            after: {
              ...eligible().after,
              level: 7,
              xpInLevel: 50,
              xpForNext: 600,
            },
            levelsReached: [
              { prestige: 0, level: 5 },
              { prestige: 0, level: 6 },
              { prestige: 0, level: 7 },
            ],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    const moments: string[] = [];
    for (let i = 0; i < 400; i++) {
      await settle(50);
      const moment = panel()
        ?.querySelector("[data-xp-caption-levelup]")
        ?.getAttribute("data-xp-caption-levelup");
      if (moment && moment !== moments[moments.length - 1]) {
        moments.push(moment);
        // The bar is full and the badge shows the new level.
        expect(
          panel()!
            .querySelector("[data-xp-bar]")!
            .getAttribute("aria-valuenow"),
        ).toBe("100");
        // The level being reached is the right-hand badge, with the one
        // before it still on the left.
        const badgeLevel = (sel: string) =>
          (
            panel()!.querySelector(`${sel} level-badge`) as HTMLElement & {
              level: number;
            }
          ).level;
        expect(badgeLevel("[data-xp-next-badge]")).toBe(Number(moment));
        expect(badgeLevel("[data-xp-current-badge]")).toBe(Number(moment) - 1);
      }
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
    }
    expect(moments).toEqual(["5", "6", "7"]);
  });

  it("celebrates a level-up from a level the player started full", async () => {
    // A curve change left the player a full bar on level 9.
    stubXpEndpoint([
      () =>
        json(
          eligible({
            before: { prestige: 0, level: 9, xpInLevel: 330, xpForNext: 330 },
            after: {
              ...eligible().after,
              level: 10,
              xpInLevel: 182,
              xpForNext: 370,
            },
            levelsReached: [{ prestige: 0, level: 10 }],
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    const badgeLevel = (sel: string) =>
      (
        panel()!.querySelector(`${sel} level-badge`) as HTMLElement & {
          level: number;
        }
      ).level;
    const milestoneSpace = () =>
      panel()!
        .querySelector("[data-xp-levelup]")!
        .closest("[data-xp-collapsible]")!
        .getAttribute("data-xp-collapsible");
    // It starts on level 9, the milestone still to come.
    expect(badgeLevel("[data-xp-current-badge]")).toBe(9);
    expect(badgeLevel("[data-xp-next-badge]")).toBe(10);
    expect(milestoneSpace()).toBe("closed");
    const moments: string[] = [];
    for (let i = 0; i < 400; i++) {
      await settle(50);
      const moment = panel()
        ?.querySelector("[data-xp-caption-levelup]")
        ?.getAttribute("data-xp-caption-levelup");
      if (moment && moment !== moments[moments.length - 1]) {
        moments.push(moment);
      }
      if (panel()?.getAttribute("data-xp-revealing") !== "true") break;
    }
    expect(moments).toEqual(["10"]);
    expect(milestoneSpace()).toBe("open");
    expect(badgeLevel("[data-xp-current-badge]")).toBe(10);
  });

  it("shows XP from a source it doesn't know as its own card, not spread over the others", async () => {
    // Scored when the first-game bonus was stored as `firstWinOfDay`.
    stubXpEndpoint([
      () =>
        json(
          eligible({
            breakdown: {
              played: 50,
              time: 100,
              firstWinOfDay: 200,
              subtotal: 350,
              gamePermille: 1000,
              subscriberPermille: 1000,
              total: 350,
            },
          }),
        ),
    ]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    const cards = [...panel()!.querySelectorAll("[data-xp-card]")].map((c) => [
      c.querySelector("[data-xp-line]")!.getAttribute("data-xp-line"),
      c.querySelector("[data-xp-card-value]")!.textContent!.trim(),
    ]);
    expect(cards).toEqual([
      ["played", 'progression.xp_total:{"xp":"50"}'],
      ["time", 'progression.xp_total:{"xp":"100"}'],
      ["other", 'progression.xp_total:{"xp":"200"}'],
    ]);
  });
  it("skips to the end when the panel is tapped", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    expect(panel()!.getAttribute("data-xp-revealing")).toBe("true");
    panel()!.click();
    await settle();
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.querySelector("[data-xp-total]")!.textContent).toContain(
      '"xp":"212"',
    );
  });

  it("shows a result that lands after the modal is dismissed in its final state", async () => {
    stubXpEndpoint([notFound, () => json(eligible())]);
    await mount(makeGame({ ended: true }));
    expect(xpState()).toBe("calculating");
    // Keep playing / spectate while it is still calculating.
    modal.querySelector<HTMLButtonElement>('[data-win-action="keep"]')!.click();
    await settle(3_000);
    expect(xpState()).toBe("result");
    // No reveal playing where nobody can see it: it is already over.
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.getAttribute("aria-busy")).toBe("false");
    expect(panel()!.querySelector("[data-xp-total]")!.textContent).toContain(
      '"xp":"212"',
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends a reveal in progress when the modal is dismissed", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    expect(panel()!.getAttribute("data-xp-revealing")).toBe("true");
    modal.querySelector<HTMLButtonElement>('[data-win-action="keep"]')!.click();
    await settle();
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.querySelector("[data-xp-total]")!.textContent).toContain(
      '"xp":"212"',
    );
  });

  it("does not come back half-revealed when the panel is removed and re-added", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    const element = modal.querySelector<GameXpPanel>("game-xp-panel")!;
    expect(panel()!.getAttribute("aria-busy")).toBe("true");
    const parent = element.parentElement!;
    element.remove();
    parent.prepend(element);
    await element.updateComplete;
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.getAttribute("aria-busy")).toBe("false");
  });

  it("polls again when the modal is detached mid-poll and re-attached", async () => {
    stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    expect(xpState()).toBe("calculating");
    const view = () =>
      (modal as unknown as { xpView: { kind: string } }).xpView.kind;

    // Detaching aborts the poll; that is not a verdict on the XP.
    modal.remove();
    await settle(3_000);
    expect(view()).toBe("calculating");

    // Shown again, the next end-of-game update polls afresh.
    const fetchMock = stubXpEndpoint([() => json(eligible())]);
    document.body.appendChild(modal);
    await (
      modal as unknown as { updateXp(gameOver: boolean): Promise<void> }
    ).updateXp(true);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(xpState()).toBe("result");
  });

  it("skips from the keyboard with a real button", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    const skip = panel()!.querySelector<HTMLButtonElement>("[data-xp-skip]");
    expect(skip).not.toBeNull();
    expect(skip!.tagName).toBe("BUTTON");
    expect(skip!.textContent!.trim()).toBe("progression.skip_reveal");
    // A button's Enter / Space activation is a click.
    skip!.click();
    await settle();
    expect(panel()!.getAttribute("data-xp-revealing")).toBeNull();
    expect(panel()!.querySelector("[data-xp-skip]")).toBeNull();
  });

  it("names the progress bar for assistive tech", async () => {
    stubXpEndpoint([() => json(eligible())]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    const bar = panel()!.querySelector("[data-xp-bar]")!;
    expect(bar.getAttribute("aria-label")).toBe("progression.xp_bar_label");
    expect(bar.getAttribute("aria-valuetext")).toBe(
      'progression.xp_progress:{"current":"512","next":"400"}',
    );
  });

  it("asks a signed-out player to sign in, without polling", async () => {
    getUserMe.mockResolvedValue(anonymous);
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("signed_out");
    expect(panel()!.textContent).toContain("progression.sign_in_to_earn");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks a player with no session at all to sign in", async () => {
    isLoggedIn.mockResolvedValue(false);
    getUserMe.mockResolvedValue(false);
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    expect(xpState()).toBe("signed_out");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing, rather than 'sign in', when /users/@me fails for a session", async () => {
    // A 5xx or a timeout: getUserMe answers false, as for a signed-out
    // player, but there is a session, so this says nothing about the account.
    getUserMe.mockResolvedValue(false);
    fetchProgressionConfig.mockClear();
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    expect(xpState()).toBe("hidden");
    expect(fetchProgressionConfig).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing at all when progression is off", async () => {
    fetchProgressionConfig.mockResolvedValue(false);
    isLoggedIn.mockResolvedValue(false);
    getUserMe.mockResolvedValue(false);
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing to a signed-in player when /users/@me has no progress", async () => {
    getUserMe.mockResolvedValue({ ...signedIn, player: { publicId: "me" } });
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true }));
    await finishReveal();
    expect(xpState()).toBe("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits for the game to end when the player dies mid-game", async () => {
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: false, alive: false }));
    expect(xpState()).toBe("awaiting_end");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays hidden in a replay", async () => {
    const fetchMock = stubXpEndpoint([notFound]);
    await mount(makeGame({ ended: true, replay: true }));
    expect(xpState()).toBe("hidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
