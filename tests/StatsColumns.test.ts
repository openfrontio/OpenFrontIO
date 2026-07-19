import { COLUMN_DEFS, columnById } from "../src/client/hud/layers/StatsColumns";
import {
  COLUMN_IDS,
  DEFAULT_STATS_COLUMNS,
} from "../src/core/game/StatsConstants";
import { makeGameView, makePlayerView, stubConfig } from "./util/viewStubs";

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

  it("defaults reference valid ids", () => {
    for (const id of DEFAULT_STATS_COLUMNS) {
      expect(COLUMN_IDS).toContain(id);
    }
  });

  it("evaluates and renders every column", () => {
    const game = makeGameView({
      config: stubConfig({ maxTroops: () => 1_000 }),
    });
    const player = makePlayerView({ game });

    for (const column of COLUMN_DEFS) {
      const value = column.value(player, game);
      expect(typeof value).toBe("number");
      expect(typeof column.renderValue(value, game)).toBe("string");
    }
  });

  it("renders zero owned percentage when no valid land remains", () => {
    const game = makeGameView();
    vi.spyOn(game, "numLandTiles").mockReturnValue(0);
    vi.spyOn(game, "numTilesWithFallout").mockReturnValue(0);

    expect(columnById("tiles").renderValue(1, game)).toBe("0.0%");
  });
});
