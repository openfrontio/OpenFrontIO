// @vitest-environment jsdom
import { ColumnTooltip } from "../src/client/hud/layers/ColumnTooltip";
import {
  COLUMN_DEFS,
  columnById,
} from "../src/client/hud/layers/lib/StatsColumns";
import type { ColumnId } from "../src/client/StatsConstants";

describe("ColumnTooltip", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function show(id: ColumnId, hint = false): Promise<ColumnTooltip> {
    const anchor = document.createElement("button");
    const tooltip = new ColumnTooltip();
    const host = document.createElement("div");
    host.append(anchor, tooltip);
    document.body.append(host);
    tooltip.column = columnById(id);
    tooltip.anchor = anchor;
    tooltip.hint = hint;
    tooltip.tooltipId = "player-column-tooltip";
    await tooltip.updateComplete;
    return tooltip;
  }

  const tips = () => document.querySelectorAll("[data-column-tooltip]");

  it("draws one tooltip under <body> with the column's name, and takes it away", async () => {
    const tooltip = await show("gold");

    expect(tips()).toHaveLength(1);
    const tip = tips()[0];
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.id).toBe("player-column-tooltip");
    expect(tooltip.contains(tip)).toBe(false);
    expect(tip.textContent).toContain("leaderboard.gold");

    tooltip.column = null;
    await tooltip.updateComplete;
    expect(tips()).toHaveLength(0);

    tooltip.column = columnById("gold");
    await tooltip.updateComplete;
    expect(tips()).toHaveLength(1);
    tooltip.remove();
    expect(tips()).toHaveLength(0);
  });

  it("explains the seven columns whose name does not say what they count", async () => {
    const explained: ColumnId[] = [
      "playerType",
      "tiles",
      "goldIncomePerMin",
      "shipTradeGoldPerMin",
      "piracyGoldPerMin",
      "trainTradeGoldPerMin",
      "maxtroops",
    ];
    for (const column of COLUMN_DEFS) {
      const tooltip = await show(column.id);
      const meaning = tips()[0].textContent?.includes("leaderboard.desc_");
      expect(meaning, column.id).toBe(explained.includes(column.id));
      tooltip.remove();
    }
  });

  it("shows the right-click hint only when asked", async () => {
    await show("tiles");
    expect(tips()[0].textContent).not.toContain("leaderboard.columns_hint");
    document.body.innerHTML = "";

    await show("tiles", true);
    expect(tips()[0].textContent).toContain("leaderboard.columns_hint");
  });
});
