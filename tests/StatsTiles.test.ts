import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  ALLIANCE_INDEX_PEAK_CONCURRENT,
  PlayerStats,
  TILE_INDEX_DRAWDOWN_PEAK,
  TILE_INDEX_DRAWDOWN_TROUGH,
  TILE_INDEX_PEAK,
} from "@openfront/engine-api/StatsSchemas";
import { Game, Player } from "@openfront/engine/game/Game";
import { StatsImpl } from "@openfront/engine/game/StatsImpl";
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

  it("handles restoreSnapshot correctly by continuing to track peaks and drawdowns", () => {
    sample(100, 200, 1);
    sample(50, 150, 1);

    const snapshot = structuredClone(stats.snapshot());
    const restoredStats = new StatsImpl();
    restoredStats.restoreSnapshot(snapshot);

    // Continue sampling on restored instance
    restoredStats.recordTickSample(player1, 200, 500, 3);
    restoredStats.recordTickSample(player1, 10, 300, 2);

    const s = restoredStats.stats().client1!;
    expect(s.tiles![TILE_INDEX_PEAK]).toBe(200n);
    // Decline from 200 to 10 (95% drop) beats 100 to 50 (50% drop)
    expect(s.tiles![TILE_INDEX_DRAWDOWN_PEAK]).toBe(200n);
    expect(s.tiles![TILE_INDEX_DRAWDOWN_TROUGH]).toBe(10n);
    expect(s.peakTroops).toBe(500n);
    expect(s.alliances![ALLIANCE_INDEX_PEAK_CONCURRENT]).toBe(3n);
  });

  it("matches the original reference all-bigint sampler across randomized mixed inputs", () => {
    class ReferenceStats {
      data: Record<string, PlayerStats> = {};

      recordTickSample(
        player: Player,
        tiles: bigint | number,
        troops: bigint | number,
        allianceCount: number,
      ): void {
        const clientID = player.clientID();
        if (clientID === null) return;
        let p = this.data[clientID];
        if (p === undefined) {
          p = {};
          this.data[clientID] = p;
        }

        const t = typeof tiles === "bigint" ? tiles : BigInt(Math.floor(tiles));
        p.tiles ??= [0n, 0n, 0n];
        while (p.tiles.length <= TILE_INDEX_DRAWDOWN_TROUGH) p.tiles.push(0n);
        if (t > p.tiles[TILE_INDEX_PEAK]) p.tiles[TILE_INDEX_PEAK] = t;
        const peak = p.tiles[TILE_INDEX_PEAK];
        const ddPeak = p.tiles[TILE_INDEX_DRAWDOWN_PEAK];
        const ddTrough = p.tiles[TILE_INDEX_DRAWDOWN_TROUGH];
        if (ddPeak === 0n || (peak - t) * ddPeak > (ddPeak - ddTrough) * peak) {
          p.tiles[TILE_INDEX_DRAWDOWN_PEAK] = peak;
          p.tiles[TILE_INDEX_DRAWDOWN_TROUGH] = t;
        }

        const tr =
          typeof troops === "bigint" ? troops : BigInt(Math.floor(troops));
        if (p.peakTroops === undefined || tr > p.peakTroops) p.peakTroops = tr;

        p.alliances ??= [0n, 0n];
        while (p.alliances.length <= ALLIANCE_INDEX_PEAK_CONCURRENT) {
          p.alliances.push(0n);
        }
        const a = BigInt(Math.floor(allianceCount));
        if (a > p.alliances[ALLIANCE_INDEX_PEAK_CONCURRENT]) {
          p.alliances[ALLIANCE_INDEX_PEAK_CONCURRENT] = a;
        }
      }
    }

    // Deterministic Mulberry32 PRNG
    let s = 1337;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const players = [
      { clientID: () => "p1" } as Player,
      { clientID: () => "p2" } as Player,
      { clientID: () => "p3" } as Player,
    ];

    let actualStats = new StatsImpl();
    let refStats = new ReferenceStats();

    // Value generator mixing:
    // - zero leads (0)
    // - repeated peaks
    // - normal integers (< 90_000_000)
    // - normal BigInts
    // - fractional numbers
    // - large values (>= 90_000_000 number & BigInt)
    const samplePool = (fixedPeak: number) => {
      const roll = rand();
      if (roll < 0.05) return 0;
      if (roll < 0.15) return fixedPeak;
      if (roll < 0.45) return Math.floor(rand() * 50_000);
      if (roll < 0.6) return BigInt(Math.floor(rand() * 50_000));
      if (roll < 0.75) return Math.floor(rand() * 50_000) + rand();
      if (roll < 0.88) return 90_000_000 + Math.floor(rand() * 10_000_000);
      return BigInt(90_000_000 + Math.floor(rand() * 50_000_000));
    };

    const TOTAL_TICKS = 600;
    const SNAPSHOT_TICK = 300;
    const playerPeaks = [12_345, 45_678, 89_000];

    for (let tick = 0; tick < TOTAL_TICKS; tick++) {
      if (tick === SNAPSHOT_TICK) {
        // structuredClone snapshot round trip partway through
        const snapshot = structuredClone(actualStats.snapshot());
        actualStats = new StatsImpl();
        actualStats.restoreSnapshot(snapshot);
        refStats.data = structuredClone(refStats.data);
      }

      for (let i = 0; i < players.length; i++) {
        const player = players[i];
        // Ensure first few ticks for player 0 are 0 (zero-tile lead)
        const tiles = tick < 5 && i === 0 ? 0 : samplePool(playerPeaks[i]);
        const troops = samplePool(50_000);
        const alliances = Math.floor(rand() * 8);

        actualStats.recordTickSample(player, tiles, troops, alliances);
        refStats.recordTickSample(player, tiles, troops, alliances);
      }
    }

    for (const player of players) {
      const client = player.clientID()!;
      const actual = actualStats.stats()[client]!;
      const expected = refStats.data[client]!;

      expect(actual.tiles).toEqual(expected.tiles);
      expect(actual.peakTroops).toEqual(expected.peakTroops);
      expect(actual.alliances).toEqual(expected.alliances);
    }
  });

  it("handles BigInt and large inputs via the fallback path", () => {
    stats.recordTickSample(player1, 100_000_000n, 500_000_000n, 2);
    stats.recordTickSample(player1, 20_000_000n, 100_000_000n, 1);

    const s = client1Stats();
    expect(s.tiles![TILE_INDEX_PEAK]).toBe(100_000_000n);
    expect(s.tiles![TILE_INDEX_DRAWDOWN_PEAK]).toBe(100_000_000n);
    expect(s.tiles![TILE_INDEX_DRAWDOWN_TROUGH]).toBe(20_000_000n);
    expect(s.peakTroops).toBe(500_000_000n);
  });

  it("handles fractional samples via fallback path without throwing", () => {
    stats.recordTickSample(player1, 10.8, 20.4, 1);
    const s = client1Stats();
    expect(s.tiles![TILE_INDEX_PEAK]).toBe(10n);
    expect(s.tiles![TILE_INDEX_DRAWDOWN_PEAK]).toBe(10n);
    expect(s.tiles![TILE_INDEX_DRAWDOWN_TROUGH]).toBe(10n);
    expect(s.peakTroops).toBe(20n);
  });

  it("safely ignores players with null clientID without allocating or throwing", () => {
    const fakeBot = { clientID: () => null } as any;
    stats.recordTickSample(fakeBot, 500, 1000, 0);
    expect(Object.keys(stats.stats()).length).toBe(0);
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
