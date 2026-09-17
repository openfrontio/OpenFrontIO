import { AllianceRequestExecution } from "../src/core/execution/alliance/AllianceRequestExecution";
import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { StatsImpl } from "../src/core/game/StatsImpl";
import {
  ALLIANCE_INDEX_BROKEN_BY_OTHER,
  ALLIANCE_INDEX_EXPIRED,
  ALLIANCE_INDEX_FORMED,
  ALLIANCE_INDEX_LONGEST_HELD,
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

  it("counts alliances formed", () => {
    stats.allianceFormed(player1);
    stats.allianceFormed(player1);
    expect(stats.stats().client1.alliances![ALLIANCE_INDEX_FORMED]).toBe(2n);
  });

  it("counts being betrayed separately from expiry", () => {
    stats.allianceEnded(player1, 100, "brokenByOther");
    stats.allianceEnded(player1, 50, "expired");
    const a = stats.stats().client1.alliances!;
    expect(a[ALLIANCE_INDEX_BROKEN_BY_OTHER]).toBe(1n);
    expect(a[ALLIANCE_INDEX_EXPIRED]).toBe(1n);
  });

  it("tracks the longest alliance across all endings", () => {
    stats.allianceEnded(player1, 100, "expired");
    stats.allianceEnded(player1, 600, "brokenByOther");
    stats.allianceEnded(player1, 20, null);
    expect(stats.stats().client1.alliances![ALLIANCE_INDEX_LONGEST_HELD]).toBe(
      600n,
    );
  });

  it("updates the longest alliance without bumping any counter", () => {
    stats.allianceEnded(player1, 900, null);
    const a = stats.stats().client1.alliances!;
    expect(a[ALLIANCE_INDEX_LONGEST_HELD]).toBe(900n);
    expect(a[ALLIANCE_INDEX_BROKEN_BY_OTHER]).toBe(0n);
    expect(a[ALLIANCE_INDEX_EXPIRED]).toBe(0n);
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

  it("credits both parties when an alliance forms", () => {
    formAlliance();
    const s = game.stats().stats();
    expect(s.client1.alliances![ALLIANCE_INDEX_FORMED]).toBe(1n);
    expect(s.client2.alliances![ALLIANCE_INDEX_FORMED]).toBe(1n);
  });

  it("credits only the betrayed party on a break, not the breaker", () => {
    const alliance = formAlliance();
    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    // player2 was betrayed
    expect(s.client2.alliances![ALLIANCE_INDEX_BROKEN_BY_OTHER]).toBe(1n);
    // player1 is the breaker: not counted here (betray() already counts it
    // via markTraitor), but their longest-held maximum still updates so both
    // sides see the same alliance's duration.
    expect(s.client1.alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ?? 0n).toBe(
      0n,
    );
    expect(s.client1.alliances![ALLIANCE_INDEX_LONGEST_HELD]).toBe(
      s.client2.alliances![ALLIANCE_INDEX_LONGEST_HELD],
    );
  });

  it("does not count a break against a disconnected player as betrayal", () => {
    const alliance = formAlliance();
    player2.markDisconnected(true);
    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    expect(s.client2.alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ?? 0n).toBe(
      0n,
    );
  });

  it("does not count a break against an already-traitor player as betrayal", () => {
    const alliance = formAlliance();
    player2.markTraitor();
    player1.breakAlliance(alliance);
    const s = game.stats().stats();
    expect(s.client2.alliances?.[ALLIANCE_INDEX_BROKEN_BY_OTHER] ?? 0n).toBe(
      0n,
    );
  });

  it("credits both parties on expiry", () => {
    const alliance = formAlliance();
    game.expireAlliance(alliance);
    const s = game.stats().stats();
    expect(s.client1.alliances![ALLIANCE_INDEX_EXPIRED]).toBe(1n);
    expect(s.client2.alliances![ALLIANCE_INDEX_EXPIRED]).toBe(1n);
  });
});
