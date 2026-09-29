/**
 * Measures what a rising sea costs per second on the largest map.
 *
 * Unlike a nuke crater, this front is spread along the whole coastline, so the
 * terrain fixup's bounding boxes span the map. That is exactly why the mode
 * turns off WaterManager's water-magnitude recompute (see the skipWaterMagnitude
 * flag): water magnitude only feeds a soft ship-path preference and render
 * shading, never integer sim state, and recomputing it over a map-wide front
 * costs several times the 100 ms tick budget on its own.
 *
 * The report is what pins that down: with the flag on, the `magn` and `miniMag`
 * columns must stay at ~0 and the tile-update count must track the quota rather
 * than the map area. Reporting only — nothing here asserts, like the other perf
 * scripts.
 *
 * Run with: npx tsx tests/perf/RisingSeaLevelPerf.ts
 */
import { dirname } from "path";
import { fileURLToPath } from "url";
import { RisingSeaLevelExecution } from "../../src/core/execution/RisingSeaLevelExecution";
import { Game } from "../../src/core/game/Game";
import { risingSeaLevelSchedule } from "../../src/core/game/RisingSeaLevel";
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

/** Find the most recent root span with `name`. */
function lastRootSpan(name: string): Span | undefined {
  const all = spans();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].name === name) return all[i];
  }
  return undefined;
}

/**
 * DebugSpan keeps only the last 100 root spans, so an index captured before a
 * catch-up run has shifted out by the time it is read. Emptying the buffer right
 * before the measured tick means every span found afterwards came from it.
 */
function clearSpans(): void {
  (globalThis as any).__DEBUG_SPANS__ = [];
}

function ms(v: number | undefined): string {
  return v === undefined ? "-" : v.toFixed(1);
}

const currentDir = dirname(fileURLToPath(import.meta.url));

// veryfast: the shortest schedule, so the per-second quota — and therefore the
// cost this script measures — is the largest the mode can produce.
const SPEED = "veryfast";
const schedule = risingSeaLevelSchedule(SPEED);

console.log("Loading giant world map (4108x1948)...");
const setupStart = performance.now();
const game: Game = await setup(
  "giantworldmap",
  {
    risingSeaLevel: { enabled: true, speed: SPEED },
    disableNavMesh: false,
  },
  [],
  currentDir,
);
const setupMs = performance.now() - setupStart;
const initialBuild = lastRootSpan("AbstractGraphBuilder:build");
console.log(
  `Setup done in ${ms(setupMs)}ms (initial graph build: ${ms(initialBuild?.duration)}ms)`,
);

// setup() does not register game executions, so add the real one and let its
// own init() run the reachability census — that cost is reported separately
// because it is a one-off at game start, not a per-second cost.
const exec = new RisingSeaLevelExecution();
const censusStart = performance.now();
game.addExecution(exec);
game.executeNextTick();
const censusMs = performance.now() - censusStart;
console.log(
  `init + reachability census: ${ms(censusMs)}ms over ${exec.reachable()} reachable land tiles ` +
    `(of ${game.numLandTiles()} land tiles)`,
);

interface Sample {
  second: number;
  waterline: number;
  flooded: number;
  quota: number;
  tickMs: number;
  tileUpdates: number;
  finalizeMs?: number;
  oceanMs?: number;
  magnitudeMs?: number;
  shorelineMs?: number;
  minimapMs?: number;
  miniMagnitudeMs?: number;
  rebuildMs?: number;
}

const samples: Sample[] = [];

// Sample every 30th flood second. A full veryfast flood is 720 s, which at ten
// ticks a second is 7200 ticks of a 8M-tile map — more than a perf script
// should sit through — so stop once the picture is clear.
const SAMPLE_EVERY = 30;
const SAMPLES = 12;

const graceTicks = schedule.graceSeconds * 10;
console.log(`Skipping the ${schedule.graceSeconds}s dry grace...`);
while (game.ticks() < graceTicks) {
  game.executeNextTick();
  game.drainPackedTileUpdates();
}

console.log(`Sampling every ${SAMPLE_EVERY}s of flooding...\n`);
while (samples.length < SAMPLES) {
  const floodedBefore = exec.flooded();

  // Executions are handed the pre-increment tick counter, so the flood runs on
  // the call made while ticks() is divisible by ten. Line up on one of those and
  // measure that single call.
  while (game.ticks() % 10 !== 0) {
    game.executeNextTick();
    game.drainPackedTileUpdates();
  }

  clearSpans();
  const t0 = performance.now();
  game.executeNextTick();
  const tickMs = performance.now() - t0;
  const tileUpdates = game.drainPackedTileUpdates().length;

  const finalize = lastRootSpan("WaterManager:finalizeWaterChanges");
  const rebuild = lastRootSpan("WaterManager:rebuildWaterGraph");

  samples.push({
    second: Math.floor(game.ticks() / 10) - schedule.graceSeconds,
    waterline: exec.waterline(),
    flooded: exec.flooded(),
    // flooded() confirms a tick late, so the quota is read off the delta of the
    // two confirmations around this batch rather than off the counter itself.
    quota: exec.flooded() - floodedBefore,
    tickMs,
    tileUpdates,
    finalizeMs: finalize?.duration,
    oceanMs: finalize && findSpan(finalize, "ocean")?.duration,
    magnitudeMs: finalize && findSpan(finalize, "magnitude")?.duration,
    shorelineMs: finalize && findSpan(finalize, "shoreline")?.duration,
    minimapMs: finalize && findSpan(finalize, "minimap")?.duration,
    miniMagnitudeMs: finalize && findSpan(finalize, "miniMagnitude")?.duration,
    rebuildMs: rebuild?.duration,
  });

  if (!exec.isActive()) {
    console.log("Execution finished before the sample budget ran out.");
    break;
  }

  const until = game.ticks() + SAMPLE_EVERY * 10;
  while (game.ticks() < until) {
    game.executeNextTick();
    game.drainPackedTileUpdates();
  }
}

// ── Report ───────────────────────────────────────────────────────────
console.log(
  `\n=== Rising Sea Level Performance (giant world map, "${SPEED}") ===\n`,
);
const header = [
  "flood s".padStart(8),
  "line".padStart(5),
  "flooded".padStart(9),
  "quota".padStart(7),
  "tick".padStart(7),
  "updates".padStart(9),
  "| finalize".padStart(11),
  "ocean".padStart(7),
  "magn".padStart(7),
  "shore".padStart(7),
  "mini".padStart(7),
  "miniMag".padStart(8),
  "| rebuild".padStart(10),
].join(" ");
console.log(header);
console.log("-".repeat(header.length));
for (const s of samples) {
  console.log(
    [
      String(s.second).padStart(8),
      String(s.waterline).padStart(5),
      String(s.flooded).padStart(9),
      String(s.quota).padStart(7),
      ms(s.tickMs).padStart(7),
      String(s.tileUpdates).padStart(9),
      ("| " + ms(s.finalizeMs)).padStart(11),
      ms(s.oceanMs).padStart(7),
      ms(s.magnitudeMs).padStart(7),
      ms(s.shorelineMs).padStart(7),
      ms(s.minimapMs).padStart(7),
      ms(s.miniMagnitudeMs).padStart(8),
      ("| " + ms(s.rebuildMs)).padStart(10),
    ].join(" "),
  );
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
function stats(label: string, values: number[], unit: string): void {
  if (values.length === 0) return;
  const s = sorted(values);
  console.log(
    `${label.padEnd(16)} median ${ms(s[Math.floor(s.length / 2)])}${unit}, ` +
      `mean ${ms(sum(s) / s.length)}${unit}, max ${ms(s[s.length - 1])}${unit}`,
  );
}

console.log("");
stats(
  "flood tick",
  samples.map((s) => s.tickMs),
  "ms",
);
stats(
  "finalize",
  samples.map((s) => s.finalizeMs ?? 0),
  "ms",
);
stats(
  "magnitude",
  samples.map((s) => s.magnitudeMs ?? 0),
  "ms",
);
stats(
  "miniMagnitude",
  samples.map((s) => s.miniMagnitudeMs ?? 0),
  "ms",
);
stats(
  "tile updates",
  samples.map((s) => s.tileUpdates),
  "",
);
console.log(
  "\nThe magnitude and miniMagnitude columns should read ~0: skipWaterMagnitude " +
    "is on for the whole game whenever this mode is enabled. Tile updates should " +
    "track the quota, not the map area.\n" +
    "An empty rebuild column is the expected reading, not a missing measurement: " +
    "the water graph rebuild is gated on a tick that converted nothing, so it " +
    "never shares a tick with the flood. The mode floods on one tick in ten to " +
    "leave it those nine.",
);
