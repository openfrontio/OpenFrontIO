import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Game } from "../../../src/core/game/Game";
import { GameMap, TileRef } from "../../../src/core/game/GameMap";
import { AbstractGraphBuilder } from "../../../src/core/pathfinding/algorithms/AbstractGraph";
import { ConnectedComponents } from "../../../src/core/pathfinding/algorithms/ConnectedComponents";
import { PathFinding } from "../../../src/core/pathfinding/PathFinder";
import { setup } from "../../util/Setup";

/**
 * Pathfinding-focused coverage for water nukes: component merging,
 * magnitude recomputation, incremental graph rebuilds, and end-to-end
 * boat pathing through nuked terrain.
 *
 * `plains` (100x100, all land) is used as a canvas: every water tile is
 * crater water created by our own code, so results can be compared
 * exactly against from-scratch oracles.
 */

const WATER_NUKE_CONFIG = {
  waterNukes: true,
  disableNavMesh: false,
};

/** Queue a circular land→water crater, like NukeExecution does on impact. */
function nukeCircle(game: Game, cx: number, cy: number, r: number): void {
  const r2 = r * r;
  const x0 = Math.max(0, cx - r);
  const y0 = Math.max(0, cy - r);
  const x1 = Math.min(game.width() - 1, cx + r);
  const y1 = Math.min(game.height() - 1, cy + r);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const tile = game.ref(x, y);
      if (
        game.isLand(tile) &&
        !game.hasOwner(tile) &&
        !game.map().isImpassable(tile)
      ) {
        game.queueWaterConversion(tile);
      }
    }
  }
}

/** Tick until the throttled water graph rebuild fires. */
function tickUntilRebuild(game: Game, maxTicks = 40): void {
  const version = game.waterGraphVersion();
  for (let i = 0; i < maxTicks; i++) {
    game.executeNextTick();
    if (game.waterGraphVersion() > version) return;
  }
  throw new Error(
    `water graph did not rebuild within ${maxTicks} ticks (version ${version})`,
  );
}

/**
 * Oracle: from-scratch magnitude computation over the whole map.
 * magnitude = ceil(BFS_dist_to_nearest_coastline / 2), capped at 31;
 * water unreachable from any coastline is 31 (deep).
 */
function scratchMagnitudes(
  map: GameMap,
  passableCoastOnly: boolean,
): Int32Array {
  const w = map.width();
  const h = map.height();
  const n = w * h;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  const isCoast = (t: number): boolean =>
    map.isLand(t) && (!passableCoastOnly || !map.isImpassable(t));
  for (let t = 0; t < n; t++) {
    if (map.isLand(t)) continue;
    const x = t % w;
    const y = (t - x) / w;
    const coast =
      (y > 0 && isCoast(t - w)) ||
      (y < h - 1 && isCoast(t + w)) ||
      (x > 0 && isCoast(t - 1)) ||
      (x < w - 1 && isCoast(t + 1));
    if (coast) {
      dist[t] = 0;
      queue[tail++] = t;
    }
  }
  let head = 0;
  while (head < tail) {
    const t = queue[head++];
    const d = dist[t] + 1;
    const x = t % w;
    const y = (t - x) / w;
    if (y > 0 && !map.isLand(t - w) && dist[t - w] < 0) {
      dist[t - w] = d;
      queue[tail++] = t - w;
    }
    if (y < h - 1 && !map.isLand(t + w) && dist[t + w] < 0) {
      dist[t + w] = d;
      queue[tail++] = t + w;
    }
    if (x > 0 && !map.isLand(t - 1) && dist[t - 1] < 0) {
      dist[t - 1] = d;
      queue[tail++] = t - 1;
    }
    if (x < w - 1 && !map.isLand(t + 1) && dist[t + 1] < 0) {
      dist[t + 1] = d;
      queue[tail++] = t + 1;
    }
  }
  const mags = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    if (map.isLand(t)) continue;
    mags[t] = dist[t] < 0 ? 31 : Math.min(Math.ceil(dist[t] / 2), 31);
  }
  return mags;
}

function expectMagnitudesMatchOracle(map: GameMap, passableCoastOnly: boolean) {
  const oracle = scratchMagnitudes(map, passableCoastOnly);
  let mismatches = 0;
  let firstMismatch = "";
  for (let t = 0; t < map.width() * map.height(); t++) {
    if (map.isLand(t)) continue;
    if (map.magnitude(t) !== oracle[t]) {
      if (mismatches === 0) {
        firstMismatch = `tile (${map.x(t)},${map.y(t)}): actual=${map.magnitude(t)} expected=${oracle[t]}`;
      }
      mismatches++;
    }
  }
  expect(mismatches, `magnitude mismatches, first: ${firstMismatch}`).toBe(0);
}

/** Edge map keyed by canonical tile pair, for graph equality checks. */
function edgeCostMap(
  graph: NonNullable<ReturnType<Game["miniWaterGraph"]>>,
): Map<string, number> {
  const edges = new Map<string, number>();
  for (const edge of graph.getAllEdges()) {
    const a = graph.getNode(edge.nodeA)!.tile;
    const b = graph.getNode(edge.nodeB)!.tile;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const existing = edges.get(key);
    if (existing === undefined || edge.cost < existing) {
      edges.set(key, edge.cost);
    }
  }
  return edges;
}

describe("water components after nukes (plains)", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains", WATER_NUKE_CONFIG);
  });

  it("an isolated crater forms a single new water component", () => {
    nukeCircle(game, 30, 30, 8);
    tickUntilRebuild(game);

    const center = game.ref(30, 30);
    expect(game.isWater(center)).toBe(true);

    const comp = game.getWaterComponent(center);
    expect(comp).not.toBeNull();

    // All water in the crater shares the component
    for (const [x, y] of [
      [30, 24],
      [30, 36],
      [24, 30],
      [36, 30],
    ]) {
      const t = game.ref(x, y);
      expect(game.isWater(t)).toBe(true);
      expect(game.getWaterComponent(t)).toBe(comp);
      expect(game.hasWaterComponent(t, comp!)).toBe(true);
    }

    // Size is in full-map tile units: crater is ~π*8² ≈ 200 tiles
    const size = game.getWaterComponentSize(center);
    expect(size).not.toBeNull();
    expect(size!).toBeGreaterThan(100);
    expect(size!).toBeLessThan(400);
  });

  it("separate craters get distinct components", () => {
    nukeCircle(game, 25, 30, 7);
    nukeCircle(game, 70, 30, 7);
    tickUntilRebuild(game);

    const lakeA = game.ref(25, 30);
    const lakeB = game.ref(70, 30);
    const compA = game.getWaterComponent(lakeA);
    const compB = game.getWaterComponent(lakeB);
    expect(compA).not.toBeNull();
    expect(compB).not.toBeNull();
    expect(compA).not.toBe(compB);
    expect(game.hasWaterComponent(lakeA, compB!)).toBe(false);
    expect(game.hasWaterComponent(lakeB, compA!)).toBe(false);

    // No boat path between disconnected lakes
    const path = PathFinding.Water(game).findPath(lakeA, lakeB);
    expect(path).toBeNull();
  });

  it("a nuked channel merges two lakes and enables pathfinding across", () => {
    nukeCircle(game, 25, 30, 7);
    nukeCircle(game, 70, 30, 7);
    tickUntilRebuild(game);

    const lakeA = game.ref(25, 30);
    const lakeB = game.ref(70, 30);
    const compABefore = game.getWaterComponent(lakeA);
    const compBBefore = game.getWaterComponent(lakeB);
    expect(compABefore).not.toBe(compBBefore);

    // Carve a channel between the lakes with a chain of nukes
    for (let x = 30; x <= 65; x += 5) {
      nukeCircle(game, x, 30, 5);
    }
    tickUntilRebuild(game);

    const merged = game.getWaterComponent(lakeA);
    expect(merged).not.toBeNull();
    expect(game.getWaterComponent(lakeB)).toBe(merged);
    expect(game.hasWaterComponent(lakeB, merged!)).toBe(true);
    // Mid-channel water is part of the same component
    const mid = game.ref(47, 30);
    expect(game.isWater(mid)).toBe(true);
    expect(game.getWaterComponent(mid)).toBe(merged);

    // The merged lake is bigger than either original crater
    const size = game.getWaterComponentSize(lakeA);
    expect(size!).toBeGreaterThan(300);

    // Boats can now cross
    const path = PathFinding.Water(game).findPath(lakeA, lakeB);
    expect(path).not.toBeNull();
    expect(path![0]).toBe(lakeA);
    expect(path![path!.length - 1]).toBe(lakeB);
  });

  it("component queries are already consistent before the throttled rebuild", () => {
    nukeCircle(game, 30, 30, 8);
    // Flush conversions (finalize runs) but do NOT wait for the rebuild
    game.executeNextTick();

    const center = game.ref(30, 30);
    expect(game.isWater(center)).toBe(true);
    // The incrementally-updated components already know the crater
    const comp = game.getWaterComponent(center);
    expect(comp).not.toBeNull();
    expect(game.hasWaterComponent(game.ref(34, 30), comp!)).toBe(true);
  });
});

describe("crater connecting to ocean (half_land_half_ocean)", () => {
  it("nuked land next to ocean joins the ocean component and gets the ocean bit", async () => {
    const game = await setup("half_land_half_ocean", WATER_NUKE_CONFIG);
    const map = game.map();

    // Find a land tile with an ocean neighbor
    let target: TileRef | null = null;
    let oceanTile: TileRef | null = null;
    outer: for (let y = 1; y < game.height() - 1; y++) {
      for (let x = 1; x < game.width() - 1; x++) {
        const t = game.ref(x, y);
        if (!game.isLand(t)) continue;
        for (const n of [
          game.ref(x - 1, y),
          game.ref(x + 1, y),
          game.ref(x, y - 1),
          game.ref(x, y + 1),
        ]) {
          if (map.isOcean(n)) {
            target = t;
            oceanTile = n;
            break outer;
          }
        }
      }
    }
    expect(target).not.toBeNull();
    expect(oceanTile).not.toBeNull();

    nukeCircle(game, game.x(target!), game.y(target!), 3);
    tickUntilRebuild(game);

    // Converted tiles connected to the ocean become ocean
    expect(game.isWater(target!)).toBe(true);
    expect(map.isOcean(target!)).toBe(true);
    // ...and share the ocean's water component
    expect(game.getWaterComponent(target!)).toBe(
      game.getWaterComponent(oceanTile!),
    );
  });
});

describe("magnitudes after nukes match a from-scratch BFS (plains)", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains", WATER_NUKE_CONFIG);
  });

  it("single crater", () => {
    nukeCircle(game, 40, 40, 10);
    tickUntilRebuild(game);

    expectMagnitudesMatchOracle(game.map(), true);
    expectMagnitudesMatchOracle(game.miniMap(), false);
  });

  it("simultaneous distant craters (barrage — exercises crater grouping)", () => {
    // Three spread-out craters landing on the same tick form separate
    // BFS groups internally; results must be identical to a global BFS.
    nukeCircle(game, 15, 15, 6);
    nukeCircle(game, 80, 80, 6);
    nukeCircle(game, 80, 15, 6);
    tickUntilRebuild(game);

    expectMagnitudesMatchOracle(game.map(), true);
    expectMagnitudesMatchOracle(game.miniMap(), false);
  });

  it("overlapping repeat nukes on the same area", () => {
    nukeCircle(game, 40, 40, 8);
    tickUntilRebuild(game);
    nukeCircle(game, 46, 40, 8);
    tickUntilRebuild(game);
    nukeCircle(game, 52, 44, 8);
    tickUntilRebuild(game);

    expectMagnitudesMatchOracle(game.map(), true);
    expectMagnitudesMatchOracle(game.miniMap(), false);
  });

  it("coastline far outside the dirty box still shapes crater-area magnitudes", () => {
    // Carve a large open-water pool (~x 7..83, y 17..93). Interior tiles
    // have their nearest coast 20-40 tiles away — well below the 31 cap.
    for (let cy = 25; cy <= 85; cy += 10) {
      for (let cx = 15; cx <= 75; cx += 10) {
        nukeCircle(game, cx, cy, 8);
      }
    }
    tickUntilRebuild(game);

    // Now nuke a small crater far east of the pool. Its dirty box reaches
    // deep into the pool, but the pool's WEST coast (the nearest coast for
    // much of that water) lies outside the dirty box — only the larger
    // seed box includes it. A too-small seed box recomputes those tiles
    // from farther coasts and corrupts their magnitudes.
    nukeCircle(game, 95, 55, 4);
    tickUntilRebuild(game);

    expectMagnitudesMatchOracle(game.map(), true);
    expectMagnitudesMatchOracle(game.miniMap(), false);

    // Non-vacuity guard: this pool tile sits inside the second nuke's
    // dirty box and its nearest coast is the pool's west edge (~28 away,
    // magnitude ~14). If the pool geometry ever changes such that a
    // nearer coast exists, this assertion flags the test as no longer
    // exercising the far-coastline case.
    const probe = game.ref(35, 55);
    expect(game.isWater(probe)).toBe(true);
    expect(game.map().magnitude(probe)).toBeLessThan(16);
  });

  it("interior crater water is not treated as shoreline (magnitude > 0)", () => {
    nukeCircle(game, 40, 40, 10);
    tickUntilRebuild(game);

    // Crater center is far from the new coast on both maps
    const center = game.ref(40, 40);
    expect(game.map().magnitude(center)).toBeGreaterThan(0);

    const mini = game.miniMap();
    const miniCenter = mini.ref(20, 20);
    expect(mini.isWater(miniCenter)).toBe(true);
    expect(mini.magnitude(miniCenter)).toBeGreaterThan(0);
  });
});

describe("graph rebuild consistency (plains)", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains", WATER_NUKE_CONFIG);
    // A sequence of nukes with rebuilds in between, ending with a channel
    // that merges lakes — a worst case for incremental bookkeeping.
    nukeCircle(game, 25, 30, 7);
    nukeCircle(game, 70, 30, 7);
    tickUntilRebuild(game);
    for (let x = 30; x <= 65; x += 5) {
      nukeCircle(game, x, 30, 5);
    }
    tickUntilRebuild(game);
    nukeCircle(game, 50, 70, 9);
    tickUntilRebuild(game);
  });

  it("incremental rebuild produces the same graph as a full rebuild", () => {
    const incremental = game.miniWaterGraph();
    expect(incremental).not.toBeNull();

    // Full rebuild from scratch: no old graph, no dirty tiles, fresh CC
    const full = new AbstractGraphBuilder(game.miniMap()).build();

    const incNodes = new Set(incremental!.getAllNodes().map((n) => n.tile));
    const fullNodes = new Set(full.getAllNodes().map((n) => n.tile));
    expect(incNodes).toEqual(fullNodes);

    expect(edgeCostMap(incremental!)).toEqual(edgeCostMap(full));
  });

  it("incremental components match a fresh flood fill", () => {
    const graph = game.miniWaterGraph()!;
    const mini = game.miniMap();
    const fresh = new ConnectedComponents(mini);
    fresh.initialize();

    const freshToInc = new Map<number, number>();
    const incToFresh = new Map<number, number>();
    for (let t = 0; t < mini.width() * mini.height(); t++) {
      if (!mini.isWater(t)) continue;
      const f = fresh.getComponentId(t);
      const i = graph.getComponentId(t);
      if (!freshToInc.has(f) && !incToFresh.has(i)) {
        freshToInc.set(f, i);
        incToFresh.set(i, f);
      }
      expect(freshToInc.get(f)).toBe(i);
      expect(incToFresh.get(i)).toBe(f);
      expect(graph.getComponentSize(i)).toBe(fresh.getComponentSize(f));
    }
    expect(freshToInc.size).toBeGreaterThan(0);
  });

  it("the same nuke sequence is deterministic across two games", async () => {
    const game2 = await setup("plains", WATER_NUKE_CONFIG);
    nukeCircle(game2, 25, 30, 7);
    nukeCircle(game2, 70, 30, 7);
    tickUntilRebuild(game2);
    for (let x = 30; x <= 65; x += 5) {
      nukeCircle(game2, x, 30, 5);
    }
    tickUntilRebuild(game2);
    nukeCircle(game2, 50, 70, 9);
    tickUntilRebuild(game2);

    // Identical terrain bytes on both maps
    for (let t = 0; t < game.width() * game.height(); t++) {
      if (game.map().terrainByte(t) !== game2.map().terrainByte(t)) {
        throw new Error(`terrain differs at (${game.x(t)},${game.y(t)})`);
      }
    }
    const mini = game.miniMap();
    const mini2 = game2.miniMap();
    for (let t = 0; t < mini.width() * mini.height(); t++) {
      if (mini.terrainByte(t) !== mini2.terrainByte(t)) {
        throw new Error(`minimap terrain differs at tile ${t}`);
      }
    }

    // Identical graphs
    expect(edgeCostMap(game.miniWaterGraph()!)).toEqual(
      edgeCostMap(game2.miniWaterGraph()!),
    );
  });
});

describe("cluster boundary rebuild (plains)", () => {
  it("a crater creating a gateway into a clean neighboring cluster updates that cluster's edges", async () => {
    // The 50x50 minimap has a cluster boundary between minimap columns
    // 31 and 32 (cluster size 32). First carve a lake strictly in the
    // eastern cluster whose water reaches minimap column 32, rebuild,
    // then carve a lake strictly in the western cluster reaching column
    // 31. The second rebuild dirties only the western cluster's tiles,
    // but the new gateway nodes on the shared boundary need edges inside
    // the EASTERN (otherwise clean) cluster too — that is what the
    // 1-ring dirty-cluster expansion in the partial rebuild is for.
    const game = await setup("plains", WATER_NUKE_CONFIG);

    // Lake strictly east of minimap col 32, spanning DOWN across the
    // y=31/32 cluster boundary as well — this gives the eastern cluster a
    // pre-existing gateway node on its bottom edge, so the new western
    // gateway created later must gain an edge to it inside the eastern
    // cluster.
    nukeCircle(game, 71, 40, 7);
    nukeCircle(game, 71, 50, 7);
    nukeCircle(game, 71, 60, 7);
    nukeCircle(game, 71, 66, 7); // reaches minimap rows >= 32
    tickUntilRebuild(game);
    nukeCircle(game, 56, 40, 7); // minimap cols 24..31 (western cluster)
    tickUntilRebuild(game);

    // Non-vacuity: water on both sides of the cluster boundary
    const mini = game.miniMap();
    expect(mini.isWater(mini.ref(31, 20))).toBe(true);
    expect(mini.isWater(mini.ref(32, 20))).toBe(true);

    // Incremental graph must equal a full rebuild
    const incremental = game.miniWaterGraph()!;
    const full = new AbstractGraphBuilder(game.miniMap()).build();
    const incNodes = new Set(incremental.getAllNodes().map((n) => n.tile));
    const fullNodes = new Set(full.getAllNodes().map((n) => n.tile));
    expect(incNodes).toEqual(fullNodes);
    expect(edgeCostMap(incremental)).toEqual(edgeCostMap(full));

    // And boats can cross the boundary through the merged lakes
    const path = PathFinding.Water(game).findPath(
      game.ref(56, 40),
      game.ref(71, 40),
    );
    expect(path).not.toBeNull();
  });
});

describe("world map pathfinding across water-nuke rebuilds", () => {
  let game: Game;
  let oceanA: TileRef;
  let oceanB: TileRef;

  beforeAll(async () => {
    game = await setup("world", WATER_NUKE_CONFIG);

    // Two far-apart ocean tiles in the same water component
    const y = 500;
    let first: TileRef | null = null;
    for (let x = 5; x < game.width(); x++) {
      const t = game.ref(x, y);
      if (game.map().isOcean(t)) {
        first = t;
        break;
      }
    }
    expect(first).not.toBeNull();
    oceanA = first!;
    const compA = game.getWaterComponent(oceanA);
    let last: TileRef | null = null;
    for (let x = game.width() - 5; x > game.x(oceanA) + 800; x--) {
      const t = game.ref(x, y);
      if (game.map().isOcean(t) && game.getWaterComponent(t) === compA) {
        last = t;
        break;
      }
    }
    expect(last).not.toBeNull();
    oceanB = last!;
  });

  function findCoastalLand(): TileRef {
    // A land tile on the shoreline, away from the map edge
    for (let y = 300; y < game.height() - 100; y += 3) {
      for (let x = 100; x < game.width() - 100; x += 3) {
        const t = game.ref(x, y);
        if (game.isLand(t) && game.map().isShoreline(t)) return t;
      }
    }
    throw new Error("no coastal land found");
  }

  it("long ocean paths keep working across repeated nukes and rebuilds", () => {
    // Baseline: long path across the ocean
    const before = PathFinding.Water(game).findPath(oceanA, oceanB);
    expect(before).not.toBeNull();

    // Nuke a coastal area, wait for rebuild (reuses the HPA via setGraph)
    const target1 = findCoastalLand();
    nukeCircle(game, game.x(target1), game.y(target1), 12);
    tickUntilRebuild(game);

    const after1 = PathFinding.Water(game).findPath(oceanA, oceanB);
    expect(after1).not.toBeNull();
    expect(after1![0]).toBe(oceanA);
    expect(after1![after1!.length - 1]).toBe(oceanB);

    // Second nuke + rebuild: exercises repeated graph swaps
    const target2 = findCoastalLand(); // now water or new shoreline nearby
    nukeCircle(game, game.x(target2), game.y(target2), 12);
    tickUntilRebuild(game);

    const after2 = PathFinding.Water(game).findPath(oceanA, oceanB);
    expect(after2).not.toBeNull();
  });

  it("boats can traverse a nuked canal to a deep-inland lake", () => {
    // Find a deep-inland land tile: everything within ±100 tiles is land.
    // The old water graph has no nodes anywhere near it, so this only
    // works if the rebuilt graph (and the pathfinder's graph-derived
    // helpers) fully reflect the new water.
    const R = 100;
    let lake: TileRef | null = null;
    let channelDir: [number, number] | null = null;
    let channelEnd: TileRef | null = null;
    outer: for (let y = 150; y < game.height() - 150; y += 25) {
      for (let x = 150; x < game.width() - 150; x += 25) {
        let allLand = true;
        for (let dy = -R; dy <= R && allLand; dy += 5) {
          for (let dx = -R; dx <= R; dx += 5) {
            const t = game.ref(x + dx, y + dy);
            if (!game.isLand(t) || game.map().isImpassable(t)) {
              allLand = false;
              break;
            }
          }
        }
        if (!allLand) continue;

        // Walk each cardinal direction looking for a clean straight line
        // of passable land ending at ocean.
        for (const [sx, sy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          let cx = x;
          let cy = y;
          let ok = true;
          while (ok) {
            cx += sx;
            cy += sy;
            if (
              cx < 10 ||
              cx >= game.width() - 10 ||
              cy < 10 ||
              cy >= game.height() - 10
            ) {
              ok = false;
              break;
            }
            const t = game.ref(cx, cy);
            if (game.map().isOcean(t)) break; // reached the ocean
            if (game.map().isImpassable(t) || game.hasOwner(t)) {
              ok = false;
            }
          }
          if (ok) {
            lake = game.ref(x, y);
            channelDir = [sx, sy];
            channelEnd = game.ref(cx, cy);
            break outer;
          }
        }
      }
    }
    expect(lake, "no deep-inland lake site found on world map").not.toBeNull();

    // Carve the lake and a canal to the ocean in one strike wave
    const lx = game.x(lake!);
    const ly = game.y(lake!);
    nukeCircle(game, lx, ly, 10);
    const [sx, sy] = channelDir!;
    const ex = game.x(channelEnd!);
    const ey = game.y(channelEnd!);
    const steps = Math.max(Math.abs(ex - lx), Math.abs(ey - ly));
    for (let i = 4; i <= steps; i += 4) {
      nukeCircle(game, lx + sx * i, ly + sy * i, 6);
    }
    tickUntilRebuild(game);

    // The lake is now water, in the same component as the ocean
    expect(game.isWater(lake!)).toBe(true);
    expect(game.getWaterComponent(lake!)).toBe(
      game.getWaterComponent(channelEnd!),
    );

    // A boat from the distant open ocean can navigate the canal into the
    // inland lake (target resolution + abstract routing must use the
    // rebuilt graph, not stale pre-nuke state).
    const start =
      game.getWaterComponent(oceanA) === game.getWaterComponent(lake!)
        ? oceanA
        : channelEnd!;
    const path = PathFinding.Water(game).findPath(start, lake!);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(lake!);
  });

  it("boats can path into a coastal nuke crater", () => {
    const target = findCoastalLand();
    const tx = game.x(target);
    const ty = game.y(target);
    nukeCircle(game, tx, ty, 12);
    tickUntilRebuild(game);

    // The crater is now ocean-connected water
    expect(game.isWater(target)).toBe(true);
    const craterComp = game.getWaterComponent(target);
    expect(craterComp).not.toBeNull();
    expect(craterComp).toBe(game.getWaterComponent(oceanA));

    // A boat from the open ocean can reach the crater center
    const path = PathFinding.Water(game).findPath(oceanA, target);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toBe(target);
  });
});
