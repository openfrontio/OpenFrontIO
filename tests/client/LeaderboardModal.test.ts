import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lit-labs/virtualizer/virtualize.js", async () => {
  const { html } = await import("lit");
  return {
    virtualize: vi.fn(() => html``),
  };
});

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "leaderboard_modal.win_score_tooltip":
        "Weighted wins based on clan participation and match difficulty",
      "leaderboard_modal.loss_score_tooltip":
        "Weighted losses based on clan participation and match difficulty",
      "leaderboard_modal.title": "Leaderboard",
      "leaderboard_modal.ranked_tab": "Ranked",
      "leaderboard_modal.clans_tab": "Clans",
      "leaderboard_modal.error": "Something went wrong",
      "leaderboard_modal.rank": "Rank",
      "leaderboard_modal.clan": "Clan",
      "leaderboard_modal.games": "Games",
      "leaderboard_modal.win_score": "Win Score",
      "leaderboard_modal.loss_score": "Loss Score",
      "leaderboard_modal.win_loss_ratio": "W/L",
      "leaderboard_modal.ratio": "Ratio",
      "leaderboard_modal.elo": "Elo",
      "leaderboard_modal.player": "Player",
      "leaderboard_modal.loading": "Loading",
      "leaderboard_modal.try_again": "Try Again",
      "leaderboard_modal.no_data_yet": "No data yet",
      "leaderboard_modal.no_stats": "No stats",
      "leaderboard_modal.your_ranking": "Your ranking",
      "common.close": "Close",
    };
    return translations[key] || key;
  }),
}));

vi.mock("../../src/client/Api", () => {
  const getApiBase = () => "http://localhost:3000";
  return {
    getApiBase: vi.fn(getApiBase),
    getUserMe: vi.fn(async () => false),
    fetchClanLeaderboard: vi.fn(async () => {
      const res = await fetch(`${getApiBase()}/public/clans/leaderboard`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;
      return res.json();
    }),
    fetchPlayerLeaderboard: vi.fn(async (page: number) => {
      const url = new URL(`${getApiBase()}/leaderboard/ranked`);
      url.searchParams.set("page", String(page));
      const res = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        if (res.status === 400) {
          const errorJson = await res.json().catch(() => null);
          if (errorJson?.message?.includes("Page must be between")) {
            return "reached_limit";
          }
        }
        return false;
      }
      return res.json();
    }),
  };
});

const jsonRes = (data: any, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => data,
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any) => {
      const url =
        typeof input === "string" ? input : (input?.url ?? String(input));

      if (url.includes("/public/clans/leaderboard")) {
        return jsonRes({ start: "...", end: "...", clans: [] });
      }
      if (url.includes("/leaderboard/ranked")) {
        return jsonRes({ "1v1": [] });
      }
      return jsonRes({}, false, 404);
    }),
  );
});

import { LeaderboardModal } from "../../src/client/LeaderboardModal";

describe("LeaderboardModal", () => {
  let modal: LeaderboardModal;
  const awaitChildUpdate = async (selector: string) => {
    const el = modal.querySelector(selector) as {
      updateComplete?: Promise<unknown>;
    } | null;
    if (el?.updateComplete) {
      await el.updateComplete;
    }
  };
  const getClanTable = () =>
    modal.querySelector("leaderboard-clan-table") as {
      loadClanLeaderboard: () => Promise<void>;
      updateComplete: Promise<unknown>;
    } | null;
  const getPlayerList = () =>
    modal.querySelector("leaderboard-player-list") as {
      loadPlayerLeaderboard: (reset?: boolean) => Promise<void>;
      updateComplete: Promise<unknown>;
      playerData: Array<Record<string, unknown>>;
      currentUserEntry?: { playerId: string } | null;
    } | null;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    if (!customElements.get("leaderboard-modal")) {
      customElements.define("leaderboard-modal", LeaderboardModal);
    }
    modal = document.createElement("leaderboard-modal") as LeaderboardModal;
    document.body.appendChild(modal);
    await modal.updateComplete;
  });

  afterEach(() => {
    document.body.removeChild(modal);
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe("Tooltip Implementation - Issue #2508", () => {
    it("should render Win Score and Loss Score columns with title attributes", async () => {
      // Mock fetch to return sample clan leaderboard data
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-07T23:59:59Z",
          clans: [
            {
              clanTag: "[TEST]",
              games: 10,
              wins: 8,
              losses: 2,
              playerSessions: 25,
              weightedWins: 8.5,
              weightedLosses: 1.5,
              weightedWLRatio: 5.67,
            },
            {
              clanTag: "[DEMO]",
              games: 8,
              wins: 6,
              losses: 2,
              playerSessions: 20,
              weightedWins: 6.0,
              weightedLosses: 2.0,
              weightedWLRatio: 3.0,
            },
          ],
        }),
      });

      (modal as unknown as { activeTab: string }).activeTab = "clans";
      const clanTable = getClanTable();
      expect(clanTable).toBeTruthy();
      await clanTable!.loadClanLeaderboard();
      await clanTable!.updateComplete;

      const allHeaders = modal.querySelectorAll("th");
      let winScoreHeader: Element | null = null;
      let lossScoreHeader: Element | null = null;

      // Find the headers by their text content and title attribute
      allHeaders.forEach((th) => {
        const title = th.getAttribute("title");
        if (title?.includes("Weighted wins")) {
          winScoreHeader = th;
        } else if (title?.includes("Weighted losses")) {
          lossScoreHeader = th;
        }
      });

      // Assert that headers exist with correct tooltip text
      expect(winScoreHeader).toBeTruthy();
      expect(lossScoreHeader).toBeTruthy();

      expect(winScoreHeader!.getAttribute("title")).toBe(
        "Weighted wins based on clan participation and match difficulty",
      );
      expect(lossScoreHeader!.getAttribute("title")).toBe(
        "Weighted losses based on clan participation and match difficulty",
      );
    });

    it("should use translateText for tooltip internationalization", async () => {
      // Verify translation keys are correct
      const { translateText } = await import("../../src/client/Utils");

      expect(translateText("leaderboard_modal.win_score_tooltip")).toBe(
        "Weighted wins based on clan participation and match difficulty",
      );
      expect(translateText("leaderboard_modal.loss_score_tooltip")).toBe(
        "Weighted losses based on clan participation and match difficulty",
      );
    });
  });

  describe("Player Data Mapping", () => {
    it("should map ranked leaderboard data and set current user entry", async () => {
      const { getUserMe } = await import("../../src/client/Api");
      (getUserMe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        player: { publicId: "player-2" },
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          "1v1": [
            {
              rank: 1,
              elo: 1200,
              peakElo: 1300,
              wins: 6,
              losses: 4,
              total: 10,
              public_id: "player-1",
              username: "Alpha",
              clanTag: "[AAA]",
            },
            {
              rank: 2,
              elo: 1100,
              peakElo: 1250,
              wins: 4,
              losses: 6,
              total: 10,
              public_id: "player-2",
              username: "Bravo",
              clanTag: null,
            },
          ],
        }),
      });

      const playerList = getPlayerList();
      expect(playerList).toBeTruthy();
      await playerList!.loadPlayerLeaderboard(true);
      await playerList!.updateComplete;

      const playerData = playerList!.playerData;

      expect(playerData).toHaveLength(2);
      expect(playerData[0]).toEqual(
        expect.objectContaining({
          playerId: "player-1",
          username: "Alpha",
          clanTag: "[AAA]",
          elo: 1200,
          games: 10,
          wins: 6,
          losses: 4,
          winRate: 0.6,
        }),
      );
      expect(playerData[1]).toEqual(
        expect.objectContaining({
          playerId: "player-2",
          username: "Bravo",
          clanTag: undefined,
          winRate: 0.4,
        }),
      );
      expect(playerList!.currentUserEntry?.playerId).toBe("player-2");
    });
  });

  describe("Modal Functionality", () => {
    it("should initialize with default state", () => {
      expect(modal).toBeTruthy();
      expect((modal as unknown as { activeTab: string }).activeTab).toBe(
        "players",
      );
    });

    it("should be a custom element", () => {
      expect(modal).toBeInstanceOf(LeaderboardModal);
      expect(modal.tagName.toLowerCase()).toBe("leaderboard-modal");
    });

    it("should close on Escape when open", () => {
      const mockModalEl = { open: vi.fn(), close: vi.fn() };
      Object.defineProperty(modal, "modalEl", {
        get: () => mockModalEl,
        configurable: true,
      });
      (modal as unknown as { onOpen: () => void }).onOpen = vi.fn();

      modal.open();
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        true,
      );

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect((modal as unknown as { isModalOpen: boolean }).isModalOpen).toBe(
        false,
      );
      expect(mockModalEl.close).toHaveBeenCalled();
    });
  });

  describe("Modal Interaction", () => {
    it("should switch to clans tab and request clan leaderboard data", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-07T23:59:59Z",
          clans: [],
        }),
      });

      const tab = modal.querySelector("#clan-leaderboard-tab");
      expect(tab).toBeTruthy();

      tab!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect((modal as unknown as { activeTab: string }).activeTab).toBe(
        "clans",
      );
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:3000/public/clans/leaderboard",
        { headers: { Accept: "application/json" } },
      );
      await Promise.resolve();
      await modal.updateComplete;
      await awaitChildUpdate("leaderboard-clan-table");
    });

    it("should render a no data state for empty clan leaderboard", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          start: "2025-01-01T00:00:00Z",
          end: "2025-01-07T23:59:59Z",
          clans: [],
        }),
      });

      (modal as unknown as { activeTab: string }).activeTab = "clans";
      const clanTable = getClanTable();
      expect(clanTable).toBeTruthy();
      await clanTable!.loadClanLeaderboard();
      await clanTable!.updateComplete;

      expect(modal.textContent).toContain("No data yet");
      expect(modal.textContent).toContain("No stats");
    });

    it("should render an error state when clan leaderboard fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      (modal as unknown as { activeTab: string }).activeTab = "clans";
      const clanTable = getClanTable();
      expect(clanTable).toBeTruthy();
      await clanTable!.loadClanLeaderboard();
      await clanTable!.updateComplete;

      expect(modal.textContent).toContain("Something went wrong");
      expect(modal.textContent).toContain("Try Again");
    });
  });
});
