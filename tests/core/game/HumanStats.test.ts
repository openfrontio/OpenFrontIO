import { describe, expect, it } from "vitest";
import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { MarkDisconnectedExecution } from "../../../src/core/execution/MarkDisconnectedExecution";
import { SpawnExecution } from "../../../src/core/execution/SpawnExecution";
import { Game, PlayerInfo, PlayerType } from "../../../src/core/game/Game";
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

  // The snapshot is asked for mid-game, between ticks. It must not change
  // the simulation: a game snapshotted every tick ends in exactly the state
  // of one that never was.
  it("leaves the game exactly as it would have been", async () => {
    async function play(snapshotEveryTick: boolean) {
      const g: Game = await setup("ocean_and_land", { infiniteTroops: true }, [
        new PlayerInfo("alice", PlayerType.Human, "client_a", "player_a"),
        new PlayerInfo("bob", PlayerType.Human, "client_b", "player_b"),
      ]);
      g.addExecution(
        new SpawnExecution(
          "game_id",
          g.player("player_a").info(),
          g.ref(0, 14),
        ),
        new SpawnExecution(
          "game_id",
          g.player("player_b").info(),
          g.ref(0, 15),
        ),
      );
      const trace: string[] = [];
      for (let tick = 0; tick < 300; tick++) {
        if (tick === 60) {
          g.addExecution(
            new AttackExecution(1000, g.player("player_a"), "player_b"),
          );
        }
        g.executeNextTick();
        if (snapshotEveryTick) humanStatsSnapshot(g);
        trace.push(
          g
            .allPlayers()
            .map(
              (p) =>
                `${p.id()}:${p.numTilesOwned()}:${p.troops()}:${p.isAlive()}`,
            )
            .join("|"),
        );
      }
      return {
        trace,
        stats: JSON.stringify(g.stats().stats(), (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      };
    }

    const plain = await play(false);
    const snapshotted = await play(true);
    expect(snapshotted.trace).toEqual(plain.trace);
    expect(snapshotted.stats).toEqual(plain.stats);
    // The run did something worth comparing.
    expect(plain.trace[0]).not.toEqual(plain.trace[plain.trace.length - 1]);
  });
});
