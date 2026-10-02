import { describe, expect, it } from "vitest";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import { PlayerInfo, PlayerType } from "../../../src/core/game/Game";
import { humanStatsSnapshot } from "../../../src/core/game/HumanStats";
import { setup } from "../../util/Setup";
import { executeTicks } from "../../util/utils";

describe("humanStatsSnapshot", () => {
  async function game() {
    const game = await setup("plains", {}, [
      new PlayerInfo("alice", PlayerType.Human, "client_a", "player_a"),
      new PlayerInfo("bob", PlayerType.Human, "client_b", "player_b"),
      new PlayerInfo("carol", PlayerType.Human, "client_c", "player_c"),
    ]);
    executeTicks(game, 3);
    return game;
  }

  it("carries every human's stats, keyed by client, as the record does", async () => {
    const g = await game();
    const alice = g.player("player_a");
    const bob = g.player("player_b");
    g.stats().attack(alice, bob, 100);
    g.stats().playerKilled(bob, 40);

    const snapshot = humanStatsSnapshot(g);

    expect(snapshot.tick).toBe(g.ticks());
    expect(snapshot.stats).toEqual(g.stats().stats());
    expect(snapshot.stats["client_a"]?.attacks?.[0]).toBe(100n);
    expect(snapshot.stats["client_b"]?.killedAt).toBe(40n);
  });

  it("is a copy that later ticks don't change", async () => {
    const g = await game();
    const alice = g.player("player_a");
    const bob = g.player("player_b");
    g.stats().attack(alice, bob, 100);

    const snapshot = humanStatsSnapshot(g);
    g.stats().attack(alice, bob, 50);
    g.stats().playerKilled(alice, 99);

    expect(snapshot.stats["client_a"]?.attacks?.[0]).toBe(100n);
    expect(snapshot.stats["client_a"]?.killedAt).toBeUndefined();
  });

  it("names the humans whose connection is lost, with the tick it was", async () => {
    const g = await game();
    new MarkDisconnectedExecution(g.player("player_b"), true).init(g, 120);
    new MarkDisconnectedExecution(g.player("player_c"), true).init(g, 130);
    // Carol came back.
    new MarkDisconnectedExecution(g.player("player_c"), false).init(g, 140);

    expect(humanStatsSnapshot(g).disconnectedAt).toEqual({ client_b: 120 });
  });

  it("leaves out players without a client", async () => {
    const g = await setup("plains", {}, [
      new PlayerInfo("alice", PlayerType.Human, "client_a", "player_a"),
      new PlayerInfo("nation", PlayerType.Nation, null, "nation_1"),
    ]);
    new MarkDisconnectedExecution(g.player("nation_1"), true).init(g, 5);

    expect(humanStatsSnapshot(g).disconnectedAt).toEqual({});
  });
});
