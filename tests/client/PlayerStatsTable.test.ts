import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/client/Utils")>();
  return {
    ...actual,
    // Render each label as its own key so a column can be matched to the
    // value sitting under it.
    translateText: (key: string): string => key,
  };
});

import { PlayerStatsTable } from "../../src/client/components/baseComponents/stats/PlayerStatsTable";
import type { PlayerStats } from "../../src/core/StatsSchemas";

/**
 * Distinct values per slot so a shifted column is always visible: no two
 * numbers within one table repeat.
 */
const stats: PlayerStats = {
  attacks: [11n, 12n, 13n],
  betrayals: 7n,
  boats: {
    trade: [21n, 22n, 23n, 24n],
    trans: [31n, 32n, 33n, 34n],
  },
  bombs: {
    abomb: [41n, 42n, 43n],
    hbomb: [51n, 52n, 53n],
    mirv: [61n, 62n, 63n],
    mirvw: [71n, 72n, 73n],
  },
  gold: [81n, 82n, 83n, 84n, 85n, 86n],
  units: {
    city: [91n, 92n, 93n, 94n],
    defp: [101n, 102n, 103n, 104n],
    port: [111n, 112n, 113n, 114n],
    saml: [121n, 122n, 123n, 124n],
    silo: [131n, 132n, 133n, 134n],
    fact: [141n, 142n, 143n, 144n],
    wshp: [151n, 152n, 153n, 154n],
  },
};

async function renderTable(value: PlayerStats): Promise<PlayerStatsTable> {
  // Constructed rather than createElement'd on purpose: a `as PlayerStatsTable`
  // cast is a type-only reference, so the import — and with it the
  // `@customElement` registration — gets elided and nothing ever renders.
  const table = new PlayerStatsTable();
  table.stats = value;
  document.body.append(table);
  await table.updateComplete;
  return table;
}

function text(node: Element | null | undefined): string {
  return node?.textContent?.trim() ?? "";
}

/**
 * Pairs each column header with the cell beneath it, for the section whose
 * heading matches. Sections with a single unnamed row have no label column,
 * so headers and cells line up one-to-one either way.
 */
function columnsOf(
  root: PlayerStatsTable,
  heading: string,
  rowMatch?: string,
): Record<string, string> {
  const section = Array.from(root.querySelectorAll(":scope > div > div")).find(
    (candidate) => text(candidate.firstElementChild) === heading,
  );
  expect(section, `section "${heading}" should exist`).toBeDefined();
  const table = section?.querySelector("table");
  expect(table, `table under "${heading}" should exist`).toBeDefined();

  const headers = Array.from(table?.querySelectorAll("thead th") ?? []).map(
    text,
  );
  const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []);
  const row =
    rowMatch === undefined
      ? rows[0]
      : rows.find(
          (candidate) => text(candidate.querySelector("td")) === rowMatch,
        );
  expect(row, `row "${rowMatch ?? "first"}" should exist`).toBeDefined();

  const cells = Array.from(row?.querySelectorAll("td") ?? []).map(text);
  expect(cells).toHaveLength(headers.length);
  return Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
}

describe("PlayerStatsTable", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("lines gold columns up with their sources", async () => {
    const table = await renderTable(stats);

    expect(columnsOf(table, "player_stats_table.gold_stats")).toEqual({
      "player_stats_table.workers": "81",
      "player_stats_table.war": "82",
      "player_stats_table.trade": "83",
      "player_stats_table.piracy": "84",
      "player_stats_table.trains": "85",
      "player_stats_table.trains_external": "86",
    });
  });

  it("shows attack counts under the matching headers", async () => {
    const table = await renderTable(stats);

    expect(columnsOf(table, "player_stats_table.attack_stats")).toEqual({
      "player_stats_table.sent": "11",
      "player_stats_table.incoming": "12",
      "player_stats_table.cancelled": "13",
    });
  });

  it("shows betrayals", async () => {
    const table = await renderTable(stats);

    expect(columnsOf(table, "player_stats_table.diplomacy_stats")).toEqual({
      "player_stats_table.betrayals": "7",
    });
  });

  it("shows every boat column including captured", async () => {
    const table = await renderTable(stats);

    expect(
      columnsOf(
        table,
        "player_stats_table.ship_arrivals",
        "player_stats_table.unit.trade",
      ),
    ).toEqual({
      "player_stats_table.ship_type": "player_stats_table.unit.trade",
      "player_stats_table.sent": "21",
      "player_stats_table.arrived": "22",
      "player_stats_table.captured": "23",
      "player_stats_table.destroyed": "24",
    });
  });

  it("shows building columns in built/destroyed/captured/lost order", async () => {
    const table = await renderTable(stats);

    expect(
      columnsOf(table, "player_stats_table.building_stats", "unit_type.city"),
    ).toEqual({
      "player_stats_table.building": "unit_type.city",
      "player_stats_table.built": "91",
      "player_stats_table.destroyed": "92",
      "player_stats_table.captured": "93",
      "player_stats_table.lost": "94",
    });
  });

  it("keeps warships out of the buildings table and gives them their own", async () => {
    const table = await renderTable(stats);

    const buildings = Array.from(table.querySelectorAll("table")).find(
      (candidate) =>
        text(candidate.querySelector("th")) === "player_stats_table.building",
    );
    expect(buildings, "buildings table should exist").toBeDefined();
    // The six structures, with the warship row moved to its own section.
    expect(buildings?.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(buildings?.textContent).not.toContain("unit_type.warship");

    expect(columnsOf(table, "player_stats_table.warship_stats")).toEqual({
      "player_stats_table.built": "151",
      "player_stats_table.destroyed": "152",
      "player_stats_table.captured": "153",
      "player_stats_table.lost": "154",
    });
  });

  it("shows nuke columns in launched/landed/intercepted order", async () => {
    const table = await renderTable(stats);

    expect(
      columnsOf(table, "player_stats_table.nuke_stats", "unit_type.atom_bomb"),
    ).toEqual({
      "player_stats_table.weapon": "unit_type.atom_bomb",
      "player_stats_table.launched": "41",
      "player_stats_table.landed": "42",
      "player_stats_table.intercepted": "43",
    });
  });

  it("zero-fills gold columns past the end of a short array", async () => {
    const table = await renderTable({ gold: [11n, 22n] });

    expect(columnsOf(table, "player_stats_table.gold_stats")).toEqual({
      "player_stats_table.workers": "11",
      "player_stats_table.war": "22",
      "player_stats_table.trade": "0",
      "player_stats_table.piracy": "0",
      "player_stats_table.trains": "0",
      "player_stats_table.trains_external": "0",
    });
  });

  it("renders zeroes rather than blanks when stats are missing", async () => {
    const table = await renderTable(undefined);

    expect(columnsOf(table, "player_stats_table.gold_stats")).toEqual({
      "player_stats_table.workers": "0",
      "player_stats_table.war": "0",
      "player_stats_table.trade": "0",
      "player_stats_table.piracy": "0",
      "player_stats_table.trains": "0",
      "player_stats_table.trains_external": "0",
    });
    expect(columnsOf(table, "player_stats_table.diplomacy_stats")).toEqual({
      "player_stats_table.betrayals": "0",
    });
  });
});
