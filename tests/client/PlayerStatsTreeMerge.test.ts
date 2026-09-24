import { afterEach, describe, expect, it } from "vitest";
import type { PlayerStatsSummary } from "../../src/client/components/baseComponents/stats/PlayerStatsSummary";
import { PlayerStatsTreeView } from "../../src/client/components/baseComponents/stats/PlayerStatsTree";
import type { PlayerStatsLeaf } from "../../src/core/ApiSchemas";
import {
  ATTACK_INDEX_CANCEL,
  ATTACK_INDEX_MAX_RECV,
  ATTACK_INDEX_RECV,
  ATTACK_INDEX_SENT,
} from "../../src/core/StatsSchemas";

function leafWithAttacks(attacks: bigint[]): PlayerStatsLeaf {
  return { wins: 1n, losses: 0n, total: 1n, stats: { attacks } };
}

describe("PlayerStatsTreeView attack aggregation", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("sums attack totals across buckets but takes the larger maximum", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Easy: leafWithAttacks([100n, 200n, 300n, 900n]),
          Medium: leafWithAttacks([10n, 20n, 30n, 40n]),
        },
      },
    };
    document.body.append(tree);
    await tree.updateComplete;

    const merged = tree.querySelector<PlayerStatsSummary>(
      "player-stats-summary",
    )?.leaf?.stats?.attacks;

    expect(merged?.[ATTACK_INDEX_SENT]).toBe(110n);
    expect(merged?.[ATTACK_INDEX_RECV]).toBe(220n);
    expect(merged?.[ATTACK_INDEX_CANCEL]).toBe(330n);
    // Per-game maximum: the largest attack ever faced, not 940n.
    expect(merged?.[ATTACK_INDEX_MAX_RECV]).toBe(900n);
  });

  it("takes the maximum whichever bucket holds it", async () => {
    const tree = new PlayerStatsTreeView();
    tree.statsTree = {
      Public: {
        "Free For All": {
          Easy: leafWithAttacks([1n, 1n, 1n, 40n]),
          Medium: leafWithAttacks([1n, 1n, 1n, 900n]),
        },
      },
    };
    document.body.append(tree);
    await tree.updateComplete;

    const merged = tree.querySelector<PlayerStatsSummary>(
      "player-stats-summary",
    )?.leaf?.stats?.attacks;

    expect(merged?.[ATTACK_INDEX_MAX_RECV]).toBe(900n);
  });
});
