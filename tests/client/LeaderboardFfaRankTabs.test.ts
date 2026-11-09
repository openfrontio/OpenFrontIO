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
  getUserMe: vi.fn(async () => false),
}));

import {
  fetchFfaRankLeaderboard,
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
  vi.mocked(fetchPlayerLeaderboard)
    .mockReset()
    .mockResolvedValue(overall([row(1, "top", "Diamond II")]) as never);
  vi.mocked(fetchFfaRankLeaderboard)
    .mockReset()
    .mockResolvedValue(players("a", "b") as never);
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
    ]);
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

  it("opens on the highest rank with players for anyone else", async () => {
    await open();
    expect(selectedTab()?.dataset.rank).toBe("diamond");
    expect(fetchFfaRankLeaderboard).toHaveBeenCalledWith("diamond", 1);
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
    expect(tabs()).toHaveLength(8);
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
