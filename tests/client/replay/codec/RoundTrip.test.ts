/**
 * End-to-end parity: simulate real games, encode every tick, decode the
 * file, and check the reconstructed state against ground truth captured
 * from the live Game objects at the same tick - per tick, not just at the
 * end. A per-tick check is what catches stat channels that stop updating
 * after a player's first emission (stats travel on packedPlayerUpdates, not
 * on each PlayerUpdate); an end-state check would not.
 */

import { AllianceRequestExecution } from "../../../../src/core/execution/alliance/AllianceRequestExecution";
import { BreakAllianceExecution } from "../../../../src/core/execution/alliance/BreakAllianceExecution";
import { AttackExecution } from "../../../../src/core/execution/AttackExecution";
import { ConstructionExecution } from "../../../../src/core/execution/ConstructionExecution";
import { NukeExecution } from "../../../../src/core/execution/NukeExecution";
import { SpawnExecution } from "../../../../src/core/execution/SpawnExecution";
import { TransportShipExecution } from "../../../../src/core/execution/TransportShipExecution";
import {
  Game,
  GameMode,
  GameType,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../../src/core/game/Game";
import { unpackMotionPlans } from "../../../../src/core/game/MotionPlans";
import { setup } from "../../../util/Setup";
import { expectFrameMatchesTruth, expectReplayMatches } from "../util/Expect";
import { openReader, recordGame } from "../util/RecordGame";

function spawnHuman(game: Game, id: string, x: number, y: number): PlayerInfo {
  const info = new PlayerInfo(id, PlayerType.Human, `${id}_client`, id);
  game.addPlayer(info);
  game.addExecution(new SpawnExecution("game_id", info, game.ref(x, y)));
  return info;
}

describe("replay round trip", () => {
  test("bot free-for-all: per-tick tiles, stats and eliminations", async () => {
    const game = await setup(
      "big_plains",
      { bots: 40, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    const rec = await recordGame(game, {
      ticks: 400,
      keyframeInterval: 25,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });

    // Sanity: the fixture actually exercised the packed stat channel after
    // first emission (otherwise the per-tick check proves nothing).
    const packedTicks = rec.frames.filter(
      (f) => f.tick > 20 && f.packedPlayerUpdates !== undefined,
    ).length;
    expect(packedTicks).toBeGreaterThan(100);

    const reader = expectReplayMatches(rec);
    expect(reader.header.players.length).toBeGreaterThan(10);
  }, 60_000);

  test("team game: team assignment reaches the player dictionary", async () => {
    const humans = ["alice", "bob", "carol", "dave"].map(
      (id) => new PlayerInfo(id, PlayerType.Human, `${id}_client`, id),
    );
    const game = await setup(
      "big_plains",
      {
        gameMode: GameMode.Team,
        playerTeams: 2,
        bots: 10,
        gameType: GameType.Singleplayer,
      },
      humans,
      undefined,
      undefined,
      false,
    );
    const spawns: [number, number][] = [
      [20, 20],
      [180, 20],
      [20, 180],
      [180, 180],
    ];
    const rec = await recordGame(game, {
      ticks: 200,
      keyframeInterval: 50,
      beforeTick: (g, t) => {
        if (t === 0) {
          humans.forEach((h, i) =>
            g.addExecution(
              new SpawnExecution(
                "game_id",
                h,
                g.ref(spawns[i][0], spawns[i][1]),
              ),
            ),
          );
        }
        if (t === 5) g.endSpawnPhase();
      },
    });
    const reader = expectReplayMatches(rec);
    const teams = new Map(
      reader.header.players.map((p) => [p.id, p.team] as const),
    );
    for (const h of humans) {
      expect(teams.get(h.id)).toBe(game.player(h.id).team());
    }
    expect(new Set(humans.map((h) => teams.get(h.id))).size).toBe(2);
  }, 60_000);

  test("seek lands on the same state as sequential decoding", async () => {
    const game = await setup(
      "big_plains",
      { bots: 20, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    const rec = await recordGame(game, {
      ticks: 120,
      keyframeInterval: 16,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });
    const reader = openReader(rec.replay);
    // Backwards, across chunks, forward within a chunk, and in place.
    for (const i of [119, 0, 15, 16, 17, 20, 31, 64, 3, 5, 12, 100, 100]) {
      expectFrameMatchesTruth(reader.seek(i), rec, i);
    }
  }, 60_000);

  describe("scripted war", () => {
    let game: Game;
    let alice: Player;
    let bob: Player;

    beforeEach(async () => {
      game = await setup(
        "big_plains",
        { infiniteGold: true, instantBuild: true },
        [],
        undefined,
        undefined,
        false,
      );
      spawnHuman(game, "alice", 20, 20);
      spawnHuman(game, "bob", 150, 150);
    });

    test("alliance, betrayal, attacks and a nuke detonation", async () => {
      const rec = await recordGame(game, {
        ticks: 260,
        skipInit: true,
        beforeTick: (g, t) => {
          if (t === 3) {
            g.endSpawnPhase();
            alice = g.player("alice");
            bob = g.player("bob");
          }
          if (t === 5) {
            g.addExecution(
              new AttackExecution(null, alice, g.terraNullius().id()),
            );
            g.addExecution(
              new AttackExecution(null, bob, g.terraNullius().id()),
            );
          }
          if (t === 10)
            g.addExecution(new AllianceRequestExecution(alice, bob.id()));
          if (t === 11)
            g.addExecution(new AllianceRequestExecution(bob, alice.id()));
          if (t === 40)
            g.addExecution(new BreakAllianceExecution(alice, bob.id()));
          // Mutations must happen inside a tick (via executions) to reach the
          // update stream - exactly as in a real game.
          if (t === 60) {
            g.addExecution(
              new ConstructionExecution(
                alice,
                UnitType.MissileSilo,
                g.ref(20, 20),
              ),
            );
          }
          if (t === 64) {
            g.addExecution(
              new NukeExecution(
                UnitType.AtomBomb,
                alice,
                g.ref(150, 150),
                null,
              ),
            );
          }
          if (t === 120)
            g.addExecution(new AttackExecution(null, alice, bob.id()));
        },
      });

      expectReplayMatches(rec);
      const reader = openReader(rec.replay);
      const h = reader.header;

      // Betrayal reached the stream: alice is a traitor at some tick.
      expect(
        rec.truth.some((t) => t.players.get(alice.smallID())!.isTraitor),
      ).toBe(true);
      // Nuke detonation: impacted tiles and a dead AtomBomb that reached target.
      expect(h.nukeImpacts.length).toBeGreaterThan(0);
      expect(
        h.nukeImpacts.every((e) => e.land.length + e.water.length > 0),
      ).toBe(true);
      expect(
        h.deadUnitEvents.some(
          (e) =>
            e.unitType === UnitType.AtomBomb &&
            e.reachedTarget &&
            e.ownerSmallID === alice.smallID(),
        ),
      ).toBe(true);
      expect(
        h.constructionStarts.length + h.deadUnitEvents.length,
      ).toBeGreaterThan(0);
    }, 60_000);
  });

  test("transport ship: motion plan and retreat state", async () => {
    const game = await setup(
      "ocean_and_land",
      { infiniteGold: true, instantBuild: true },
      [],
      undefined,
      undefined,
      false,
    );
    spawnHuman(game, "alice", 7, 0);
    spawnHuman(game, "bob", 7, 15);
    let alice: Player;
    const rec = await recordGame(game, {
      ticks: 80,
      skipInit: true,
      beforeTick: (g, t) => {
        if (t === 3) {
          g.endSpawnPhase();
          alice = g.player("alice");
        }
        if (t === 5) {
          g.addExecution(new TransportShipExecution(alice, g.ref(7, 15), 100));
        }
      },
    });
    const reader = expectReplayMatches(rec);
    // Each grid plan is stamped with the tick whose update delivered it.
    const planTicks = rec.frames
      .filter((f) => f.packedMotionPlans !== undefined)
      .flatMap((f) =>
        unpackMotionPlans(f.packedMotionPlans!)
          .filter((p) => p.kind === "grid")
          .map((p) => [p.unitId, f.tick]),
      );
    expect(planTicks.length).toBeGreaterThan(0);
    expect(reader.header.motionPlans.map((p) => [p.unitId, p.tick])).toEqual(
      planTicks,
    );
  }, 60_000);
});
