import { RankedType } from "@openfront/engine-api/game/GameTypes";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));
vi.mock("../../src/client/LazyModals", () => ({
  loadModal: vi.fn(async () => {}),
}));
vi.mock("../../src/client/ProgressionAccount", () => ({
  isRealAccount: vi.fn(async () => true),
}));
vi.mock("../../src/client/Api", () => ({
  fetchPlayerLeaderboard: vi.fn(),
  fetchFfaRankLeaderboard: vi.fn(),
  fetchFfaAllRanksLeaderboard: vi.fn(),
  fetchFfaRankPosition: vi.fn(),
  getUserMe: vi.fn(async () => false),
}));

import {
  fetchFfaRankLeaderboard,
  fetchFfaAllRanksLeaderboard,
  fetchFfaRankPosition,
  fetchPlayerLeaderboard,
  getUserMe,
} from "../../src/client/Api";
import "../../src/client/components/leaderboard/LeaderboardPlayerList";
import type { LeaderboardPlayerList } from "../../src/client/components/leaderboard/LeaderboardPlayerList";

const row = (rank: number, id: string, tier?: string) => ({
  rank,
  elo: 2000,
  peakElo: 2000,
  wins: 1,
  losses: 1,
  total: 2,
  public_id: id,
  accountUsername: id,
  ...(tier === undefined ? {} : { uncertainty: 40, tier }),
});

const overall = (ffa: ReturnType<typeof row>[]) => ({
  "1v1": [row(1, "duelist")],
  "2v2": [],
  ffa,
});

const players = (...ids: string[]) => ({
  players: ids.map((id, i) => row(i + 1, id, "Gold II")),
});

const fullPage = (prefix: string) => ({
  players: Array.from({ length: 50 }, (_, i) =>
    row(i + 1, `${prefix}-${i}`, "Gold II"),
  ),
});

let list: LeaderboardPlayerList;

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await list.updateComplete;
  }
};

const tabs = () =>
  Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const selectedTab = () =>
  tabs().find((tab) => tab.getAttribute("aria-selected") === "true");
const tab = (rank: string) =>
  tabs().find((t) => t.dataset.rank === rank) as HTMLButtonElement;
const shownIds = () =>
  Array.from(list.querySelectorAll("tbody tr[data-player-id]")).map((tr) =>
    tr.getAttribute("data-player-id"),
  );

const open = async (rankedType: RankedType = RankedType.FreeForAll) => {
  list = document.createElement(
    "leaderboard-player-list",
  ) as LeaderboardPlayerList;
  list.rankedType = rankedType as LeaderboardPlayerList["rankedType"];
  document.body.appendChild(list);
  await list.loadPlayerLeaderboard(true);
  await settle();
};

beforeEach(() => {
  document.body.innerHTML = "";
  vi.mocked(getUserMe).mockReset().mockResolvedValue(false);
  vi.mocked(fetchFfaRankPosition).mockReset().mockResolvedValue(null);
  vi.mocked(fetchPlayerLeaderboard)
    .mockReset()
    .mockResolvedValue(overall([row(1, "top", "Diamond II")]) as never);
  vi.mocked(fetchFfaRankLeaderboard)
    .mockReset()
    .mockResolvedValue(players("a", "b") as never);
  vi.mocked(fetchFfaAllRanksLeaderboard)
    .mockReset()
    .mockResolvedValue(players("global-1", "global-2") as never);
});

describe("FFA rank tabs", () => {
  it("lists the 8 ranks from Iron up to Grandmaster", async () => {
    await open();
    expect(tabs().map((t) => t.dataset.rank)).toEqual([
      "iron",
      "bronze",
      "silver",
      "gold",
      "platinum",
      "diamond",
      "master",
      "grandmaster",
      "all",
    ]);
  });

  it("loads the globally ordered All Ranks Top 250 view", async () => {
    await open();
    const all = tab("all");
    all.click();
    await settle();
    expect(selectedTab()?.dataset.rank).toBe("all");
    expect(fetchFfaAllRanksLeaderboard).toHaveBeenCalledWith(1);
    expect(shownIds()).toEqual(["global-1", "global-2"]);
  });

  it("names every tab for screen readers", async () => {
    await open();
    expect(tab("gold").getAttribute("aria-label")).toBe("ffa_rating.tier.gold");
  });

  it("has no tabs while the board is the Elo ladder", async () => {
    vi.mocked(fetchPlayerLeaderboard).mockResolvedValue(
      overall([row(1, "elo-player")]) as never,
    );
    await open();
    expect(tabs()).toEqual([]);
    expect(fetchFfaRankLeaderboard).not.toHaveBeenCalled();
    expect(shownIds()).toEqual(["elo-player"]);
  });

  it("has no tabs on the other ladders", async () => {
    await open(RankedType.OneVOne);
    expect(tabs()).toEqual([]);
    expect(shownIds()).toEqual(["duelist"]);
  });

  it("opens on the signed-in player's own rank", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      player: {
        publicId: "me",
        leaderboard: { ffa: { tier: "Gold II", elo: 1800, games: 20 } },
      },
    } as never);
    await open();
    expect(selectedTab()?.dataset.rank).toBe("gold");
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("gold", 1);
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("shows global position on the signed-in player's tier row only", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      player: {
        publicId: "me",
        leaderboard: {
          ffa: { tier: "Gold II", elo: 1800, games: 20, globalPosition: 160 },
        },
      },
    } as never);
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue({
      players: [
        { ...row(12, "me", "Gold II"), globalPosition: 160 },
        row(13, "other", "Gold II"),
      ],
    } as never);
    await open();
    const own = list.querySelector('tr[data-player-id="me"]')!;
    const other = list.querySelector('tr[data-player-id="other"]')!;
    expect(
      own.querySelector("[data-global-ffa-position]")?.textContent,
    ).toContain("#160");
    expect(other.querySelector("[data-global-ffa-position]")).toBeNull();
  });

  it("opens on the highest rank with players for anyone else", async () => {
    await open();
    expect(selectedTab()?.dataset.rank).toBe("diamond");
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("diamond", 1);
  });

  // The board's own fill check can start the first load before ensureLoaded.
  it("still opens a rank when the first load isn't a reset", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      player: {
        publicId: "me",
        leaderboard: { ffa: { tier: "Gold II", elo: 1800, games: 20 } },
      },
    } as never);
    list = document.createElement(
      "leaderboard-player-list",
    ) as LeaderboardPlayerList;
    list.rankedType =
      RankedType.FreeForAll as LeaderboardPlayerList["rankedType"];
    document.body.appendChild(list);
    await list.loadPlayerLeaderboard();
    await settle();
    expect(selectedTab()?.dataset.rank).toBe("gold");
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("gold", 1);
  });

  it("shows the rank's rows, not the overall board's", async () => {
    await open();
    expect(shownIds()).toEqual(["a", "b"]);
  });

  it("loads a rank when its tab is clicked", async () => {
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      players("g1") as never,
    );
    tab("gold").click();
    await settle();
    expect(fetchFfaRankLeaderboard).toHaveBeenLastCalledWith("gold", 1);
    expect(selectedTab()?.dataset.rank).toBe("gold");
    expect(shownIds()).toEqual(["g1"]);
  });

  it("keeps a loaded rank when you come back to it", async () => {
    await open();
    tab("gold").click();
    await settle();
    const calls = vi.mocked(fetchFfaRankLeaderboard).mock.calls.length;
    tab("diamond").click();
    await settle();
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledTimes(calls);
    expect(selectedTab()?.dataset.rank).toBe("diamond");
  });

  it("says so when a rank has nobody in it, and keeps the tabs", async () => {
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue({
      players: [],
    } as never);
    tab("grandmaster").click();
    await settle();
    expect(tabs()).toHaveLength(9);
    expect(list.textContent).toContain("ffa_rating.rank_empty");
    expect(list.textContent).not.toContain("leaderboard_modal.no_data_yet");
  });

  it("pages within the selected rank", async () => {
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      fullPage("p1") as never,
    );
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockClear();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      players("last") as never,
    );
    await list.loadPlayerLeaderboard();
    await settle();
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("diamond", 2);
    expect(fetchPlayerLeaderboard).toHaveBeenCalledTimes(1);
    expect(shownIds()).toContain("last");
    expect(shownIds()).toHaveLength(51);
  });

  it("stops at a rank's last page", async () => {
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockClear();
    await list.loadPlayerLeaderboard();
    await settle();
    expect(fetchFfaRankLeaderboard).not.toHaveBeenCalled();
  });

  it("offers a retry when a rank fails to load", async () => {
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValueOnce(false as never);
    tab("gold").click();
    await settle();
    expect(list.textContent).toContain("leaderboard_modal.try_again");
    expect(list.textContent).not.toContain("ffa_rating.rank_empty");

    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      players("back") as never,
    );
    const retry = Array.from(list.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("leaderboard_modal.try_again"),
    ) as HTMLButtonElement;
    retry.click();
    await settle();
    expect(shownIds()).toEqual(["back"]);
  });

  it("clears a failed rank's retry when you switch tab", async () => {
    await open();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValueOnce(false as never);
    tab("gold").click();
    await settle();
    tab("diamond").click();
    await settle();
    expect(list.textContent).not.toContain("leaderboard_modal.try_again");
  });

  it("pins your row in the rank you are listed in", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      player: {
        publicId: "me",
        leaderboard: { ffa: { tier: "Gold II", elo: 1800, games: 20 } },
      },
    } as never);
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      players("a", "me") as never,
    );
    await open();
    const row = list.querySelector('tr[data-current-user="true"]');
    expect(row?.getAttribute("data-player-id")).toBe("me");
  });

  describe("your position outside the loaded rows", () => {
    const signedIn = (ffa: Record<string, unknown>) =>
      vi.mocked(getUserMe).mockResolvedValue({
        player: { publicId: "me", leaderboard: { ffa } },
      } as never);
    const rated = { tier: "Gold II", elo: 1800, games: 20, wins: 5 };
    const pinned = async () => {
      // jsdom has no layout: force what the scroll check decides in a browser.
      (list as unknown as { showStickyUser: boolean }).showStickyUser = true;
      await list.updateComplete;
      return list.querySelector("tfoot");
    };

    it("pins your exact position on your own rank", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(4812);
      await open();
      expect((await pinned())?.textContent).toContain("4812");
      expect((await pinned())?.textContent).toContain(
        "leaderboard_modal.your_ranking",
      );
    });

    it("isn't pinned on another rank's tab", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(4812);
      await open();
      tab("diamond").click();
      await settle();
      expect(await pinned()).toBeNull();
    });

    it("keeps your listed row's own number when you are in the loaded rows", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(4812);
      vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
        players("a", "me") as never,
      );
      await open();
      expect(
        list.querySelector('tr[data-current-user="true"]')?.textContent,
      ).toContain("2");
      expect((await pinned())?.textContent ?? "").not.toContain("4812");
    });

    it("shows no position when the board doesn't list you", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(null);
      await open();
      expect(await pinned()).toBeNull();
    });

    it("doesn't ask for a player with no rating", async () => {
      await open();
      expect(fetchFfaRankPosition).not.toHaveBeenCalled();
    });

    it("doesn't ask for a player the ± rule hides", async () => {
      signedIn({ ...rated, hiddenByUncertainty: true, uncertainty: 70 });
      await open();
      expect(fetchFfaRankPosition).not.toHaveBeenCalled();
    });

    it("asks once per load, not per page", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
        fullPage("p1") as never,
      );
      await open();
      await list.loadPlayerLeaderboard();
      await settle();
      expect(fetchFfaRankPosition).toHaveBeenCalledTimes(1);
    });

    it("fetches a fresh position after a full reload", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(4812);
      await open();
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(3100);
      await list.loadPlayerLeaderboard(true);
      await settle();
      expect(fetchFfaRankPosition).toHaveBeenCalledTimes(2);
      const text = (await pinned())?.textContent;
      expect(text).toContain("3100");
      expect(text).not.toContain("4812");
    });

    it("drops the old position when a reload finds none", async () => {
      signedIn(rated);
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(4812);
      await open();
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(null);
      await list.loadPlayerLeaderboard(true);
      await settle();
      expect(await pinned()).toBeNull();
    });

    it("ignores a position that arrives after a reload", async () => {
      signedIn(rated);
      let finish: (value: number) => void = () => {};
      vi.mocked(fetchFfaRankPosition).mockReturnValueOnce(
        new Promise<number>((resolve) => (finish = resolve)) as never,
      );
      await open();
      vi.mocked(fetchFfaRankPosition).mockResolvedValue(3100);
      await list.loadPlayerLeaderboard(true);
      await settle();
      finish(9999);
      await settle();
      const text = (await pinned())?.textContent;
      expect(text).toContain("3100");
      expect(text).not.toContain("9999");
    });
  });

  it("still reloads when a rank's next page is in flight", async () => {
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      fullPage("p1") as never,
    );
    await open();
    let finish: (value: unknown) => void = () => {};
    vi.mocked(fetchFfaRankLeaderboard).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)) as never,
    );
    void list.loadPlayerLeaderboard();
    await settle();

    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      fullPage("fresh") as never,
    );
    await list.loadPlayerLeaderboard(true);
    await settle();
    expect(fetchPlayerLeaderboard).toHaveBeenCalledTimes(2);
    expect(shownIds()).toContain("fresh-0");

    finish(players("stale"));
    await settle();
    expect(shownIds()).not.toContain("stale");

    vi.mocked(fetchFfaRankLeaderboard).mockClear();
    await list.loadPlayerLeaderboard();
    await settle();
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("diamond", 2);
  });

  describe("a slow rank page", () => {
    const openWithSlowPage = async () => {
      vi.mocked(fetchPlayerLeaderboard).mockResolvedValue({
        "1v1": Array.from({ length: 50 }, (_, i) => row(i + 1, `d-${i}`)),
        "2v2": [],
        ffa: [row(1, "top", "Diamond II")],
      } as never);
      vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
        fullPage("p1") as never,
      );
      await open();
      vi.mocked(fetchFfaRankLeaderboard).mockReturnValueOnce(
        new Promise(() => {}) as never,
      );
      void list.loadPlayerLeaderboard();
      await settle();
    };

    it("shows its loading state on the FFA tab", async () => {
      await openWithSlowPage();
      expect(list.textContent).toContain("common.loading");
    });

    it("doesn't show loading on another ladder", async () => {
      await openWithSlowPage();
      list.rankedType =
        RankedType.OneVOne as LeaderboardPlayerList["rankedType"];
      await settle();
      expect(list.textContent).not.toContain("common.loading");
    });

    it("doesn't stop another ladder loading its next page", async () => {
      await openWithSlowPage();
      list.rankedType =
        RankedType.OneVOne as LeaderboardPlayerList["rankedType"];
      await settle();
      vi.mocked(fetchPlayerLeaderboard).mockClear();
      await list.loadPlayerLeaderboard();
      expect(fetchPlayerLeaderboard).toHaveBeenCalledWith(2);
    });
  });

  describe("a rank that fails while another ladder is open", () => {
    beforeEach(() => {
      vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(false as never);
    });

    it("shows no retry on that other ladder", async () => {
      await open(RankedType.OneVOne);
      expect(list.textContent).not.toContain("leaderboard_modal.try_again");
    });

    it("offers the retry when you open the FFA tab", async () => {
      await open(RankedType.OneVOne);
      list.rankedType =
        RankedType.FreeForAll as LeaderboardPlayerList["rankedType"];
      await settle();
      expect(list.textContent).toContain("leaderboard_modal.try_again");
    });
  });

  describe("keyboard", () => {
    const press = async (rank: string, key: string) => {
      tab(rank).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
      await settle();
    };

    it("makes only the selected rank a tab stop", async () => {
      await open();
      expect(tabs().map((t) => t.tabIndex)).toEqual([
        -1, -1, -1, -1, -1, 0, -1, -1, 0,
      ]);
    });

    it("moves to the next rank with the right arrow, and focuses it", async () => {
      await open();
      await press("diamond", "ArrowRight");
      expect(selectedTab()?.dataset.rank).toBe("master");
      expect(document.activeElement).toBe(tab("master"));
    });

    it("moves to the previous rank with the left arrow", async () => {
      await open();
      await press("diamond", "ArrowLeft");
      expect(selectedTab()?.dataset.rank).toBe("platinum");
    });

    it("wraps at both ends", async () => {
      await open();
      await press("diamond", "End");
      expect(selectedTab()?.dataset.rank).toBe("grandmaster");
      await press("grandmaster", "ArrowRight");
      expect(selectedTab()?.dataset.rank).toBe("iron");
      await press("iron", "ArrowLeft");
      expect(selectedTab()?.dataset.rank).toBe("grandmaster");
      await press("grandmaster", "Home");
      expect(selectedTab()?.dataset.rank).toBe("iron");
    });

    it("leaves other keys alone", async () => {
      await open();
      await press("diamond", "a");
      expect(selectedTab()?.dataset.rank).toBe("diamond");
    });
  });

  it("ignores a slow answer after the board was reloaded", async () => {
    await open();
    let finish: (value: unknown) => void = () => {};
    vi.mocked(fetchFfaRankLeaderboard).mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)) as never,
    );
    tab("gold").click();
    await settle();
    vi.mocked(fetchFfaRankLeaderboard).mockResolvedValue(
      players("fresh") as never,
    );
    await list.loadPlayerLeaderboard(true);
    await settle();
    finish(players("stale"));
    await settle();
    expect(shownIds()).toEqual(["fresh"]);
  });
});
