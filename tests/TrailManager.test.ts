import {
  NUKE_TRAIL_BIT,
  SPIRAL_PHASE_BUCKETS,
  TRAIL_PHASE_SHIFT,
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

/** Drive a nuke (head = lastPos) left-to-right along row y, one update per step. */
function flyNuke(
  tm: TrailManager,
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
  tm.update(units, [id]);
  for (let x = fromX + stepX; x <= toX; x += stepX) {
    u.lastPos = ref(x, y);
    u.pos = ref(Math.min(x + stepX, W - 1), y);
    tm.update(units, [id]);
  }
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

  it("stamps spiral nuke trails as helix strands carrying phase buckets", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(5, { radius: 4, strands: 2 });
    const units = new Map<number, UnitState>();
    flyNuke(tm, units, 2, 5, 32, 4, 40);

    const texels = stampedTexels(tm);
    expect(texels.length).toBeGreaterThan(0);
    const bucketsSeen = new Set<number>();
    let maxOffset = 0;
    for (const [r, v] of texels) {
      expect(v & 0xfff).toBe(5);
      expect(v & NUKE_TRAIL_BIT).toBe(NUKE_TRAIL_BIT);
      const bucket = (v >> TRAIL_PHASE_SHIFT) & (SPIRAL_PHASE_BUCKETS - 1);
      expect(bucket).toBeLessThan(SPIRAL_PHASE_BUCKETS);
      bucketsSeen.add(bucket);
      maxOffset = Math.max(maxOffset, Math.abs(Math.floor(r / W) - 32));
    }
    // The helix angle wraps repeatedly over the flight (2+ turns), so many
    // distinct phase buckets appear, and the strands actually swing off the
    // centerline (amplitude 4, so some tiles sit well away from row 32).
    expect(bucketsSeen.size).toBeGreaterThanOrEqual(16);
    expect(maxOffset).toBeGreaterThanOrEqual(3);
    expect(maxOffset).toBeLessThanOrEqual(4);
  });

  it("converges the strands into the nuke at the head", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(5, { radius: 4, strands: 2 });
    const units = new Map<number, UnitState>();
    // Head ends at x=40; cone = one pitch = max(4*4, 8) = 16 tiles.
    flyNuke(tm, units, 2, 5, 32, 4, 40);

    let headMaxOffset = 0;
    let tailMaxOffset = 0;
    for (const [r] of stampedTexels(tm)) {
      const x = r % W;
      const dy = Math.abs(Math.floor(r / W) - 32);
      if (x >= 38) headMaxOffset = Math.max(headMaxOffset, dy);
      if (x <= 24) tailMaxOffset = Math.max(tailMaxOffset, dy);
    }
    // At the head the cone envelope pins the strands to the centerline; a
    // full cone-length back they run straight at the full amplitude.
    expect(headMaxOffset).toBeLessThanOrEqual(1);
    expect(tailMaxOffset).toBe(4);
    // The tip tile itself (the nuke's position) is stamped.
    expect(tm.getTrailState()[ref(40, 32)]).not.toBe(0);
  });

  it("keeps owners without spiral params on the plain centerline", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(5, { radius: 4, strands: 2 });
    const units = new Map<number, UnitState>();
    flyNuke(tm, units, 3, 6, 20, 4, 24);

    const texels = stampedTexels(tm);
    expect(texels.length).toBeGreaterThan(0);
    for (const [r, v] of texels) {
      expect(v).toBe(6 | NUKE_TRAIL_BIT);
      expect(Math.floor(r / W)).toBe(20);
    }
  });

  it("clears every spiral tile when the nuke dies", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(5, { radius: 4, strands: 3 });
    const units = new Map<number, UnitState>();
    flyNuke(tm, units, 4, 5, 32, 4, 40);
    expect(stampedTexels(tm).length).toBeGreaterThan(0);

    units.delete(4);
    tm.update(units, []);
    expect(stampedTexels(tm).length).toBe(0);
  });

  it("tracks spiral bounds while flying and collapses them on death", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(5, { radius: 4, strands: 2 });
    const units = new Map<number, UnitState>();
    const b = tm.getSpiralBounds();
    // Empty (minX > maxX) before any spiral trail exists.
    expect(b[0]).toBeGreaterThan(b[2]);

    flyNuke(tm, units, 2, 5, 32, 4, 40);
    // Bounds cover every stamped spiral tile.
    expect(b[0]).toBeLessThanOrEqual(b[2]);
    for (const [r] of stampedTexels(tm)) {
      const x = r % W;
      const y = Math.floor(r / W);
      expect(x).toBeGreaterThanOrEqual(b[0]);
      expect(x).toBeLessThanOrEqual(b[2]);
      expect(y).toBeGreaterThanOrEqual(b[1]);
      expect(y).toBeLessThanOrEqual(b[3]);
    }

    units.delete(2);
    tm.update(units, []);
    expect(b[0]).toBeGreaterThan(b[2]);
  });

  it("skips out-of-bounds strand tiles near the map edge and clamps strands to 8", () => {
    const tm = new TrailManager(W, H);
    tm.setSpiralParams(9, { radius: 10, strands: 12 });
    const units = new Map<number, UnitState>();
    // Path hugs the top edge, so strand offsets swing above row 0.
    expect(() => flyNuke(tm, units, 5, 9, 2, 4, 40)).not.toThrow();
    expect(stampedTexels(tm).length).toBeGreaterThan(0);
  });
});
