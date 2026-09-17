import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { StatsImpl } from "../src/core/game/StatsImpl";
import { AllPlayersStats } from "../src/core/Schemas";
import {
  ALLIANCE_INDEX_BROKEN_BY_OTHER,
  ALLIANCE_INDEX_EXPIRED,
  ALLIANCE_INDEX_FORMED,
  ALLIANCE_INDEX_HELD_TO_END,
  ALLIANCE_INDEX_LONGEST_HELD,
  PlayerStats,
} from "../src/core/StatsSchemas";
import { setup } from "./util/Setup";

describe("alliance stats", () => {
  let stats: StatsImpl;
  let player1: any;

  beforeEach(async () => {
    stats = new StatsImpl();
    const game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("p1", PlayerType.Human, "client1", "player_1_id"),
    ]);
    player1 = game.player("player_1_id");
  });

  /** stats.stats() indexes by clientID into a record whose values are
   * themselves optional, so `.client1` alone is `PlayerStats | undefined`. */
  function client1Stats(): NonNullable<PlayerStats> {
    const s = stats.stats().client1;
    expect(s).toBeDefined();
    return s!;
  }

  it("counts alliances formed", () => {
    stats.allianceFormed(player1);
    stats.allianceFormed(player1);
    expect(client1Stats().alliances![ALLIANCE_INDEX_FORMED]).toBe(2n);
  });

  it("counts being betrayed separately from expiry", () => {
    stats.allianceEnded(player1, 100, "brokenByOther");
    stats.allianceEnded(player1, 50, "expired");
    const a = client1Stats().alliances!;
    expect(a[ALLIANCE_INDEX_BROKEN_BY_OTHER]).toBe(1n);
    expect(a[ALLIANCE_INDEX_EXPIRED]).toBe(1n);
  });

  it("tracks the longest alliance across all endings", () => {
    stats.allianceEnded(player1, 100, "expired");
    stats.allianceEnded(player1, 600, "brokenByOther");
    stats.allianceEnded(player1, 20, null);
    expect(client1Stats().alliances![ALLIANCE_INDEX_LONGEST_HELD]).toBe(600n);
  });

  it("updates the longest alliance without bumping any counter", () => {
    stats.allianceEnded(player1, 900, null);
    const a = client1Stats().alliances!;
    expect(a[ALLIANCE_INDEX_LONGEST_HELD]).toBe(900n);
    expect(a[ALLIANCE_INDEX_BROKEN_BY_OTHER]).toBe(0n);
    expect(a[ALLIANCE_INDEX_EXPIRED]).toBe(0n);
  });

  it("records alliances still standing at the end", () => {
    stats.recordAlliancesAtEnd(player1, 2, 1200);
    const a = client1Stats().alliances!;
    expect(a[ALLIANCE_INDEX_HELD_TO_END]).toBe(2n);
    expect(a[ALLIANCE_INDEX_LONGEST_HELD]).toBe(1200n);
  });

  it("treats alliances held to the end as a snapshot, not a running total", () => {
    stats.recordAlliancesAtEnd(player1, 2, 1200);
    stats.recordAlliancesAtEnd(player1, 2, 1200);
    expect(client1Stats().alliances![ALLIANCE_INDEX_HELD_TO_END]).toBe(2n);
  });

  it("lets a still-standing alliance beat an earlier broken one", () => {
    stats.allianceEnded(player1, 300, "brokenByOther");
    stats.recordAlliancesAtEnd(player1, 1, 1500);
    expect(client1Stats().alliances![ALLIANCE_INDEX_LONGEST_HELD]).toBe(1500n);
  });
});

// Wiring: GameImpl's alliance formation, break and expiry call sites actually
// reach Stats, using the real game simulation rather than a mocked Stats.
describe("alliance stats wiring (GameImpl)", () => {
  let game: Game;
  let player1: any;
  let player2: any;

  beforeEach(async () => {
    game = await setup("half_land_half_ocean", {}, [
      new PlayerInfo("p1", PlayerType.Human, "client1", "player_1_id"),
      new PlayerInfo("p2", PlayerType.Human, "client2", "player_2_id"),
    ]);
    player1 = game.player("player_1_id");
    player2 = game.player("player_2_id");
  });

  function formAlliance() {
    // Neither player has spawned any tiles in this setup, so bypass the
    // aliveness/adjacency gate the same way AllianceExtensionExecution.test.ts
    // does -- what's under test here is the stats wiring, not spawning.
    vi.spyOn(player1, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(player2, "canSendAllianceRequest").mockReturnValue(true);
    vi.spyOn(player1, "isAlive").mockReturnValue(true);
    vi.spyOn(player2, "isAlive").mockReturnValue(true);

    game.addExecution(new AllianceRequestExecution(player1, player2.id()));
    game.executeNextTick();
    game.addExecution(new AllianceRequestExecution(player2, player1.id()));
    game.executeNextTick();
    return player1.allianceWith(player2)!;
  }

  /** s indexes by clientID into a record whose values are themselves
   * optional, so `s.client1`/`s.client2` alone is `PlayerStats | undefined`. */
  function playerStats(
    s: AllPlayersStats,
    clientID: string,
  ): NonNullable<PlayerStats> {
    const p = s[clientID];
    expect(p).toBeDefined();
    return p!;
  }

  it("credits both parties when an alliance forms", () => {
    formAlliance();
    const s = game.stats().stats();
    expect(playerStats(s, "client1").alliances![ALLIANCE_INDEX_FORMED]).toBe(
      1n,
    );
    expect(playerStats(s, "client2").alliances![ALLIANCE_INDEX_FORMED]).toBe(
      1n,
    );
  });

  it("credits only the betrayed party on a break, not the breaker", () => {
    const alliance = formAlliance();
    // Let the alliance actually run. Breaking it in the tick it formed makes
    // every duration 0n, and the breaker's longest-held assertion below then
    // reduces to 0n === 0n -- which still passes with the breaker's
    // allianceEnded call deleted.
    for (let i = 0; i < 7; i++) game.executeNextTick();
    const ticksHeld = BigInt(game.ticks() - alliance.createdAt());
    expect(ticksHeld).toBeGreaterThan(0n);

    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    // player2 was betrayed
    expect(
      playerStats(s, "client2").alliances![ALLIANCE_INDEX_BROKEN_BY_OTHER],
    ).toBe(1n);
    // player1 is the breaker: not counted here (betray() already counts it
    // via markTraitor), but their longest-held maximum still updates so both
    // sides see the same alliance's duration.
    expect(
      playerStats(s, "client1").alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ??
        0n,
    ).toBe(0n);
    expect(
      playerStats(s, "client2").alliances![ALLIANCE_INDEX_LONGEST_HELD],
    ).toBe(ticksHeld);
    expect(
      playerStats(s, "client1").alliances![ALLIANCE_INDEX_LONGEST_HELD],
    ).toBe(playerStats(s, "client2").alliances![ALLIANCE_INDEX_LONGEST_HELD]);
  });

  it("credits both sides' longest held when an alliance ends by elimination", () => {
    const alliance = formAlliance();
    for (let i = 0; i < 9; i++) game.executeNextTick();
    const ticksHeld = BigInt(game.ticks() - alliance.createdAt());
    expect(ticksHeld).toBeGreaterThan(0n);

    // What PlayerExecution.removeOnDeath() does when a player is eliminated.
    player2.removeAllAlliances();

    const s = game.stats().stats();
    for (const clientID of ["client1", "client2"]) {
      const a = playerStats(s, clientID).alliances!;
      expect(a[ALLIANCE_INDEX_LONGEST_HELD]).toBe(ticksHeld);
      // Nobody betrayed anyone and nothing timed out.
      expect(a[ALLIANCE_INDEX_BROKEN_BY_OTHER] ?? 0n).toBe(0n);
      expect(a[ALLIANCE_INDEX_EXPIRED] ?? 0n).toBe(0n);
    }
  });

  it("does not leave the survivor's longest held at zero when their ally is eliminated", () => {
    // The whole point of the elimination wiring: the survivor played out a
    // long alliance and the game ends with them, so recordAlliancesAtEnd
    // never sees it -- it was detached at the moment of the elimination.
    const alliance = formAlliance();
    for (let i = 0; i < 12; i++) game.executeNextTick();
    const ticksHeld = BigInt(game.ticks() - alliance.createdAt());

    player2.removeAllAlliances();
    game.setWinner(player1, game.stats().stats());

    const a = playerStats(game.stats().stats(), "client1").alliances!;
    expect(a[ALLIANCE_INDEX_LONGEST_HELD]).toBe(ticksHeld);
    expect(a[ALLIANCE_INDEX_HELD_TO_END]).toBe(0n);
  });

  it("does not count a break against a disconnected player as betrayal", () => {
    const alliance = formAlliance();
    player2.markDisconnected(true);
    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    expect(
      playerStats(s, "client2").alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ??
        0n,
    ).toBe(0n);
  });

  it("does not count a break against an already-traitor player as betrayal", () => {
    const alliance = formAlliance();
    player2.markTraitor();
    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    expect(
      playerStats(s, "client2").alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ??
        0n,
    ).toBe(0n);
  });

  it("credits both parties on expiry", () => {
    const alliance = formAlliance();
    game.expireAlliance(alliance);
    const s = game.stats().stats();
    expect(playerStats(s, "client1").alliances![ALLIANCE_INDEX_EXPIRED]).toBe(
      1n,
    );
    expect(playerStats(s, "client2").alliances![ALLIANCE_INDEX_EXPIRED]).toBe(
      1n,
    );
  });

  it("credits an alliance still standing when the game ends", () => {
    const alliance = formAlliance();
    for (let i = 0; i < 5; i++) game.executeNextTick();
    const ticksHeld = BigInt(game.ticks() - alliance.createdAt());

    game.setWinner(player1, game.stats().stats());

    const s = game.stats().stats();
    // Would be 0n/undefined without GameImpl.setWinner's
    // recordAlliancesAtEnd wiring: nothing else in this test breaks or
    // expires the alliance.
    expect(
      playerStats(s, "client1").alliances![ALLIANCE_INDEX_HELD_TO_END],
    ).toBe(1n);
    expect(
      playerStats(s, "client2").alliances![ALLIANCE_INDEX_HELD_TO_END],
    ).toBe(1n);
    expect(
      playerStats(s, "client1").alliances![ALLIANCE_INDEX_LONGEST_HELD],
    ).toBe(ticksHeld);
    expect(
      playerStats(s, "client2").alliances![ALLIANCE_INDEX_LONGEST_HELD],
    ).toBe(ticksHeld);
  });
});
