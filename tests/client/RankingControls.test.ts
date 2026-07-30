import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RankType } from "../../src/client/components/baseComponents/ranking/GameInfoRanking";
import { RankingControls } from "../../src/client/components/baseComponents/ranking/RankingControls";

async function mountControls(rankType: RankType): Promise<RankingControls> {
  const controls = document.createElement(
    "ranking-controls",
  ) as RankingControls;
  controls.rankType = rankType;
  document.body.appendChild(controls);
  await controls.updateComplete;
  return controls;
}

describe("RankingControls", () => {
  let controls: RankingControls | null = null;

  beforeAll(() => {
    if (!customElements.get("ranking-controls")) {
      customElements.define("ranking-controls", RankingControls);
    }
  });

  afterEach(() => controls?.remove());

  it("shows every war metric in one selector and dispatches the selected type", async () => {
    controls = await mountControls(RankType.ConquestHumans);
    const metrics = [
      ...controls.querySelectorAll<HTMLButtonElement>("[data-ranking-metric]"),
    ];

    expect(metrics.map((button) => button.dataset.rankingMetric)).toEqual([
      RankType.ConquestHumans,
      RankType.ConquestNations,
      RankType.ConquestBots,
      RankType.Atoms,
      RankType.Hydros,
      RankType.MIRV,
    ]);
    expect(metrics[0].getAttribute("aria-pressed")).toBe("true");
    expect(
      metrics.filter(
        (button) => button.getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(1);

    const onSort = vi.fn();
    controls.addEventListener("sort", onSort);
    metrics.forEach((metric) => metric.click());
    expect(onSort.mock.calls.map(([event]) => event.detail)).toEqual(
      metrics.map((metric) => metric.dataset.rankingMetric),
    );
  });

  it("shows every economy metric in one selector", async () => {
    controls = await mountControls(RankType.TotalGold);

    expect(
      [
        ...controls.querySelectorAll<HTMLButtonElement>(
          "[data-ranking-metric]",
        ),
      ].map((button) => button.dataset.rankingMetric),
    ).toEqual([
      RankType.TotalGold,
      RankType.ConqueredGold,
      RankType.StolenGold,
      RankType.TrainTrade,
      RankType.NavalTrade,
    ]);

    const metrics = [
      ...controls.querySelectorAll<HTMLButtonElement>("[data-ranking-metric]"),
    ];
    expect(metrics[0].getAttribute("aria-pressed")).toBe("true");
    expect(
      metrics.filter(
        (button) => button.getAttribute("aria-pressed") === "true",
      ),
    ).toHaveLength(1);
  });
});
