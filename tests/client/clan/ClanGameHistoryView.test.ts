import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushAsync } from "./ClanModalTestUtils";

// ─── Mocks (defined before imports so vi.mock hoisting applies) ─────────────

vi.mock("../../../src/client/Utils", () => ({
  // Echo the key so we can assert on translation slugs.
  translateText: vi.fn((key: string) => key),
  showToast: vi.fn(),
  // Cheap stub so we don't pull in the real i18n module.
  renderDuration: vi.fn((s: number) => `${s}s`),
  getMapName: vi.fn((m: string | undefined) => m ?? null),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
  userAuth: vi.fn(),
}));

vi.mock("../../../src/client/ClanApi", () => ({
  fetchClanGames: vi.fn(async () => ({ results: [], nextCursor: null })),
}));

vi.mock("../../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn(() => ({ webpPath: "/maps/test.webp" })),
  },
}));

vi.mock("../../../src/client/ClientEnv", () => ({
  ClientEnv: {
    workerPath: vi.fn(() => "w0"),
  },
}));

// ClanShared re-exports from BaseModal; stub it directly so we don't pull
// BaseModal's dependency graph into this unit test.
vi.mock("../../../src/client/components/clan/ClanShared", async () => {
  const { html } = await import("lit");
  return {
    renderLoadingSpinner: vi.fn(() => html`<div data-testid="spinner"></div>`),
    showToast: vi.fn(),
  };
});

// CopyButton is a custom element; stub it so its dependency graph (Auth,
// API, etc.) doesn't get pulled in transitively.
vi.mock("../../../src/client/components/CopyButton", () => ({}));

// jsdom doesn't ship IntersectionObserver — provide the minimum surface
// the component touches (observe / disconnect). Tests below trigger the
// callback manually when needed.
class FakeIntersectionObserver {
  callback: IntersectionObserverCallback;
  static last: FakeIntersectionObserver | null = null;
  observed: Element[] = [];
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeIntersectionObserver.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
}
vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

// ─── Imports under test ──────────────────────────────────────────────────────

import type { ClanGame, ClanGamesResponse } from "../../../src/client/ClanApi";
import { fetchClanGames } from "../../../src/client/ClanApi";
import {
  ClanGameHistoryView,
  type ClanGameHistoryCache,
} from "../../../src/client/components/clan/ClanGameHistoryView";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeGame(overrides: Partial<ClanGame> = {}): ClanGame {
  return {
    gameId: "g1",
    start: "2024-06-01T12:00:00.000Z",
    durationSeconds: 600,
    map: "World",
    mode: "Team",
    playerTeams: "Duos",
    rankedType: undefined,
    result: "victory",
    totalPlayers: 8,
    clanPlayers: [{ publicId: "p1", username: "alice", won: true }],
    ...overrides,
  };
}

async function mountView(props: Partial<ClanGameHistoryView> = {}) {
  if (!customElements.get("clan-game-history-view")) {
    customElements.define("clan-game-history-view", ClanGameHistoryView);
  }
  const el = document.createElement(
    "clan-game-history-view",
  ) as ClanGameHistoryView;
  // Apply props before mount so connectedCallback sees them.
  Object.assign(el, { clanTag: "TST", ...props });
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const mockFetch = (impl: () => Promise<unknown>) => {
  (fetchClanGames as ReturnType<typeof vi.fn>).mockImplementationOnce(impl);
};

const okPage = (
  games: ClanGame[],
  nextCursor: string | null = null,
): ClanGamesResponse => ({ results: games, nextCursor });

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("ClanGameHistoryView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (fetchClanGames as ReturnType<typeof vi.fn>).mockResolvedValue(okPage([]));
  });

  afterEach(() => {
    document.querySelectorAll("clan-game-history-view").forEach((el) => {
      el.remove();
    });
  });

  describe("initial load + caching", () => {
    it("fetches games on mount when no cache is provided", async () => {
      mockFetch(() => Promise.resolve(okPage([makeGame()])));
      const el = await mountView();
      await flushAsync(el);

      expect(fetchClanGames).toHaveBeenCalledWith("TST", {
        filter: undefined,
        cursor: undefined,
      });
    });

    it("skips the fetch when a matching cache is supplied", async () => {
      const cache: ClanGameHistoryCache = {
        tag: "TST",
        filter: "ffa",
        games: [makeGame({ gameId: "cached" })],
        nextCursor: "cursor-1",
      };
      const el = await mountView({ cachedState: cache });
      await flushAsync(el);

      expect(fetchClanGames).not.toHaveBeenCalled();
      // Sentinel must be present so the observer can pick up where the
      // previous session left off — non-null cursor means more pages.
      expect(el.querySelector("[data-scroll-sentinel]")).not.toBeNull();
    });

    it("ignores the cache when the tag does not match and fetches instead", async () => {
      mockFetch(() => Promise.resolve(okPage([makeGame()])));
      const cache: ClanGameHistoryCache = {
        tag: "OTHER",
        filter: "all",
        games: [makeGame()],
        nextCursor: null,
      };
      const el = await mountView({ cachedState: cache });
      await flushAsync(el);

      expect(fetchClanGames).toHaveBeenCalledOnce();
    });
  });

  describe("filter switching", () => {
    it("hard-resets games and refetches with the chosen filter", async () => {
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "first" })], "cursor-1")),
      );
      const el = await mountView();
      await flushAsync(el);

      mockFetch(() => Promise.resolve(okPage([makeGame({ gameId: "ffa" })])));
      // Click the FFA filter tab. translateText echoes the key.
      const ffaTab = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("clan_modal.history_type_ffa"),
      )!;
      ffaTab.click();
      await flushAsync(el);

      expect(fetchClanGames).toHaveBeenLastCalledWith("TST", {
        filter: "ffa",
        cursor: undefined,
      });
    });
  });

  describe("cursor pagination (append)", () => {
    it("sends the saved cursor on the next page request and concatenates results", async () => {
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "p1" })], "next-token")),
      );
      const el = await mountView();
      await flushAsync(el);

      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "p2" })], null)),
      );
      // Drive the observer callback manually — sentinel becomes intersecting.
      const observer = FakeIntersectionObserver.last;
      expect(observer).not.toBeNull();
      observer!.callback(
        [
          {
            isIntersecting: true,
            target: observer!.observed[0],
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
      await flushAsync(el);

      expect(fetchClanGames).toHaveBeenLastCalledWith("TST", {
        filter: undefined,
        cursor: "next-token",
      });
    });

    it("preserves prior games and surfaces a retry footer when append fails", async () => {
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "p1" })], "next-token")),
      );
      const el = await mountView();
      await flushAsync(el);

      mockFetch(() => Promise.resolve({ error: "failed" }));
      const observer = FakeIntersectionObserver.last!;
      observer.callback(
        [
          {
            isIntersecting: true,
            target: observer.observed[0],
          } as unknown as IntersectionObserverEntry,
        ],
        observer as unknown as IntersectionObserver,
      );
      await flushAsync(el);

      // Retry footer is rendered (the key is `history_load_more_failed`)
      expect(el.textContent).toContain("clan_modal.history_load_more_failed");
      // The first-page game card is still in the DOM — checking for a
      // per-game render artefact rather than gameId since CopyButton is
      // stubbed out and does not surface its `displayText`.
      expect(el.textContent).toContain("clan_modal.history_game_type");
      // And the empty state must NOT have replaced the list.
      expect(el.textContent).not.toContain("clan_modal.history_empty");
    });
  });

  describe("error / forbidden / empty states", () => {
    it("renders the members-only message on 403", async () => {
      mockFetch(() => Promise.resolve({ error: "forbidden" }));
      const el = await mountView();
      await flushAsync(el);

      expect(el.textContent).toContain("clan_modal.history_members_only");
    });

    it("renders the unavailable state with a try-again button on non-403 errors", async () => {
      mockFetch(() => Promise.resolve({ error: "failed" }));
      const el = await mountView();
      await flushAsync(el);

      expect(el.textContent).toContain("clan_modal.history_unavailable");
      expect(el.textContent).toContain("leaderboard_modal.try_again");
    });

    it("renders the empty state when results is []", async () => {
      mockFetch(() => Promise.resolve(okPage([])));
      const el = await mountView();
      await flushAsync(el);

      expect(el.textContent).toContain("clan_modal.history_empty");
    });
  });

  describe("renderResultBadge", () => {
    // Drive a single render and read the badge text out of the DOM so
    // we test the actual code path (including isFfa).
    async function badgeTextFor(game: ClanGame): Promise<string> {
      mockFetch(() => Promise.resolve(okPage([game])));
      const el = await mountView();
      await flushAsync(el);
      return el.textContent ?? "";
    }

    it("shows partial-win badge for FFA when only some clan members won", async () => {
      const text = await badgeTextFor(
        makeGame({
          mode: "Free For All",
          playerTeams: null,
          result: "victory",
          clanPlayers: [
            { publicId: "a", username: "a", won: true },
            { publicId: "b", username: "b", won: false },
            { publicId: "c", username: "c", won: false },
          ],
        }),
      );
      expect(text).toContain("clan_modal.history_result_partial");
    });

    it("shows victory for FFA when all clan members won", async () => {
      const text = await badgeTextFor(
        makeGame({
          mode: "Free For All",
          playerTeams: null,
          result: "victory",
          clanPlayers: [
            { publicId: "a", username: "a", won: true },
            { publicId: "b", username: "b", won: true },
          ],
        }),
      );
      expect(text).toContain("clan_modal.history_result_victory");
      expect(text).not.toContain("clan_modal.history_result_partial");
    });

    it("shows defeat for FFA when no clan members won", async () => {
      const text = await badgeTextFor(
        makeGame({
          mode: "Free For All",
          playerTeams: null,
          result: "defeat",
          clanPlayers: [
            { publicId: "a", username: "a", won: false },
            { publicId: "b", username: "b", won: false },
          ],
        }),
      );
      expect(text).toContain("clan_modal.history_result_defeat");
    });

    it("does not partial-win team games (clan plays as a unit)", async () => {
      const text = await badgeTextFor(
        makeGame({
          mode: "Team",
          playerTeams: "Duos",
          result: "victory",
          clanPlayers: [
            { publicId: "a", username: "a", won: true },
            { publicId: "b", username: "b", won: false },
          ],
        }),
      );
      // Team games surface plain victory/defeat — never partial.
      expect(text).toContain("clan_modal.history_result_victory");
      expect(text).not.toContain("clan_modal.history_result_partial");
    });

    it("omits the badge when result is absent", async () => {
      const text = await badgeTextFor(
        makeGame({
          result: undefined,
        }),
      );
      expect(text).not.toContain("clan_modal.history_result_victory");
      expect(text).not.toContain("clan_modal.history_result_defeat");
      expect(text).not.toContain("clan_modal.history_result_partial");
    });
  });

  describe("formatGameType", () => {
    async function typeLabelFor(game: ClanGame): Promise<string> {
      mockFetch(() => Promise.resolve(okPage([game])));
      const el = await mountView();
      await flushAsync(el);
      return el.textContent ?? "";
    }

    it("labels ranked games with the rankedType variable", async () => {
      const text = await typeLabelFor(
        makeGame({ rankedType: "1v1", mode: undefined, playerTeams: null }),
      );
      expect(text).toContain("clan_modal.history_type_ranked");
    });

    it("labels FFA via the GameMode.FFA enum literal", async () => {
      const text = await typeLabelFor(
        makeGame({
          mode: "Free For All",
          playerTeams: null,
          rankedType: undefined,
        }),
      );
      expect(text).toContain("clan_modal.history_type_ffa");
    });

    it("labels FFA when mode is absent and playerTeams is null (no team grouping)", async () => {
      const text = await typeLabelFor(
        makeGame({
          mode: undefined,
          playerTeams: null,
          rankedType: undefined,
        }),
      );
      expect(text).toContain("clan_modal.history_type_ffa");
    });

    it("labels Humans Vs Nations", async () => {
      const text = await typeLabelFor(
        makeGame({
          mode: "Team",
          playerTeams: "Humans Vs Nations",
          rankedType: undefined,
        }),
      );
      expect(text).toContain("clan_modal.history_type_hvn");
    });

    it("labels Duos / Trios / Quads via the lowercased key", async () => {
      for (const team of ["Duos", "Trios", "Quads"] as const) {
        const text = await typeLabelFor(
          makeGame({
            mode: "Team",
            playerTeams: team,
            rankedType: undefined,
          }),
        );
        expect(
          text,
          `team "${team}" should map to its lowercase label`,
        ).toContain(`clan_modal.history_type_${team.toLowerCase()}`);
      }
    });

    it("labels numeric playerTeams as N teams", async () => {
      const text = await typeLabelFor(
        makeGame({
          mode: "Team",
          playerTeams: "7",
          rankedType: undefined,
        }),
      );
      expect(text).toContain("clan_modal.history_type_n_teams");
    });

    it("falls back to generic Team when playerTeams is an unknown string", async () => {
      const text = await typeLabelFor(
        makeGame({
          mode: "Team",
          playerTeams: "WeirdMode",
          rankedType: undefined,
        }),
      );
      expect(text).toContain("clan_modal.history_type_team");
    });
  });

  describe("renderPlayersField", () => {
    async function bodyTextFor(game: ClanGame): Promise<string> {
      mockFetch(() => Promise.resolve(okPage([game])));
      const el = await mountView();
      await flushAsync(el);
      return el.textContent ?? "";
    }

    it("shows total only for ranked single-clan-slot games", async () => {
      const text = await bodyTextFor(
        makeGame({ rankedType: "1v1", totalPlayers: 2 }),
      );
      expect(text).toContain("clan_modal.history_players");
      expect(text).not.toContain("clan_modal.history_clan_players_value");
    });

    it("shows clan/total breakdown for non-ranked games", async () => {
      const text = await bodyTextFor(
        makeGame({ rankedType: undefined, totalPlayers: 50 }),
      );
      expect(text).toContain("clan_modal.history_clan_players_value");
    });

    it('renders "—" when totalPlayers is null and game is ranked', async () => {
      const text = await bodyTextFor(
        makeGame({ rankedType: "1v1", totalPlayers: null }),
      );
      expect(text).toContain("—");
    });
  });

  describe("day grouping headers", () => {
    it("groups consecutive same-day games under one header (Today)", async () => {
      const now = new Date();
      const today = (h: number) =>
        new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
          h,
        ).toISOString();
      mockFetch(() =>
        Promise.resolve(
          okPage([
            makeGame({ gameId: "g1", start: today(10) }),
            makeGame({ gameId: "g2", start: today(11) }),
          ]),
        ),
      );
      const el = await mountView();
      await flushAsync(el);

      const headers = el.querySelectorAll("h3");
      expect(headers).toHaveLength(1);
      expect(headers[0]?.textContent).toContain("clan_modal.history_today");
    });

    it('labels yesterday under the "yesterday" key', async () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ start: yesterday.toISOString() })])),
      );
      const el = await mountView();
      await flushAsync(el);

      expect(el.textContent).toContain("clan_modal.history_yesterday");
    });
  });

  describe("watchReplay", () => {
    it("pushes a /game/:id URL and emits close-clan-modal + join-changed", async () => {
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "abc/xyz" })])),
      );
      const el = await mountView();
      await flushAsync(el);

      const pushSpy = vi.spyOn(history, "pushState");
      const winEvents: string[] = [];
      const winHandler = () => winEvents.push("join-changed");
      window.addEventListener("join-changed", winHandler);
      const elEvents: string[] = [];
      el.addEventListener("close-clan-modal", () =>
        elEvents.push("close-clan-modal"),
      );

      const watchBtn = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("clan_modal.history_watch_replay"),
      )!;
      watchBtn.click();
      await flushAsync(el);

      expect(pushSpy).toHaveBeenCalledOnce();
      const url = pushSpy.mock.calls[0][2] as string;
      // gameId is URL-encoded into the path
      expect(url).toContain(encodeURIComponent("abc/xyz"));
      expect(winEvents).toContain("join-changed");
      expect(elEvents).toContain("close-clan-modal");

      window.removeEventListener("join-changed", winHandler);
      pushSpy.mockRestore();
    });
  });

  describe("history-updated event", () => {
    it("emits with the freshly-loaded games and cursor so the parent can cache", async () => {
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "g1" })], "next-1")),
      );
      const el = await mountView();
      const events: ClanGameHistoryCache[] = [];
      el.addEventListener("history-updated", (e) =>
        events.push((e as CustomEvent<ClanGameHistoryCache>).detail),
      );
      // The first load was already issued in connectedCallback — wait for it.
      await flushAsync(el);

      // Re-trigger by switching filter to capture the event.
      mockFetch(() =>
        Promise.resolve(okPage([makeGame({ gameId: "g2" })], null)),
      );
      const ffaTab = Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("clan_modal.history_type_ffa"),
      )!;
      ffaTab.click();
      await flushAsync(el);

      expect(events.length).toBeGreaterThan(0);
      const last = events[events.length - 1];
      expect(last.tag).toBe("TST");
      expect(last.filter).toBe("ffa");
      expect(last.games).toHaveLength(1);
      expect(last.nextCursor).toBeNull();
    });
  });
});
