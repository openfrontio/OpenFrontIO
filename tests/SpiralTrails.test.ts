import {
  MAX_TRAIL_STRANDS,
  SAMPLE_FLOATS,
  SpiralTrails,
} from "../src/client/render/frame/SpiralTrails";
import type { UnitState } from "../src/client/render/types";
import {
  UT_ATOM_BOMB,
  UT_TRANSPORT,
} from "../src/client/render/types/UnitType";

const W = 64;

const ref = (x: number, y: number) => y * W + x;

const COLORS: Array<[number, number, number]> = [
  [1, 0, 0],
  [0, 0, 1],
];

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

/** Drive a nuke (head = lastPos) left-to-right along row y, one update per step. */
function flyNuke(
  st: SpiralTrails,
  units: Map<number, UnitState>,
  id: number,
  ownerID: number,
  y: number,
  fromX: number,
  toX: number,
  stepX = 4,
): void {
  const u = makeUnit(id, ownerID, UT_ATOM_BOMB, ref(fromX, y), ref(fromX, y));
  units.set(id, u);
  st.update(units, [id]);
  for (let x = fromX + stepX; x <= toX; x += stepX) {
    u.lastPos = ref(x, y);
    u.pos = ref(Math.min(x + stepX, W - 1), y);
    st.update(units, [id]);
  }
}

describe("SpiralTrails", () => {
  it("builds a ribbon only for nukes whose owner has spiral params", () => {
    const st = new SpiralTrails(W);
    st.setParams(5, {
      radius: 4,
      strands: 2,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    flyNuke(st, units, 1, 5, 32, 4, 24); // owner 5 — spiral
    flyNuke(st, units, 2, 6, 20, 4, 24); // owner 6 — plain

    const ribbons = st.getRibbons();
    expect(ribbons.length).toBe(1);
    expect(ribbons[0].id).toBe(1);
  });

  it("ignores non-nuke units even for spiral owners", () => {
    const st = new SpiralTrails(W);
    st.setParams(5, {
      radius: 4,
      strands: 2,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    const u = makeUnit(1, 5, UT_TRANSPORT, ref(5, 10), ref(5, 10));
    units.set(1, u);
    st.update(units, [1]);
    u.lastPos = u.pos;
    u.pos = ref(12, 10);
    st.update(units, [1]);

    expect(st.getRibbons().length).toBe(0);
  });

  it("appends ~2 samples per tile with increasing distance up to the head", () => {
    const st = new SpiralTrails(W);
    st.setParams(5, {
      radius: 4,
      strands: 2,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    flyNuke(st, units, 1, 5, 32, 4, 40);

    const r = st.getRibbons()[0];
    // 36 tiles traveled at SAMPLES_PER_TILE=2, plus the seed sample.
    expect(r.headDist).toBeCloseTo(36);
    expect(r.sampleCount).toBe(36 * 2 + 1);
    let prevD = -1;
    for (let s = 0; s < r.sampleCount; s++) {
      const off = s * SAMPLE_FLOATS;
      const d = r.samples[off + 4];
      expect(d).toBeGreaterThan(prevD);
      prevD = d;
      // Horizontal path: centerline on row 32, unit perpendicular (0, 1).
      expect(r.samples[off + 1]).toBeCloseTo(32);
      expect(r.samples[off + 2]).toBeCloseTo(0);
      expect(Math.abs(r.samples[off + 3])).toBeCloseTo(1);
    }
    expect(prevD).toBeCloseTo(r.headDist);
  });

  it("clamps strands to MAX_TRAIL_STRANDS and derives twist from the pitch", () => {
    const st = new SpiralTrails(W);
    st.setParams(9, {
      radius: 10,
      strands: 12,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    flyNuke(st, units, 1, 9, 32, 4, 12);

    const r = st.getRibbons()[0];
    expect(r.strands).toBe(MAX_TRAIL_STRANDS);
    // Pitch = max(radius * 4, 8) = 40 tiles per revolution.
    expect(r.twist).toBeCloseTo((2 * Math.PI) / 40);
  });

  it("drops the ribbon when the nuke dies, mutating the live array", () => {
    const st = new SpiralTrails(W);
    st.setParams(5, {
      radius: 4,
      strands: 2,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    const live = st.getRibbons();
    flyNuke(st, units, 1, 5, 32, 4, 40);
    expect(live.length).toBe(1);

    units.delete(1);
    st.update(units, []);
    expect(live.length).toBe(0);
  });

  it("keeps geometry for in-flight ribbons when params change", () => {
    const st = new SpiralTrails(W);
    st.setParams(5, {
      radius: 4,
      strands: 2,
      rotationSpeed: 5,
      colors: COLORS,
    });
    const units = new Map<number, UnitState>();
    flyNuke(st, units, 1, 5, 32, 4, 20);
    st.setParams(5, {
      radius: 9,
      strands: 3,
      rotationSpeed: 1,
      colors: COLORS,
    });
    flyNuke(st, units, 1, 5, 32, 20, 40);

    const r = st.getRibbons()[0];
    expect(r.radius).toBe(4);
    expect(r.strands).toBe(2);
  });
});
