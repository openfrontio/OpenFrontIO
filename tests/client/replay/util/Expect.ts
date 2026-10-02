/** Assertions comparing decoded replay frames with recorded ground truth. */

import type { ReplayReader } from "../../../../src/client/replay/codec/decode/ReplayReader";
import { VIEW_DATA_ROUTING } from "../../../../src/client/replay/codec/FrameNormalizer";
import type { ReplayFrame } from "../../../../src/client/replay/codec/ReplayTypes";
import { openReader, type RecordedGame } from "./RecordGame";

type Recorded = Pick<RecordedGame, "replay" | "truth" | "frames">;

export function expectFrameMatchesTruth(
  frame: ReplayFrame,
  rec: Recorded,
  index: number,
): void {
  const truth = rec.truth[index];
  const at = `frame ${index} (tick ${truth.tick})`;
  expect(frame.tick, at).toBe(truth.tick);

  const tiles = truth.tileState;
  for (let ref = 0; tiles !== null && ref < tiles.length; ref++) {
    if (frame.tileState[ref] !== tiles[ref]) {
      throw new Error(
        `${at}: tile ${ref} is ${frame.tileState[ref]}, expected ${tiles[ref]}`,
      );
    }
  }

  for (const [smallID, t] of truth.players) {
    const p = frame.players.get(smallID);
    if (p === undefined) continue; // never emitted on the wire (e.g. not yet spawned)
    expectSame(
      {
        tilesOwned: p.tilesOwned,
        gold: p.gold,
        troops: p.troops,
        goldEarned: p.goldEarned,
        isAlive: p.isAlive,
        isTraitor: p.isTraitor,
        betrayals: p.betrayals,
        allies: [...p.allies].sort((a, b) => a - b),
      },
      { ...t, allies: [...t.allies].sort((a, b) => a - b) },
      `${at} player ${smallID}`,
    );
  }

  expect(
    [...frame.units.keys()].sort((a, b) => a - b),
    `${at} unit ids`,
  ).toEqual([...truth.units.keys()].sort((a, b) => a - b));
  for (const [id, t] of truth.units) {
    const u = frame.units.get(id)!;
    expectSame(
      {
        unitType: u.unitType,
        ownerID: u.ownerID,
        pos: u.pos,
        troops: u.troops,
        level: u.level,
      },
      t,
      `${at} unit ${id}`,
    );
  }
}

/**
 * toEqual for flat records (numbers, booleans, strings, number arrays),
 * only going through vitest on a mismatch. These run for every player and
 * unit on every frame, and expect() itself was most of a long test's time.
 */
function expectSame<T extends object>(actual: T, expected: T, at: string) {
  const keys = Object.keys(expected) as (keyof T)[];
  const same =
    keys.length === Object.keys(actual).length &&
    keys.every((k) => {
      const a = actual[k];
      const e = expected[k];
      if (!Array.isArray(a) || !Array.isArray(e)) return Object.is(a, e);
      return a.length === e.length && a.every((v, i) => Object.is(v, e[i]));
    });
  if (!same) expect(actual, at).toEqual(expected);
}

/** Decode sequentially via next() and check every frame. */
export function expectReplayMatches(rec: Recorded): ReplayReader {
  // The compile-time guard only sees declared fields; this catches one the
  // worker attaches without declaring it.
  for (const f of rec.frames) {
    for (const key of Object.keys(f)) {
      expect(VIEW_DATA_ROUTING, `tick ${f.tick}`).toHaveProperty(key);
    }
  }
  const reader = openReader(rec.replay);
  expect(reader.header.totalFrames).toBe(rec.truth.length);
  for (let i = 0; i < rec.truth.length; i++) {
    const frame = reader.next();
    expect(frame, `frame ${i}`).not.toBeNull();
    expectFrameMatchesTruth(frame!, rec, i);
  }
  expect(reader.next()).toBeNull();
  return reader;
}
