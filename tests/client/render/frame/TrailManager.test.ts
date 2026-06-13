/**
 * TrailManager stamps a unit's path into the per-tile "last owner" texture.
 *
 * Smoothed nukes are interpolated lastPos→pos per render frame (UnitPass), so
 * their trail must stamp only up to `lastPos` — otherwise the tail would lead
 * the smoothly-moving missile sprite. Every other unit stamps up to `pos`.
 */

import { describe, expect, it } from "vitest";
import { TrailManager } from "../../../../src/client/render/frame/TrailManager";
import type { UnitState } from "../../../../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_TRADE_SHIP,
} from "../../../../src/client/render/types";

const MAP_W = 50;
const MAP_H = 50;

function unit(overrides: Partial<UnitState> = {}): UnitState {
  return {
    id: 1,
    unitType: UT_ATOM_BOMB,
    ownerID: 7,
    lastOwnerID: null,
    pos: 0,
    lastPos: 0,
    isActive: true,
    reachedTarget: false,
    retreating: false,
    targetable: true,
    markedForDeletion: false,
    health: null,
    underConstruction: false,
    targetUnitId: null,
    targetTile: null,
    troops: 0,
    missileTimerQueue: [],
    level: 1,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
    ...overrides,
  };
}

function units(...us: UnitState[]): Map<number, UnitState> {
  return new Map(us.map((u) => [u.id, u]));
}

const ref = (x: number, y: number) => y * MAP_W + x;

describe("TrailManager", () => {
  it("stamps a smoothed nuke's trail only up to lastPos, not pos", () => {
    const tm = new TrailManager(MAP_W, MAP_H);
    const trail = tm.getTrailState();

    // First sighting: lastPos === pos at spawn.
    tm.update(units(unit({ pos: ref(2, 2), lastPos: ref(2, 2) })), [1]);
    expect(trail[ref(2, 2)]).toBe(7);

    // Move: lastPos trails pos by a tile. The trail head must reach lastPos
    // (3,2) but NOT the current pos (4,2) — the smoothed sprite occupies the
    // lastPos→pos span this frame.
    tm.update(units(unit({ pos: ref(4, 2), lastPos: ref(3, 2) })), [1]);
    expect(trail[ref(3, 2)]).toBe(7);
    expect(trail[ref(4, 2)]).toBe(0);
  });

  it("stamps a non-smoothed unit's trail up to pos", () => {
    const tm = new TrailManager(MAP_W, MAP_H);
    const trail = tm.getTrailState();

    tm.update(
      units(
        unit({ unitType: UT_TRADE_SHIP, pos: ref(2, 2), lastPos: ref(2, 2) }),
      ),
      [1],
    );
    tm.update(
      units(
        unit({ unitType: UT_TRADE_SHIP, pos: ref(4, 2), lastPos: ref(3, 2) }),
      ),
      [1],
    );

    // Trade ships are not interpolated, so the trail reaches the current pos.
    expect(trail[ref(4, 2)]).toBe(7);
  });

  it("clears a unit's trail when it disappears", () => {
    const tm = new TrailManager(MAP_W, MAP_H);
    const trail = tm.getTrailState();

    tm.update(units(unit({ pos: ref(5, 5), lastPos: ref(5, 5) })), [1]);
    tm.update(units(unit({ pos: ref(7, 5), lastPos: ref(6, 5) })), [1]);
    expect(trail[ref(5, 5)]).toBe(7);
    expect(trail[ref(6, 5)]).toBe(7);

    // Unit gone from the map → its tiles are cleared.
    tm.update(new Map(), []);
    expect(trail[ref(5, 5)]).toBe(0);
    expect(trail[ref(6, 5)]).toBe(0);
  });
});
