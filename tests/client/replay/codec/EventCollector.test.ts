/**
 * The encoder's event lists are handed over with each append and not kept,
 * so the processing worker's memory doesn't grow with the game.
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { EventCollector } from "../../../../src/client/replay/codec/encode/EventCollector";
import type { NormalizedFrame } from "../../../../src/client/replay/codec/FrameNormalizer";

/** A frame with a nuke landing on `impact` and a unit that died. */
function frame(tick: number, impact: number, deadUnit: number) {
  const updates: Record<number, unknown[]> = {};
  for (const type of Object.values(GameUpdateType)) {
    if (typeof type === "number") updates[type] = [];
  }
  updates[GameUpdateType.Unit] = [
    {
      id: deadUnit,
      unitType: UnitType.AtomBomb,
      ownerID: 1,
      pos: impact,
      isActive: false,
      reachedTarget: true,
    },
  ];
  if (tick === 1) {
    updates[GameUpdateType.SpawnPhaseEnd] = [{ startTick: 0 }];
  }
  return {
    tick,
    source: { tick, updates, packedNukeImpacts: new Uint32Array([impact]) },
    motionPlans: [],
    units: [],
  } as unknown as NormalizedFrame;
}

test("events are handed over once, then forgotten", () => {
  const events = new EventCollector();
  const isLand = () => true;
  events.push(frame(1, 100, 7), isLand);
  events.push(frame(2, 200, 8), isLand);

  const first = events.take();
  expect(first.nukeImpacts.map((e) => e.tick)).toEqual([1, 2]);
  expect(first.deadUnitEvents.map((e) => e.unitId)).toEqual([7, 8]);
  expect(first.spawnPhaseEnd).toEqual({ tick: 1, startTick: 0 });

  // Nothing kept: the next take has only what came after.
  const empty = events.take();
  expect(empty.nukeImpacts).toEqual([]);
  expect(empty.deadUnitEvents).toEqual([]);
  events.push(frame(3, 300, 9), isLand);
  const next = events.take();
  expect(next.nukeImpacts.map((e) => e.tick)).toEqual([3]);
  expect(next.deadUnitEvents.map((e) => e.unitId)).toEqual([9]);
  // Not a list: it's sent with every append.
  expect(next.spawnPhaseEnd).toEqual({ tick: 1, startTick: 0 });
  // What was handed over isn't touched afterwards.
  expect(first.nukeImpacts).toHaveLength(2);
});
