import { profileIcon, teamIcon } from "../src/client/hud/HotbarIcons";
import {
  COLUMN_DEFS,
  columnById,
  columnsFor,
} from "../src/client/hud/layers/lib/StatsColumns";
import {
  COLUMN_IDS,
  DEFAULT_STATS_COLUMNS,
} from "../src/client/StatsConstants";
import { makeGameView, makePlayerView, stubConfig } from "./util/viewStubs";

const emptyRow = {
  position: 1,
  name: "alice",
  clanTag: null,
  value: 0,
};

describe("Stats column registry", () => {
  it("has unique column ids", () => {
    expect(new Set(COLUMN_IDS).size).toBe(COLUMN_DEFS.length);
    expect(COLUMN_DEFS.map((column) => column.id)).toEqual(COLUMN_IDS);
  });

  it("columnById returns the matching def for every id", () => {
    for (const def of COLUMN_DEFS) {
      expect(columnById(def.id)).toBe(def);
    }
  });

  it("marks exactly the columns with a value as orderable", () => {
    for (const def of COLUMN_DEFS) {
      expect(def.isOrderable).toBe(def.value !== undefined);
    }
    expect(columnById("rank").isOrderable).toBe(false);
    expect(columnById("clan").isOrderable).toBe(false);
    expect(columnById("player").isOrderable).toBe(false);
    expect(columnById("tiles").isOrderable).toBe(true);
  });

  it("gives the team column its own icon, not the player one", () => {
    expect(columnById("team").headerVisual).toEqual({
      kind: "icon",
      src: teamIcon,
    });
    expect(columnById("player").headerVisual).toEqual({
      kind: "icon",
      src: profileIcon,
    });
  });

  it("keeps rank and the identity column out of the cog menu", () => {
    expect(columnById("rank").isHideable).toBe(false);
    expect(columnById("player").isHideable).toBe(false);
    expect(columnById("team").isHideable).toBe(false);
    expect(columnById("clan").isHideable).toBe(true);
    expect(columnById("gold").isHideable).toBe(true);
  });

  it("gives identity columns a fixed track and stat columns a shared one", () => {
    for (const def of COLUMN_DEFS) {
      expect(def.width === "auto").toBe(def.isOrderable);
    }
  });

  it("splits the tables on clan and the identity column", () => {
    expect(columnsFor("player").map((column) => column.id)).toEqual([
      "rank",
      "clan",
      "player",
      ...COLUMN_IDS.slice(4),
    ]);
    expect(columnsFor("team").map((column) => column.id)).toEqual([
      "rank",
      "team",
      ...COLUMN_IDS.slice(4),
    ]);
  });

  it("defaults reference hideable ids that exist", () => {
    for (const [kind, ids] of Object.entries(DEFAULT_STATS_COLUMNS)) {
      for (const id of ids) {
        expect(columnById(id).isHideable).toBe(true);
        expect(columnById(id).kinds).toContain(kind);
      }
    }
    expect(DEFAULT_STATS_COLUMNS.player).toContain("clan");
    expect(DEFAULT_STATS_COLUMNS.team).not.toContain("clan");
  });

  it("renders a cell for every column", () => {
    const game = makeGameView({
      config: stubConfig({ maxTroops: () => 1_000 }),
    });
    const player = makePlayerView({ game });

    for (const column of COLUMN_DEFS) {
      if (column.value !== undefined) {
        expect(typeof column.value(player, game)).toBe("number");
      }
      expect(typeof column.cell(emptyRow, game)).toBe("string");
    }
  });

  it("reads identity cells off the row, not the value map", () => {
    const game = makeGameView();
    const row = { ...emptyRow, position: 7, clanTag: "ABCDE" };

    expect(columnById("rank").cell(row, game)).toBe("7");
    expect(columnById("clan").cell(row, game)).toBe("ABCDE");
    expect(columnById("player").cell(row, game)).toBe("alice");
    expect(columnById("team").cell(row, game)).toBe("alice");
    expect(columnById("clan").cell(emptyRow, game)).toBe("");
  });

  it("renders zero owned percentage when no valid land remains", () => {
    const game = makeGameView();
    vi.spyOn(game, "numLandTiles").mockReturnValue(0);
    vi.spyOn(game, "numTilesWithFallout").mockReturnValue(0);

    expect(columnById("tiles").cell(emptyRow, game)).toBe("0.0%");
  });
});
