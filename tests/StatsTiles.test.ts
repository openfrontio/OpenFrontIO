import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { StatsImpl } from "../src/core/game/StatsImpl";
import {
  ALLIANCE_INDEX_PEAK_CONCURRENT,
  TILE_INDEX_DRAWDOWN_PEAK,
  TILE_INDEX_DRAWDOWN_TROUGH,
  TILE_INDEX_PEAK,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

describe("tick sampling", () => {
  let stats: StatsImpl;
  let player1: any;

  beforeEach(async () => {
    stats = new StatsImpl();
    const game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("p1", PlayerType.Human, "client1", "player_1_id"),
    ]);
    player1 = game.player("player_1_id");
  });

  const sample = (tiles: number, troops = 0, alliances = 0) =>
    stats.recordTickSample(player1, tiles, troops, alliances);

  it("keeps the worst drawdown even after a later, higher peak", () => {
    sample(1000);
    sample(100);
    sample(1100);
    const tiles = stats.stats().client1.tiles!;
    expect(tiles[TILE_INDEX_PEAK]).toBe(1100n);
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(1000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(100n);
  });

  it("keeps the proportionally worst decline, not the most recent", () => {
    sample(1000);
    sample(500); // 50% fall
    sample(1000);
    sample(900); // 10% fall, more recent
    const tiles = stats.stats().client1.tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(1000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(500n);
  });

  it("records no depth for a player that only grows", () => {
    sample(10);
    sample(100);
    sample(1000);
    const tiles = stats.stats().client1.tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(
      tiles[TILE_INDEX_DRAWDOWN_TROUGH],
    );
  });

  it("records peak troops and peak concurrent alliances, not final", () => {
    sample(10, 500, 3);
    sample(10, 100, 1);
    expect(stats.stats().client1.peakTroops).toBe(500n);
    expect(
      stats.stats().client1.alliances![ALLIANCE_INDEX_PEAK_CONCURRENT],
    ).toBe(3n);
  });
});
