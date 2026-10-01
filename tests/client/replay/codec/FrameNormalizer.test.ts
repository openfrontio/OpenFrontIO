/**
 * FrameNormalizer against hand-built wire frames: partial PlayerUpdate diffs,
 * the packed stat / attack channels, embargo translation, intermittent name
 * placements, and routing of misc updates.
 */

import { FrameNormalizer } from "../../../../src/client/replay/codec/FrameNormalizer";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";
import {
  frame,
  fullPlayer,
  partialPlayer,
  unit,
} from "../util/SyntheticFrames";

const P = GameUpdateType.Player;
const U = GameUpdateType.Unit;

describe("FrameNormalizer", () => {
  test("partial diffs merge into full state; untouched players keep identity", () => {
    const n = new FrameNormalizer();
    const f1 = n.push(
      frame(1, { updates: { [P]: [fullPlayer(1), fullPlayer(2)] } }),
    );
    expect(f1.newPlayers.map((p) => p.smallID)).toEqual([1, 2]);
    const p1Before = f1.players.get(1)!;
    const p2 = f1.players.get(2);

    const f2 = n.push(
      frame(2, {
        updates: {
          [P]: [
            partialPlayer(1, {
              inDoomsdayClock: true,
              isDecaying: true,
              markedDoomsdayClockTick: 2,
              killedBy: "client2",
            }),
          ],
        },
      }),
    );
    const p1 = f2.players.get(1)!;
    expect(p1).toMatchObject({
      inDoomsdayClock: true,
      isDecaying: true,
      markedDoomsdayClockTick: 2,
      killedBy: "client2",
      // Fields absent from the diff keep their previous values.
      tilesOwned: 10,
      troops: 1000,
      isAlive: true,
    });
    expect(f2.newPlayers).toEqual([]);
    expect(f2.players.get(2)).toBe(p2);
    // Snapshots are frozen: the tick-1 object didn't change underneath.
    expect(p1Before.inDoomsdayClock).toBe(false);
  });

  test("packedPlayerUpdates carry stats after the first emission", () => {
    const n = new FrameNormalizer();
    n.push(frame(1, { updates: { [P]: [fullPlayer(1)] } }));
    const before = n.push(frame(2)).players.get(1)!;
    const f = n.push(
      frame(3, {
        packedPlayerUpdates: Float64Array.from([1, 55, 1234.5, 999, 5000]),
      }),
    );
    expect(f.players.get(1)).toMatchObject({
      tilesOwned: 55,
      gold: 1234.5,
      troops: 999,
      goldEarned: 5000,
    });
    expect(before.tilesOwned).toBe(10);
  });

  test("packedAttackUpdates patch troops without mutating earlier snapshots", () => {
    const n = new FrameNormalizer();
    const attack = {
      attackerID: 1,
      targetID: 2,
      troops: 500,
      id: "a",
      retreating: false,
    };
    const f1 = n.push(
      frame(1, {
        updates: {
          [P]: [fullPlayer(1, { outgoingAttacks: [attack] }), fullPlayer(2)],
        },
      }),
    );
    const snap1 = f1.players.get(1)!;
    const f2 = n.push(
      frame(2, { packedAttackUpdates: Float64Array.from([1, 0, 0, 420]) }),
    );
    expect(f2.players.get(1)!.outgoingAttacks[0].troops).toBe(420);
    expect(snap1.outgoingAttacks[0].troops).toBe(500);
  });

  test("embargoes translate PlayerIDs to smallIDs, including same-tick newcomers", () => {
    const n = new FrameNormalizer();
    const f = n.push(
      frame(1, {
        updates: {
          [P]: [
            fullPlayer(1, { embargoes: new Set(["p2", "unknown"]) }),
            fullPlayer(2),
          ],
        },
      }),
    );
    expect(f.players.get(1)!.embargoes).toEqual([2]);
  });

  test("name placements persist across ticks that omit them", () => {
    const n = new FrameNormalizer();
    const f1 = n.push(
      frame(1, {
        updates: { [P]: [fullPlayer(1)] },
        playerNameViewData: { p1: { x: 10.4, y: 20.6, size: 7.5 } },
      }),
    );
    expect(f1.namesChanged).toBe(true);
    const f2 = n.push(frame(2));
    expect(f2.namesChanged).toBe(false);
    expect(f2.names.get("p1")).toEqual({
      playerID: "p1",
      x: 10,
      y: 21,
      size: 8,
    });
    const f3 = n.push(
      frame(3, { playerNameViewData: { p1: { x: 10.2, y: 21.1, size: 8.1 } } }),
    );
    expect(f3.namesChanged).toBe(false); // same after rounding
  });

  test("multiple updates for one unit in a tick collapse to the last", () => {
    const n = new FrameNormalizer();
    const f = n.push(
      frame(1, {
        updates: {
          [U]: [unit(5, { level: 1 }), unit(6), unit(5, { level: 2 })],
        },
      }),
    );
    expect(f.units.map((u) => [u.id, u.level])).toEqual([
      [5, 2],
      [6, 1],
    ]);
  });

  test("grid motion plans own the position of the units they drive", () => {
    const n = new FrameNormalizer();
    // GridPathSet record: kind, wordCount, unitId, planId, startTick,
    // ticksPerStep, pathLen, path...
    const plan = Uint32Array.from([
      1,
      1,
      2 + 5 + 3,
      9,
      1,
      1,
      2,
      3,
      100,
      101,
      102,
    ]);
    const f1 = n.push(
      frame(1, {
        packedMotionPlans: plan,
        updates: { [U]: [unit(9, { pos: 100 })] },
      }),
    );
    expect(f1.units.find((u) => u.id === 9)!.pos).toBe(100);
    // Tick 3: one step along the plan, with no unit update on the wire.
    n.push(frame(2));
    const f3 = n.push(frame(3));
    expect(f3.units.find((u) => u.id === 9)).toMatchObject({
      pos: 101,
      lastPos: 100,
    });
    // A wire update's (stale) position is ignored while the plan runs.
    const f5 = n.push(
      frame(5, { updates: { [U]: [unit(9, { pos: 100, troops: 7 })] } }),
    );
    expect(f5.units.find((u) => u.id === 9)).toMatchObject({
      pos: 102,
      troops: 7,
    });
  });

  test("misc updates are keyed by GameUpdateType name; hashes and routed types are excluded", () => {
    const n = new FrameNormalizer();
    const f = n.push(
      frame(1, {
        updates: {
          [GameUpdateType.SpawnPhaseEnd]: [
            { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
          ],
          [GameUpdateType.GamePaused]: [
            { type: GameUpdateType.GamePaused, paused: true },
          ],
          [GameUpdateType.Hash]: [
            { type: GameUpdateType.Hash, tick: 1, hash: 1 },
          ],
          [GameUpdateType.RailroadDestructionEvent]: [
            { type: GameUpdateType.RailroadDestructionEvent, id: 1 },
          ],
        },
      }),
    );
    expect(Object.keys(f.misc!)).toEqual(["GamePaused"]);
    // The numeric type is stripped from payloads; the key carries the name.
    expect(f.misc!.GamePaused).toEqual([{ paused: true }]);
    expect(n.push(frame(2)).misc).toBeNull();
  });
});
