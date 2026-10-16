import {
  CameraGestures,
  ReplayCamera,
} from "../../../src/client/replay/ReplayCamera";
import {
  formatGameTime,
  timelineFrames,
} from "../../../src/client/replay/ReplayControls";
import { ReplayNukedLayers } from "../../../src/client/replay/ReplayNukedLayers";
import { ReplayTerrain } from "../../../src/client/replay/ReplayTerrain";
import { parseReplayViewerHash } from "../../../src/client/replay/ReplayViewerRoute";
import type {
  NukeImpactEvent,
  ReplayFrame,
} from "../../../src/client/replay/codec/ReplayTypes";

describe("parseReplayViewerHash", () => {
  test.each([
    ["#replay-viewer=abcd1234", "abcd1234"],
    ["#replay-viewer=AbCd12345X", "AbCd12345X"],
    ["#replay-viewer", null],
    ["#replay-viewer=../x", null],
    ["#replay-viewer=", null],
    ["#replay-viewerX", null],
    ["#token-login=x", null],
    ["", null],
  ])("%s → %s", (hash, expected) => {
    expect(parseReplayViewerHash(hash)).toBe(expected);
  });
});

test("formatGameTime", () => {
  expect(formatGameTime(0)).toBe("0:00");
  expect(formatGameTime(9)).toBe("0:00");
  expect(formatGameTime(655)).toBe("1:05");
  expect(formatGameTime(36_010)).toBe("1:00:01");
  expect(formatGameTime(-5)).toBe("0:00");
});

describe("ReplayCamera", () => {
  test("zooming keeps the point under the cursor fixed", () => {
    const c = new ReplayCamera(200, 100);
    c.zoom = 2;
    const worldAt = (sx: number, sy: number) => [
      c.x + (sx - 400) / c.zoom,
      c.y + (sy - 300) / c.zoom,
    ];
    const before = worldAt(700, 100);
    c.zoomAt(700, 100, 3, 800, 600);
    expect(c.zoom).toBe(6);
    const after = worldAt(700, 100);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  test("goTo glides there, and moving the map cancels it", () => {
    const c = new ReplayCamera(1000, 1000);
    c.goTo(900, 100);
    let steps = 0;
    while ((c.x !== 900 || c.y !== 100) && steps < 2000) {
      const before = Math.abs(900 - c.x) + Math.abs(100 - c.y);
      c.step(16);
      steps++;
      if (before < 2) break;
    }
    expect(Math.abs(900 - c.x) + Math.abs(100 - c.y)).toBeLessThan(2);
    expect(steps).toBeGreaterThan(1); // eased, not a jump

    c.goTo(0, 0);
    c.step(16);
    const at = [c.x, c.y];
    c.panBy(1, 1);
    c.step(1000);
    expect([c.x, c.y]).toEqual([at[0] - 1, at[1] - 1]);
  });
});

describe("CameraGestures", () => {
  test("one pointer drags the map", () => {
    const c = new ReplayCamera(200, 100);
    c.zoom = 2;
    const g = new CameraGestures(c);
    g.down(1, 100, 100);
    expect(g.active).toBe(true);
    g.move(1, 120, 90, 800, 600);
    expect([c.x, c.y]).toEqual([90, 55]);
    g.up(1);
    expect(g.active).toBe(false);
    g.move(1, 500, 500, 800, 600); // released: ignored
    expect([c.x, c.y]).toEqual([90, 55]);
  });

  test("two pointers pinch to zoom about their midpoint", () => {
    const c = new ReplayCamera(1000, 1000);
    c.zoom = 2;
    const g = new CameraGestures(c);
    g.down(1, 300, 300);
    g.down(2, 500, 300);
    const mid = c.worldAt(400, 300, 800, 600);
    // Spread apart symmetrically: twice as far, same midpoint.
    g.move(1, 200, 300, 800, 600);
    g.move(2, 600, 300, 800, 600);
    expect(c.zoom).toBeCloseTo(2 * (300 / 200) * (400 / 300));
    const after = c.worldAt(400, 300, 800, 600);
    expect(after.x).toBeCloseTo(mid.x);
    expect(after.y).toBeCloseTo(mid.y);
  });
});

describe("ReplayTerrain", () => {
  const frame = (
    terrain: [number, number][],
    changed: number[] | null,
  ): ReplayFrame =>
    ({
      terrain: new Map(terrain),
      changedTerrain: changed,
    }) as unknown as ReplayFrame;

  test("counts land sunk and raised, like GameMap.updateTile", () => {
    const LAND = 0x80;
    const t = new ReplayTerrain(Uint8Array.from([LAND, LAND, LAND, 0]));
    expect(t.apply(frame([[0, 0]], [0]))).toEqual([0]);
    expect(t.landChange).toBe(-1);
    t.apply(
      frame(
        [
          [0, 0],
          [1, 0],
        ],
        [1],
      ),
    );
    expect(t.landChange).toBe(-2);
    // A keyframe where tile 1 is back to land, and water tile 3 is land.
    t.apply(
      frame(
        [
          [0, 0],
          [3, LAND],
        ],
        null,
      ),
    );
    expect(t.landChange).toBe(0);
    expect([...t.bytes]).toEqual([0, LAND, LAND, LAND]);
  });
});

describe("ReplayNukedLayers", () => {
  const layers = [
    { id: "forest", placement: "land", nukeable: true },
    { id: "reef", placement: "water", nukeable: true },
    { id: "label", placement: "water" },
  ] as ConstructorParameters<typeof ReplayNukedLayers>[0];

  /** The sink keeps each layer's mask like MapRenderer does. */
  function setup(impacts: NukeImpactEvent[]) {
    const marked: [string, number[]][] = [];
    const masks = new Map<string, number[]>();
    const rebuilds = { count: 0 };
    const nuked = new ReplayNukedLayers(layers, 8, impacts, {
      markLayerTilesDestroyed: (id, tiles) => {
        marked.push([id, tiles]);
        if (!masks.has(id)) masks.set(id, new Array<number>(8).fill(0));
        for (const t of tiles) masks.get(id)![t] = 1;
      },
      setLayerDestroyedMask: (id, mask) => {
        rebuilds.count++;
        masks.set(id, [...mask]);
      },
    });
    return { nuked, marked, masks, rebuilds };
  }

  test("playing on marks each tick's impacts on the layer they hit", () => {
    const { nuked, marked } = setup([
      { tick: 5, land: [1, 2], water: [6] },
      { tick: 9, land: [3], water: [] },
    ]);
    nuked.advance(4);
    expect(marked).toEqual([]);
    nuked.advance(5);
    expect(marked).toEqual([
      ["forest", [1, 2]],
      ["reef", [6]],
    ]);
    nuked.advance(9);
    expect(marked[marked.length - 1]).toEqual(["forest", [3]]);
    expect(marked).toHaveLength(3);
  });

  test("seeking back rebuilds the masks, so the damage is undone", () => {
    const impacts: NukeImpactEvent[] = [{ tick: 5, land: [1, 2], water: [6] }];
    const { nuked, masks } = setup(impacts);
    nuked.seek(7);
    expect(masks.get("forest")).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect(masks.get("reef")).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
    expect(masks.has("label")).toBe(false);
    nuked.seek(4);
    expect(masks.get("forest")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // Impacts appended later (a game still being processed) count too.
    impacts.push({ tick: 8, land: [0], water: [] });
    nuked.seek(8);
    expect(masks.get("forest")).toEqual([1, 1, 1, 0, 0, 0, 0, 0]);
  });

  test("seeking forward only marks the impacts it passes", () => {
    const { nuked, masks, rebuilds } = setup([
      { tick: 5, land: [1, 2], water: [6] },
      { tick: 9, land: [3], water: [] },
    ]);
    nuked.seek(0); // the first seek sets the masks
    expect(rebuilds.count).toBe(2);
    nuked.seek(4); // passes no impact: nothing to do
    nuked.seek(7);
    nuked.advance(8);
    nuked.seek(12);
    expect(rebuilds.count).toBe(2);
    expect(masks.get("forest")).toEqual([0, 1, 1, 1, 0, 0, 0, 0]);
    expect(masks.get("reef")).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
    nuked.seek(6); // back past the tick 9 impact
    expect(rebuilds.count).toBe(4);
    expect(masks.get("forest")).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
  });
});

describe("the timeline of a game still being processed", () => {
  test("spans the whole game while it grows", () => {
    expect(timelineFrames(1200, 15691, true)).toBe(15691);
    // Unknown length: what is loaded.
    expect(timelineFrames(1200, null, true)).toBe(1200);
    // Finished: the file is the truth.
    expect(timelineFrames(15691, 15000, false)).toBe(15691);
    expect(timelineFrames(15691, 15000, true)).toBe(15691);
  });
});
