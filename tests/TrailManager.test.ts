import {
  NUKE_TRAIL_BIT,
  TrailManager,
} from "../src/client/render/frame/TrailManager";
import type { UnitState } from "../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_TRANSPORT,
} from "../src/client/render/types/UnitType";

const W = 64;
const H = 64;

const ref = (x: number, y: number) => y * W + x;

function makeUnit(
  id: number,
  ownerID: number,
  unitType: string,
  pos: number,
  lastPos: number,
): UnitState {
  return {
    id,
    unitType,
    ownerID,
    lastOwnerID: null,
    pos,
    lastPos,
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
    veterancy: 0,
    hasTrainStation: false,
    trainType: null,
    loaded: null,
    constructionStartTick: null,
  };
}

/** All non-zero texels as [ref, value] pairs. */
function stampedTexels(tm: TrailManager): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  tm.getTrailState().forEach((v, r) => {
    if (v !== 0) out.push([r, v]);
  });
  return out;
}

describe("TrailManager", () => {
  it("stamps a plain boat trail with the bare owner value", () => {
    const tm = new TrailManager(W, H);
    const units = new Map<number, UnitState>();
    const u = makeUnit(1, 3, UT_TRANSPORT, ref(5, 10), ref(5, 10));
    units.set(1, u);
    tm.update(units, [1]);
    u.lastPos = u.pos;
    u.pos = ref(12, 10);
    tm.update(units, [1]);

    for (let x = 5; x <= 12; x++) {
      expect(tm.getTrailState()[ref(x, 10)]).toBe(3);
    }
  });

  it("stamps nuke trails up to lastPos with the nuke bit set", () => {
    const tm = new TrailManager(W, H);
    const units = new Map<number, UnitState>();
    const u = makeUnit(2, 5, UT_ATOM_BOMB, ref(8, 20), ref(4, 20));
    units.set(2, u);
    tm.update(units, [2]);
    u.lastPos = ref(10, 20);
    u.pos = ref(14, 20);
    tm.update(units, [2]);

    // Head = lastPos, so the stamp reaches x=10, not pos (x=14).
    for (let x = 4; x <= 10; x++) {
      expect(tm.getTrailState()[ref(x, 20)]).toBe(5 | NUKE_TRAIL_BIT);
    }
    expect(tm.getTrailState()[ref(12, 20)]).toBe(0);
  });

  it("clears a dead unit's tiles and repaints overlaps from survivors", () => {
    const tm = new TrailManager(W, H);
    const units = new Map<number, UnitState>();
    // Boat A along row 10, boat B down column 8 — they cross at (8, 10).
    const a = makeUnit(1, 3, UT_TRANSPORT, ref(5, 10), ref(5, 10));
    const b = makeUnit(2, 4, UT_TRANSPORT, ref(8, 5), ref(8, 5));
    units.set(1, a);
    units.set(2, b);
    tm.update(units, [1, 2]);
    a.lastPos = a.pos;
    a.pos = ref(12, 10);
    b.lastPos = b.pos;
    b.pos = ref(8, 12);
    tm.update(units, [1, 2]);

    units.delete(1);
    tm.update(units, [2]);

    // A's exclusive tiles are gone; the crossing keeps B's full value.
    expect(tm.getTrailState()[ref(6, 10)]).toBe(0);
    expect(tm.getTrailState()[ref(8, 10)]).toBe(4);
    // B's own trail is intact.
    for (let y = 5; y <= 12; y++) {
      expect(tm.getTrailState()[ref(8, y)]).toBe(4);
    }
    expect(stampedTexels(tm).every(([, v]) => v === 4)).toBe(true);
  });
});
