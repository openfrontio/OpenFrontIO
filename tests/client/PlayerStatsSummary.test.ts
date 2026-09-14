import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    translateText: (key: string): string => {
      if (key === "player_stats_tree.stats_played") {
        return "Played";
      }
      if (key === "player_stats_tree.stats_last_100") {
        return "Last 100";
      }
      if (key === "player_stats_tree.all") {
        return "All";
      }
      if (key === "game_mode.hvn") {
        return "Humans vs Nations";
      }
      return key;
    },
  };
});

import {
  PlayerStatsSummary,
  buildPlayerStatsSummary,
} from "../../src/client/components/baseComponents/stats/PlayerStatsSummary";
import { PlayerStatsTreeView } from "../../src/client/components/baseComponents/stats/PlayerStatsTree";
import type {
  PlayerStatsLeaf,
  PlayerStatsTree,
} from "../../src/core/ApiSchemas";

const leaf: PlayerStatsLeaf = {
  wins: 3n,
  losses: 2n,
  total: 5n,
  stats: {
    attacks: [10_000n, 4_000n, 500n],
    conquests: [10n, 5n, 2n],
    bombs: {
      abomb: [5n, 4n, 1n],
      hbomb: [5n, 3n, 2n],
    },
    gold: [100n, 200n, 300n, 400n, 500n, 600n],
    boats: {
      trans: [20n, 15n, 2n, 3n],
      trade: [40n, 30n, 8n, 5n],
    },
    units: {
      city: [10n, 1n, 2n, 3n],
      fact: [4n, 0n, 0n, 0n],
      defp: [3n, 0n, 0n, 0n],
      port: [5n, 0n, 0n, 1n],
      wshp: [7n, 2n, 1n, 4n],
    },
  },
};

const leafWithRecent: PlayerStatsLeaf = {
  ...leaf,
  recent: { games: 5, wins: 4 },
};

function leafWithTotal(total: bigint): PlayerStatsLeaf {
  return {
    wins: total,
    losses: 0n,
    total,
    stats: {
      conquests: [total],
    },
  };
}

function getRenderedLeaf(
  tree: PlayerStatsTreeView,
): PlayerStatsLeaf | undefined {
  return tree.querySelector<PlayerStatsSummary>("player-stats-summary")?.leaf;
}

async function clickTab(
  tree: PlayerStatsTreeView,
  label: string,
): Promise<void> {
  const button = Array.from(
    tree.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ).find((candidate) => candidate.textContent?.trim() === label);
  expect(button, `tab "${label}" should exist`).toBeDefined();
  button?.click();
  await tree.updateComplete;
}

async function clickTabInRow(
  tree: PlayerStatsTreeView,
  rowIndex: number,
  label: string,
): Promise<void> {
  const row = tree.querySelectorAll('[role="tablist"]')[rowIndex];
  const button = Array.from(
    row?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [],
  ).find((candidate) => candidate.textContent?.trim() === label);
  expect(
    button,
    `tab "${label}" should exist in row ${rowIndex}`,
  ).toBeDefined();
  button?.click();
  await tree.updateComplete;
}

describe("PlayerStatsSummary", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("derives the selected bucket's win rate and gameplay metrics", () => {
    expect(buildPlayerStatsSummary(leafWithRecent)).toEqual({
      winRate: "60.0%",
      recentWinRate: "80.0%",
      played: "5",
      wins: "3",
      losses: "2",
      metrics: [
        {
          key: "cities",
          value: "2.0",
        },
        {
          key: "ports",
          value: "1.0",
        },
        {
          key: "factories",
          value: "0.8",
        },
        {
          key: "defensePosts",
          value: "0.6",
        },
        {
          key: "transports",
          value: "4.0",
        },
        {
          key: "landings",
          value: "3.0",
        },
        {
          key: "tradeArrived",
          value: "6.0",
        },
        {
          key: "tradeCaptured",
          value: "1.6",
        },
        {
          key: "outgoing",
          value: "2.00K",
        },
        {
          key: "incoming",
          value: "800",
        },
        {
          key: "nukes",
          value: "2.0",
        },
        {
          key: "warships",
          value: "1.4",
        },
        {
          key: "tradeGold",
          value: "60",
        },
        {
          key: "piracyGold",
          value: "80",
        },
        {
          key: "trainGold",
          value: "100",
        },
        {
          key: "othersTrainGold",
          value: "120",
        },
      ],
    });
  });

  it("renders sixteen gameplay cards as 4x4 on desktop", async () => {
    const summary = document.createElement(
      "player-stats-summary",
    ) as PlayerStatsSummary;
    summary.leaf = leaf;
    document.body.append(summary);

    await summary.updateComplete;

    expect(summary.querySelector("[data-win-rate]")?.textContent).toContain(
      "60.0%",
    );
    expect(summary.querySelector("[data-last-100]")).toBeNull();
    expect(
      summary.querySelector('[data-record-stat="played"]')?.textContent,
    ).toContain("Played");
    expect(
      summary.querySelector('[data-record-stat="played"]')?.textContent,
    ).toContain("5");
    expect(
      summary.querySelector('[data-record-stat="victories"]')?.textContent,
    ).toContain("3");
    expect(
      summary.querySelector('[data-record-stat="losses"]')?.textContent,
    ).toContain("2");
    const recordGroup = summary.querySelector("[data-record-group]");
    expect(recordGroup).not.toBeNull();
    const recordStats = Array.from(
      recordGroup?.querySelectorAll("[data-record-stat]") ?? [],
    );
    expect(recordStats).toHaveLength(3);
    expect(
      recordStats.every(
        (stat) =>
          stat.classList.contains("px-2") &&
          stat.classList.contains("py-3") &&
          stat.classList.contains("text-center"),
      ),
    ).toBe(true);
    expect(summary.querySelectorAll("[data-stat]")).toHaveLength(16);
    // Every tile marks the unit with the in-game icon next to the number
    // rather than in the label, so the value reads as "16 <city> / game".
    const cities = summary.querySelector('[data-stat="cities"]');
    expect(cities?.querySelector("[data-per-game]")?.textContent).toBe(
      "player_stats_tree.stats_per_game_suffix",
    );
    expect(cities?.querySelector("[data-unit]")?.getAttribute("src")).toBe(
      "/images/CityIconWhite.svg",
    );
    // SoldierIcon is authored black, so it is flipped to sit on a dark tile.
    // TroopIconWhite would be the obvious pick and is unusable in an <img>:
    // half of it is fill="currentColor" with no colour to inherit.
    const troopImg = summary.querySelector<HTMLImageElement>(
      '[data-stat="outgoing"] [data-unit]',
    );
    expect(troopImg?.getAttribute("src")).toBe("/images/SoldierIcon.svg");
    expect(troopImg?.style.filter).toBe("invert(1)");
    expect(
      summary.querySelector<HTMLImageElement>(
        '[data-stat="cities"] [data-unit]',
      )?.style.filter,
    ).toBe("");
    expect(summary.querySelectorAll("[data-per-game]")).toHaveLength(16);
    expect(summary.querySelectorAll("[data-unit]")).toHaveLength(16);
    // Paired tiles count the same unit, so they share one icon.
    expect(
      summary
        .querySelector('[data-stat="outgoing"] [data-unit]')
        ?.getAttribute("src"),
    ).toBe("/images/SoldierIcon.svg");
    expect(
      summary
        .querySelector('[data-stat="incoming"] [data-unit]')
        ?.getAttribute("src"),
    ).toBe("/images/SoldierIcon.svg");
    // The icon is decoration over a labelled number, not content of its own.
    const unitIcon = summary.querySelector("[data-unit]");
    expect(unitIcon?.getAttribute("aria-hidden")).toBe("true");
    expect(unitIcon?.getAttribute("alt")).toBe("");

    // Four family rows, each four tiles.
    expect(
      Array.from(summary.querySelectorAll("[data-metric-group]")).map((group) =>
        group.getAttribute("data-metric-group"),
      ),
    ).toEqual([
      "player_stats_tree.stats_group_buildings",
      "player_stats_tree.stats_group_naval",
      "player_stats_tree.stats_group_combat",
      "player_stats_tree.stats_group_gold",
    ]);
    for (const group of summary.querySelectorAll("[data-metric-group]")) {
      expect(group.querySelectorAll("[data-stat]")).toHaveLength(4);
    }

    // The heading names the family and the icon names the unit, so the
    // visible label is only what tells a tile from its neighbours.
    expect(
      summary.querySelector('[data-stat="transports"] [data-label]')
        ?.textContent,
    ).toContain("player_stats_tree.stats_transports_sent_short");
    expect(
      summary.querySelector('[data-stat="landings"] [data-label]')?.textContent,
    ).toContain("player_stats_tree.stats_transports_landed_short");

    // Every building tile reads "Built" — the icon is what says which.
    for (const stat of ["cities", "ports", "factories", "defensePosts"]) {
      expect(
        summary.querySelector(`[data-stat="${stat}"] [data-label]`)
          ?.textContent,
      ).toContain("player_stats_table.built");
    }

    // "Built" alone does not name a metric, so each tile also carries its full
    // name for screen readers, and the visible short label is hidden from them
    // rather than read out on top of it.
    expect(
      cities?.querySelector("[data-label]")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(cities?.querySelector(".sr-only")?.textContent).toContain(
      "player_stats_tree.stats_cities_per_game",
    );

    // Hovering any tile still spells the metric out in full.
    expect(cities?.getAttribute("title")).toBe(
      "player_stats_tree.stats_cities_per_game",
    );

    // One square box for every icon, scaled to fit, so layout never shifts
    // with the icon's shape.
    for (const icon of summary.querySelectorAll("[data-unit]")) {
      expect(icon.className).toContain("h-[1em]");
      expect(icon.className).toContain("w-[1em]");
      expect(icon.className).toContain("object-contain");
    }

    // Assets pad their canvas by different amounts, so each is corrected to
    // sit at the same visual weight. The factors themselves are tuned by eye
    // and deliberately not asserted here — only that every icon carries one,
    // and that an icon with no entry is left alone rather than defaulted to
    // something arbitrary.
    const scaleOf = (stat: string) =>
      summary.querySelector<HTMLImageElement>(
        `[data-stat="${stat}"] [data-unit]`,
      )?.style.transform;
    for (const icon of summary.querySelectorAll<HTMLImageElement>(
      "[data-unit]",
    )) {
      expect(icon.style.transform).toMatch(/^scale\(\d*\.?\d+\)$/);
    }
    // Shield and transport are the two assets already meeting the box, so
    // they must come through untouched.
    expect(scaleOf("defensePosts")).toBe("scale(1)");
    expect(scaleOf("transports")).toBe("scale(1)");

    const metricGrid =
      summary.querySelector("[data-stat]")?.parentElement?.classList;
    expect(metricGrid).toContain("grid-cols-2");
    expect(metricGrid).toContain("sm:grid-cols-4");
    expect(
      summary.querySelector('[data-stat="outgoing"]')?.textContent,
    ).toContain("2.00K");
    expect(
      summary.querySelector('[data-stat="incoming"]')?.textContent,
    ).toContain("800");
    expect(
      summary.querySelector('[data-stat="warships"]')?.textContent,
    ).toContain("1.4");
    expect(
      summary.querySelector('[data-stat="cities"]')?.textContent,
    ).toContain("2.0");
    expect(summary.querySelector('[data-stat="ports"]')?.textContent).toContain(
      "1.0",
    );
    expect(
      summary.querySelector('[data-stat="tradeGold"]')?.textContent,
    ).toContain("60");
    expect(
      summary.querySelector('[data-stat="piracyGold"]')?.textContent,
    ).toContain("80");
    expect(
      summary.querySelector('[data-stat="trainGold"]')?.textContent,
    ).toContain("100");
    expect(
      summary.querySelector('[data-stat="othersTrainGold"]')?.textContent,
    ).toContain("120");
    expect(summary.querySelector('[data-stat="nukes"]')?.textContent).toContain(
      "2.0",
    );
    expect(
      summary.querySelector('[data-stat="factories"]')?.textContent,
    ).toContain("0.8");
    expect(
      summary.querySelector('[data-stat="transports"]')?.textContent,
    ).toContain("4.0");
    expect(
      summary.querySelector('[data-stat="tradeArrived"]')?.textContent,
    ).toContain("6.0");
    expect(
      summary.querySelector('[data-stat="tradeCaptured"]')?.textContent,
    ).toContain("1.6");
    expect(
      summary.querySelector('[data-stat="landings"]')?.textContent,
    ).toContain("3.0");
    expect(
      summary.querySelector('[data-stat="defensePosts"]')?.textContent,
    ).toContain("0.6");
  });

  it("shows no recent win rate when the selected bucket has no recent games", () => {
    expect(buildPlayerStatsSummary(leaf).recentWinRate).toBe("—");
  });

  it("shows Last 100 only after the active category exceeds 100 played games", async () => {
    const summary = document.createElement(
      "player-stats-summary",
    ) as PlayerStatsSummary;
    summary.leaf = {
      ...leaf,
      wins: 75n,
      losses: 25n,
      total: 100n,
      recent: { games: 100, wins: 75 },
    };
    document.body.append(summary);

    await summary.updateComplete;

    expect(summary.querySelector("[data-last-100]")).toBeNull();

    summary.leaf = {
      ...summary.leaf,
      wins: 76n,
      total: 101n,
    };
    await summary.updateComplete;

    expect(summary.querySelector("[data-last-100]")?.textContent).toContain(
      "Last 100",
    );
    expect(summary.querySelector("[data-last-100]")?.textContent).toContain(
      "75.0%",
    );
  });

  it("replaces the legacy four-card grid in the selected stats tree", async () => {
    const statsTree: PlayerStatsTree = {
      Public: {
        "Free For All": {
          Medium: leaf,
        },
      },
    };
    // Instantiate the real class directly so profile-modal tests that register
    // a lightweight stand-in under the same custom-element tag cannot mask the
    // integration behavior this test covers.
    const tree = new PlayerStatsTreeView();
    tree.statsTree = statsTree;
    document.body.append(tree);

    await tree.updateComplete;

    const summary = tree.querySelector(
      "player-stats-summary",
    ) as PlayerStatsSummary | null;
    expect(summary?.leaf).toEqual(leaf);
    expect(tree.querySelector("player-stats-grid")).toBeNull();
  });

  it("gives the performance summary equal padding above and below", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Medium: leaf,
        },
      },
    };
    document.body.append(tree);

    await tree.updateComplete;

    const summary = tree.querySelector("player-stats-summary");
    expect(summary?.parentElement?.classList.contains("py-3")).toBe(true);
  });

  it("keeps a leaf's own recent stats when no tree-level aggregate exists", async () => {
    // Older responses carry `recent` per leaf instead of the tree-level
    // stats.recent aggregate; an exact selection still goes through
    // mergeLeaves, which must not drop it.
    const recentLeaf: PlayerStatsLeaf = {
      ...leaf,
      recent: { games: 40, wins: 30 },
    };
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: { "Free For All": { Medium: recentLeaf } },
    };
    document.body.append(tree);
    await tree.updateComplete;

    const summary = tree.querySelector(
      "player-stats-summary",
    ) as PlayerStatsSummary | null;
    expect(summary?.leaf?.recent).toEqual({ games: 40, wins: 30 });
  });

  it("shows Humans vs Nations separately from ordinary Team games", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Medium: leafWithTotal(1n),
        },
        Team: {
          Medium: leafWithTotal(2n),
        },
        "Humans Vs Nations": {
          Hard: leafWithTotal(4n),
        },
      },
    };
    document.body.append(tree);

    await tree.updateComplete;
    await clickTab(tree, "player_stats_tree.public");

    const modeRow = tree.querySelectorAll('[role="tablist"]')[1];
    expect(
      Array.from(
        modeRow.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ).map((button) => button.textContent?.trim()),
    ).toEqual(["All", "game_mode.ffa", "game_mode.teams", "Humans vs Nations"]);

    await clickTab(tree, "Humans vs Nations");

    expect(getRenderedLeaf(tree)?.total).toBe(4n);
  });

  it("hides difficulty for Public and merges every difficulty bucket", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Easy: leafWithTotal(1n),
          Medium: leafWithTotal(2n),
        },
        Team: {
          Hard: leafWithTotal(4n),
        },
      },
      Private: {
        Team: {
          Hard: leafWithTotal(8n),
          Easy: leafWithTotal(16n),
        },
      },
    };
    document.body.append(tree);

    await tree.updateComplete;
    await clickTab(tree, "player_stats_tree.private");
    await clickTab(tree, "difficulty.hard");
    expect(getRenderedLeaf(tree)?.total).toBe(8n);

    await clickTab(tree, "player_stats_tree.public");

    expect(tree.querySelectorAll('[role="tablist"]')).toHaveLength(2);
    expect(getRenderedLeaf(tree)?.total).toBe(7n);

    await clickTab(tree, "game_mode.ffa");
    expect(getRenderedLeaf(tree)?.total).toBe(3n);
  });

  it("puts All first in every filter and aggregates the selected branches", async () => {
    const statsTree: PlayerStatsTree = {
      Public: {
        "Free For All": {
          Easy: leafWithTotal(1n),
          Medium: leafWithTotal(2n),
        },
        Team: {
          Easy: leafWithTotal(4n),
          Hard: leafWithTotal(8n),
        },
      },
      Private: {
        "Free For All": {
          Impossible: leafWithTotal(16n),
        },
      },
      Ranked: {
        "1v1": leafWithTotal(32n),
        "2v2": leafWithTotal(64n),
      },
      Singleplayer: {
        Team: {
          Hard: leafWithTotal(128n),
        },
      },
    };
    const tree = new PlayerStatsTreeView();
    tree.statsTree = statsTree;
    document.body.append(tree);

    await tree.updateComplete;

    let rows = Array.from(tree.querySelectorAll('[role="tablist"]'));
    expect(rows).toHaveLength(1);
    expect(
      Array.from(
        rows[0].querySelectorAll<HTMLButtonElement>('[role="tab"]'),
      ).map((button) => button.textContent?.trim()),
    ).toEqual([
      "All",
      "player_stats_tree.public",
      "player_stats_tree.private",
      "player_stats_tree.ranked",
      "player_stats_tree.solo",
    ]);
    expect(
      rows[0].querySelector<HTMLButtonElement>('[role="tab"]')?.textContent,
    ).toContain("All");
    expect(getRenderedLeaf(tree)?.total).toBe(255n);
    expect(getRenderedLeaf(tree)?.stats?.conquests).toEqual([255n]);

    await clickTab(tree, "player_stats_tree.public");
    rows = Array.from(tree.querySelectorAll('[role="tablist"]'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(
        row.querySelector<HTMLButtonElement>('[role="tab"]')?.textContent,
      ).toContain("All");
    }
    expect(getRenderedLeaf(tree)?.total).toBe(15n);

    await clickTab(tree, "game_mode.ffa");
    expect(getRenderedLeaf(tree)?.total).toBe(3n);

    await clickTab(tree, "game_mode.teams");
    expect(getRenderedLeaf(tree)?.total).toBe(12n);

    await clickTabInRow(tree, 1, "All");
    expect(getRenderedLeaf(tree)?.total).toBe(15n);

    await clickTab(tree, "player_stats_tree.ranked");
    rows = Array.from(tree.querySelectorAll('[role="tablist"]'));
    expect(rows).toHaveLength(2);
    expect(
      rows[1].querySelector<HTMLButtonElement>('[role="tab"]')?.textContent,
    ).toContain("All");
    expect(getRenderedLeaf(tree)?.total).toBe(96n);

    await clickTab(tree, "player_stats_tree.ranked_2v2");
    expect(getRenderedLeaf(tree)?.total).toBe(64n);

    await clickTabInRow(tree, 1, "All");
    expect(getRenderedLeaf(tree)?.total).toBe(96n);
  });

  it("uses the exact recent aggregate for every active filter", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Medium: leafWithTotal(101n),
        },
      },
      Private: {
        "Free For All": {
          Easy: leafWithTotal(101n),
          Hard: leafWithTotal(101n),
        },
        Team: {
          Hard: leafWithTotal(101n),
        },
      },
      Ranked: {
        "1v1": leafWithTotal(101n),
        "2v2": leafWithTotal(101n),
      },
      recent: {
        all: { games: 100, wins: 60 },
        Public: {
          all: { games: 100, wins: 61 },
          Medium: { games: 100, wins: 61 },
          "Free For All": {
            all: { games: 100, wins: 62 },
            Medium: { games: 100, wins: 62 },
          },
        },
        Private: {
          all: { games: 100, wins: 63 },
          Hard: { games: 100, wins: 64 },
          "Free For All": {
            all: { games: 100, wins: 65 },
            Easy: { games: 100, wins: 66 },
            Hard: { games: 100, wins: 67 },
          },
          Team: {
            all: { games: 100, wins: 68 },
            Hard: { games: 100, wins: 69 },
          },
        },
        Ranked: {
          all: { games: 100, wins: 70 },
          "1v1": { games: 100, wins: 71 },
          "2v2": { games: 100, wins: 72 },
        },
      },
    };
    document.body.append(tree);

    await tree.updateComplete;
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 60 });

    await clickTab(tree, "player_stats_tree.private");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 63 });

    await clickTab(tree, "difficulty.hard");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 64 });

    await clickTab(tree, "game_mode.ffa");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 67 });

    await clickTabInRow(tree, 2, "All");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 65 });

    await clickTab(tree, "player_stats_tree.public");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 62 });

    await clickTabInRow(tree, 1, "All");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 61 });

    await clickTab(tree, "player_stats_tree.ranked");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 70 });

    await clickTab(tree, "player_stats_tree.ranked_1v1");
    expect(getRenderedLeaf(tree)?.recent).toEqual({ games: 100, wins: 71 });
  });

  it("resets every filter to All when the profile stats tree changes", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Medium: leafWithTotal(1n),
        },
      },
      Ranked: {
        "2v2": leafWithTotal(2n),
      },
    };
    document.body.append(tree);
    await tree.updateComplete;

    await clickTab(tree, "player_stats_tree.ranked");
    await clickTab(tree, "player_stats_tree.ranked_2v2");
    expect(getRenderedLeaf(tree)?.total).toBe(2n);

    tree.statsTree = {
      Public: {
        Team: {
          Hard: leafWithTotal(10n),
        },
      },
      Private: {
        "Free For All": {
          Impossible: leafWithTotal(20n),
        },
      },
      Ranked: {
        "2v2": leafWithTotal(30n),
      },
    };
    await tree.updateComplete;

    const rows = tree.querySelectorAll('[role="tablist"]');
    const firstTab = rows[0].querySelector<HTMLButtonElement>('[role="tab"]');
    expect(rows).toHaveLength(1);
    expect(firstTab?.textContent).toContain("All");
    expect(firstTab?.getAttribute("aria-selected")).toBe("true");
    expect(getRenderedLeaf(tree)?.total).toBe(60n);
  });
});
