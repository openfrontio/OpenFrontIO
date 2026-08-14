/**
 * Measures the cost of water-nuke terrain fixup (finalizeWaterChanges) and
 * the throttled water graph rebuild on the giant world map.
 *
 * Craters are queued directly via game.queueWaterConversion() — the same
 * call NukeExecution makes on impact — so the test exercises the exact
 * WaterManager code path without silo/gold/travel bookkeeping.
 *
 * Run with: npx tsx tests/perf/WaterNukeRebuildPerf.ts
 */
import { dirname } from "path";
import { fileURLToPath } from "url";
import { Game } from "../../src/core/game/Game";
import { DebugSpan } from "../../src/core/utilities/DebugSpan";
import { setup } from "../util/Setup";

type Span = {
  name: string;
  duration?: number;
  children: Span[];
};

DebugSpan.enable();

function spans(): Span[] {
  return (globalThis as any).__DEBUG_SPANS__ ?? [];
}

/** Recursively find the first span with `name` in a span tree. */
function findSpan(root: Span, name: string): Span | undefined {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findSpan(child, name);
    if (found) return found;
  }
  return undefined;
}

/** Find the most recent root span with `name` at index >= fromIndex. */
function lastRootSpan(name: string, fromIndex: number): Span | undefined {
  const all = spans();
  for (let i = all.length - 1; i >= fromIndex; i--) {
    if (all[i].name === name) return all[i];
  }
  return undefined;
}

function ms(v: number | undefined): string {
  return v === undefined ? "-" : v.toFixed(1);
}

const currentDir = dirname(fileURLToPath(import.meta.url));

console.log("Loading giant world map (4108x1948)...");
const setupStart = performance.now();
const game: Game = await setup(
  "giantworldmap",
  {
    waterNukes: true,
    disableNavMesh: false,
  },
  [],
  currentDir,
);
const setupMs = performance.now() - setupStart;
const initialBuild = lastRootSpan("AbstractGraphBuilder:build", 0);
console.log(
  `Setup done in ${ms(setupMs)}ms (initial graph build: ${ms(initialBuild?.duration)}ms)`,
);

/**
 * Find spread-out coastal land targets (land shoreline tiles at least
 * `minDist` apart). Coastal nukes are the common case and produce
 * ocean-connected craters.
 */
function findCoastalTargets(
  count: number,
  minDist: number,
): { x: number; y: number }[] {
  const targets: { x: number; y: number }[] = [];
  const w = game.width();
  const h = game.height();
  for (let y = 120; y < h - 120 && targets.length < count; y += 11) {
    for (let x = 120; x < w - 120 && targets.length < count; x += 11) {
      const tile = game.ref(x, y);
      if (!game.isLand(tile) || !game.isShoreline(tile)) continue;
      let tooClose = false;
      for (const t of targets) {
        const dx = t.x - x;
        const dy = t.y - y;
        if (dx * dx + dy * dy < minDist * minDist) {
          tooClose = true;
          break;
        }
      }
      if (!tooClose) targets.push({ x, y });
    }
  }
  return targets;
}

/** Queue a circular crater of land->water conversions, like NukeExecution. */
function queueCrater(cx: number, cy: number, radius: number): number {
  let queued = 0;
  const r2 = radius * radius;
  const x0 = Math.max(0, cx - radius);
  const y0 = Math.max(0, cy - radius);
  const x1 = Math.min(game.width() - 1, cx + radius);
  const y1 = Math.min(game.height() - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const tile = game.ref(x, y);
      if (game.isLand(tile) && !game.hasOwner(tile)) {
        game.queueWaterConversion(tile);
        queued++;
      }
    }
  }
  return queued;
}

interface Result {
  label: string;
  tiles: number;
  finalizeTickMs: number;
  finalizeMs?: number;
  oceanMs?: number;
  magnitudeMs?: number;
  shorelineMs?: number;
  minimapMs?: number;
  miniMagnitudeMs?: number;
  rebuildTickMs?: number;
  rebuildMs?: number;
  buildMs?: number;
  ccMs?: number;
  nodesMs?: number;
  edgesMs?: number;
  hpaMs?: number;
}

const results: Result[] = [];

/**
 * Queue craters, tick once (flushes conversions -> finalizeWaterChanges),
 * then tick until the graph rebuild fires (20-tick throttle) and record
 * the duration of the rebuild tick.
 */
function runScenario(
  label: string,
  craters: { x: number; y: number; radius: number }[],
): void {
  const spanIndex = spans().length;

  let tiles = 0;
  for (const c of craters) {
    tiles += queueCrater(c.x, c.y, c.radius);
  }

  const t0 = performance.now();
  game.executeNextTick();
  const finalizeTickMs = performance.now() - t0;

  const versionBefore = game.waterGraphVersion();
  let rebuildTickMs: number | undefined;
  for (let i = 0; i < 30; i++) {
    const t1 = performance.now();
    game.executeNextTick();
    const tickMs = performance.now() - t1;
    if (game.waterGraphVersion() > versionBefore) {
      rebuildTickMs = tickMs;
      break;
    }
  }

  const finalize = lastRootSpan("WaterManager:finalizeWaterChanges", spanIndex);
  const rebuild = lastRootSpan("WaterManager:rebuildWaterGraph", spanIndex);
  const build = rebuild && findSpan(rebuild, "AbstractGraphBuilder:build");

  results.push({
    label,
    tiles,
    finalizeTickMs,
    finalizeMs: finalize?.duration,
    oceanMs: finalize && findSpan(finalize, "ocean")?.duration,
    magnitudeMs: finalize && findSpan(finalize, "magnitude")?.duration,
    shorelineMs: finalize && findSpan(finalize, "shoreline")?.duration,
    minimapMs: finalize && findSpan(finalize, "minimap")?.duration,
    miniMagnitudeMs: finalize && findSpan(finalize, "miniMagnitude")?.duration,
    rebuildTickMs,
    rebuildMs: rebuild?.duration,
    buildMs: build?.duration,
    ccMs: build && findSpan(build, "ConnectedComponents:initialize")?.duration,
    nodesMs: build && findSpan(build, "nodes")?.duration,
    edgesMs: build && findSpan(build, "edges")?.duration,
    hpaMs: rebuild && findSpan(rebuild, "hpa")?.duration,
  });
}

// ── Scenarios ────────────────────────────────────────────────────────
const ATOM_RADIUS = 30;
const HYDROGEN_RADIUS = 100;

const targets = findCoastalTargets(16, 400);
if (targets.length < 16) {
  throw new Error(`Only found ${targets.length}/16 coastal targets`);
}

// 8 single atom bombs at spread-out coastal locations
for (let i = 0; i < 8; i++) {
  runScenario(`atom coastal #${i + 1}`, [
    { ...targets[i], radius: ATOM_RADIUS },
  ]);
}

// 3 single hydrogen bombs
for (let i = 0; i < 3; i++) {
  runScenario(`hydrogen coastal #${i + 1}`, [
    { ...targets[8 + i], radius: HYDROGEN_RADIUS },
  ]);
}

// Barrage: 5 atom bombs landing on the same tick at spread-out locations
// (worst case: the finalize bounding boxes span most of the map)
runScenario(
  "barrage 5x atom same tick",
  targets.slice(11, 16).map((t) => ({ ...t, radius: ATOM_RADIUS })),
);

// MIRV-like: many small warheads landing the same tick, spread across
// the map (union bounding box ~ whole map)
const mirvTargets = findCoastalTargets(40, 250);
runScenario(
  "mirv 40x warheads same tick",
  mirvTargets.map((t) => ({ ...t, radius: 18 })),
);

// Repeat bombardment: hydrogen bombs walking along the first target area
// (rebuild on already-cratered terrain)
const base = targets[8];
for (let i = 0; i < 3; i++) {
  runScenario(`hydrogen repeat #${i + 1}`, [
    { x: base.x + 40 * (i + 1), y: base.y, radius: HYDROGEN_RADIUS },
  ]);
}

// ── Report ───────────────────────────────────────────────────────────
console.log("\n=== Water Nuke Rebuild Performance (giant world map) ===\n");
const header = [
  "scenario".padEnd(26),
  "tiles".padStart(7),
  "finalize".padStart(9),
  "ocean".padStart(7),
  "magn".padStart(7),
  "shore".padStart(7),
  "mini".padStart(6),
  "miniMag".padStart(8),
  "| rebuild".padStart(10),
  "build".padStart(8),
  "CC".padStart(7),
  "nodes".padStart(7),
  "edges".padStart(8),
  "hpa".padStart(6),
].join(" ");
console.log(header);
console.log("-".repeat(header.length));
for (const r of results) {
  console.log(
    [
      r.label.padEnd(26),
      String(r.tiles).padStart(7),
      ms(r.finalizeMs).padStart(9),
      ms(r.oceanMs).padStart(7),
      ms(r.magnitudeMs).padStart(7),
      ms(r.shorelineMs).padStart(7),
      ms(r.minimapMs).padStart(6),
      ms(r.miniMagnitudeMs).padStart(8),
      ("| " + ms(r.rebuildMs)).padStart(10),
      ms(r.buildMs).padStart(8),
      ms(r.ccMs).padStart(7),
      ms(r.nodesMs).padStart(7),
      ms(r.edgesMs).padStart(8),
      ms(r.hpaMs).padStart(6),
    ].join(" "),
  );
}

const rebuilds = results
  .map((r) => r.rebuildMs)
  .filter((v): v is number => v !== undefined)
  .sort((a, b) => a - b);
const finalizes = results.map((r) => r.finalizeMs ?? 0).sort((a, b) => a - b);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
console.log(
  `\nfinalize ms  — median ${ms(finalizes[Math.floor(finalizes.length / 2)])}, ` +
    `mean ${ms(sum(finalizes) / finalizes.length)}, max ${ms(finalizes[finalizes.length - 1])}`,
);
console.log(
  `rebuild ms   — median ${ms(rebuilds[Math.floor(rebuilds.length / 2)])}, ` +
    `mean ${ms(sum(rebuilds) / rebuilds.length)}, max ${ms(rebuilds[rebuilds.length - 1])}`,
);
console.log(
  `initial build (full, no dirty-cluster cache): ${ms(initialBuild?.duration)}ms`,
);
