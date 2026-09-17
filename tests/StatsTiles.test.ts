import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { StatsImpl } from "../src/core/game/StatsImpl";
import {
  ALLIANCE_INDEX_PEAK_CONCURRENT,
  PlayerStats,
  TILE_INDEX_DRAWDOWN_PEAK,
  TILE_INDEX_DRAWDOWN_TROUGH,
  TILE_INDEX_PEAK,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

/** Find the first land tile on the map. */
function findLandTile(game: Game): number {
  for (let x = 0; x < game.width(); x++) {
    for (let y = 0; y < game.height(); y++) {
      const t = game.ref(x, y);
      if (game.isLand(t) && !game.isImpassable(t)) return t;
    }
  }
  throw new Error("no land tile found");
}

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

  /** stats.stats() indexes by clientID into a record whose values are
   * themselves optional, so `.client1` alone is `PlayerStats | undefined`. */
  function client1Stats(): NonNullable<PlayerStats> {
    const s = stats.stats().client1;
    expect(s).toBeDefined();
    return s!;
  }

  it("keeps the worst drawdown even after a later, higher peak", () => {
    sample(1000);
    sample(100);
    sample(1100);
    const tiles = client1Stats().tiles!;
    expect(tiles[TILE_INDEX_PEAK]).toBe(1100n);
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(1000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(100n);
  });

  it("keeps the proportionally worst decline, not the most recent", () => {
    sample(1000);
    sample(500); // 50% fall
    sample(1000);
    sample(900); // 10% fall, more recent
    const tiles = client1Stats().tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(1000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(500n);
  });

  it("records no depth for a player that only grows", () => {
    sample(10);
    sample(100);
    sample(1000);
    const tiles = client1Stats().tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(
      tiles[TILE_INDEX_DRAWDOWN_TROUGH],
    );
  });

  it("records peak troops and peak concurrent alliances, not final", () => {
    sample(10, 500, 3);
    sample(10, 100, 1);
    expect(client1Stats().peakTroops).toBe(500n);
    expect(client1Stats().alliances![ALLIANCE_INDEX_PEAK_CONCURRENT]).toBe(3n);
  });

  it("still tracks drawdown after a leading zero-tile sample", () => {
    // A leading 0 must not permanently seed the drawdown pair at (0, 0): that
    // would make every later decline compare against a zero-width window and
    // never register, no matter how severe.
    sample(0);
    sample(5000);
    sample(1);
    const tiles = client1Stats().tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(5000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(1n);
  });

  it("replaces a stored non-zero drawdown once a new peak makes a later decline worse", () => {
    sample(100);
    sample(50); // 50% fall from 100
    sample(1000); // new peak; no decline yet at the peak itself
    sample(100); // 90% fall from 1000, worse than the stored 50% fall
    const tiles = client1Stats().tiles!;
    expect(tiles[TILE_INDEX_DRAWDOWN_PEAK]).toBe(1000n);
    expect(tiles[TILE_INDEX_DRAWDOWN_TROUGH]).toBe(100n);
  });
});

describe("tick loop wiring", () => {
  it("samples a live spawned player each tick, in the right argument order, and the alive+spawned guard suppresses an unspawned or dead player", async () => {
    const game = await setup("half_land_half_ocean", { infiniteTroops: true }, [
      new PlayerInfo("p1", PlayerType.Human, "client1", "player_1_id"),
      new PlayerInfo("p2", PlayerType.Human, "client2", "player_2_id"),
    ]);
    const player1 = game.player("player_1_id");
    const player2 = game.player("player_2_id");

    // Unspawned: a tick must not record anything for either player.
    game.executeNextTick();
    expect(game.stats().stats().client1?.tiles).toBeUndefined();

    const spawnTile = findLandTile(game);
    player1.conquer(spawnTile);
    player1.setSpawnTile(spawnTile);
    expect(player1.hasSpawned()).toBe(true);
    expect(player1.isAlive()).toBe(true);

    game.executeNextTick();
    const stats1 = game.stats().stats().client1!;
    // Argument order: tiles, troops, allianceCount land on the matching
    // fields rather than being silently transposed.
    expect(stats1.tiles![TILE_INDEX_PEAK]).toBe(
      BigInt(player1.numTilesOwned()),
    );
    expect(stats1.peakTroops).toBe(BigInt(player1.troops()));
    expect(stats1.alliances![ALLIANCE_INDEX_PEAK_CONCURRENT]).toBe(0n);

    const ddPeakWhileAlive = stats1.tiles![TILE_INDEX_DRAWDOWN_PEAK];
    const ddTroughWhileAlive = stats1.tiles![TILE_INDEX_DRAWDOWN_TROUGH];

    // Eliminate player1: player2 takes every tile player1 owns.
    for (const t of Array.from(player1.tiles())) {
      player2.conquer(t);
    }
    expect(player1.isAlive()).toBe(false);

    game.executeNextTick();
    const stats1After = game.stats().stats().client1!;
    // Dead: the guard must stop sampling, so the drawdown recorded while
    // alive is untouched rather than collapsing to a spurious ~100% decline
    // from the elimination itself.
    expect(stats1After.tiles![TILE_INDEX_DRAWDOWN_PEAK]).toBe(ddPeakWhileAlive);
    expect(stats1After.tiles![TILE_INDEX_DRAWDOWN_TROUGH]).toBe(
      ddTroughWhileAlive,
    );
  });
});
