import {
  Cell,
  PlayerInfo,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import { Game, Player } from "@openfront/engine/game/Game";
import { performance } from "node:perf_hooks";
import v8 from "node:v8";
import {
  createGrid as optimizedCreateGrid,
  findLargestInscribedRectangle as optimizedFindLargestInscribedRectangle,
  Point,
  Rectangle,
} from "../../packages/engine/src/game/NameBoxCalculator";
import { setup } from "../util/Setup";

function legacyLargestRectangleInHistogram(widths: number[]): Rectangle {
  const stack: number[] = [];
  let maxArea = 0;
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let i = 0; i <= widths.length; i++) {
    const h = i === widths.length ? 0 : widths[i];
    while (stack.length > 0 && h < widths[stack[stack.length - 1]]) {
      const height = widths[stack.pop()!];
      const width = stack.length === 0 ? i : i - stack[stack.length - 1] - 1;
      if (height * width > maxArea) {
        maxArea = height * width;
        largestRect = {
          x: stack.length === 0 ? 0 : stack[stack.length - 1] + 1,
          y: 0,
          width,
          height,
        };
      }
    }
    stack.push(i);
  }
  return largestRect;
}

function legacyFindLargestInscribedRectangle(grid: boolean[][]): Rectangle {
  const rows = grid[0]?.length ?? 0;
  const cols = grid.length;
  if (rows === 0 || cols === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const heights: number[] = new Array(cols).fill(0);
  let largestRect: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      heights[col] = grid[col][row] ? heights[col] + 1 : 0;
    }
    const rect = legacyLargestRectangleInHistogram(heights);
    if (rect.width * rect.height > largestRect.width * largestRect.height) {
      largestRect = {
        x: rect.x,
        y: row - rect.height + 1,
        width: rect.width,
        height: rect.height,
      };
    }
  }
  return largestRect;
}

function legacyCreateGrid(
  game: Game,
  player: Player,
  bb: { min: Point; max: Point },
  sf: number,
): boolean[][] {
  const minX = Math.floor(bb.min.x / sf);
  const maxX = Math.floor(bb.max.x / sf);
  const minY = Math.floor(bb.min.y / sf);
  const maxY = Math.floor(bb.max.y / sf);
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const grid: boolean[][] = Array(w)
    .fill(null)
    .map(() => Array(h).fill(false));

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const cell = new Cell(x * sf, y * sf);
      if (!game.isOnMap(cell)) continue;
      const tile = game.ref(cell.x, cell.y);
      grid[x - minX][y - minY] =
        game.isShore(tile) ||
        (game.isOcean(tile) && game.magnitude(tile) < 10) ||
        game.owner(tile) === player ||
        game.hasFallout(tile);
    }
  }
  return grid;
}

function runGc(): void {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function calculateReduction(legacyVal: number, optVal: number): number {
  if (legacyVal <= 0) return 0;
  return Math.max(0, ((legacyVal - optVal) / legacyVal) * 100);
}

interface SingleRunMetric {
  runIndex: number;
  legacyDurationMs: number;
  optimizedDurationMs: number;
  speedup: number;
  legacyAllocatedBytes: number;
  optimizedAllocatedBytes: number;
  memoryReductionPercent: number;
}

interface AverageMetric {
  avgLegacyDurationMs: number;
  avgOptimizedDurationMs: number;
  avgSpeedup: number;
  avgLegacyAllocatedBytes: number;
  avgOptimizedAllocatedBytes: number;
  avgMemoryReductionPercent: number;
}

function buildMetric(
  runIndex: number,
  leg: { durationMs: number; allocatedBytes: number },
  opt: { durationMs: number; allocatedBytes: number },
): SingleRunMetric {
  return {
    runIndex,
    legacyDurationMs: leg.durationMs,
    optimizedDurationMs: opt.durationMs,
    speedup: leg.durationMs / Math.max(0.001, opt.durationMs),
    legacyAllocatedBytes: leg.allocatedBytes,
    optimizedAllocatedBytes: opt.allocatedBytes,
    memoryReductionPercent: calculateReduction(
      leg.allocatedBytes,
      opt.allocatedBytes,
    ),
  };
}

function measureDuration<T>(
  fn: () => T,
  iterations: number,
): { durationMs: number; lastResult: T } {
  const start = performance.now();
  let lastResult!: T;
  for (let i = 0; i < iterations; i++) {
    lastResult = fn();
  }
  return { durationMs: performance.now() - start, lastResult };
}

function measureAllocatedBytes<T>(
  fn: () => T,
  iterations: number,
  sampleInterval = 20,
): number {
  runGc();
  let allocated = 0;
  let lastHeap = v8.getHeapStatistics().used_heap_size;
  for (let i = 0; i < iterations; i++) {
    fn();
    if (i % sampleInterval === 0) {
      const curr = v8.getHeapStatistics().used_heap_size;
      if (curr > lastHeap) allocated += curr - lastHeap;
      lastHeap = curr;
    }
  }
  return allocated;
}

function benchmarkFn<T>(
  fn: () => T,
  iterations: number,
): { durationMs: number; allocatedBytes: number; lastResult: T } {
  const { durationMs, lastResult } = measureDuration(fn, iterations);
  const allocatedBytes = measureAllocatedBytes(fn, iterations);
  return { durationMs, allocatedBytes, lastResult };
}

function assertRectEquivalence(
  leg: Rectangle,
  opt: Rectangle,
  runIndex: number,
): void {
  if (
    leg.x !== opt.x ||
    leg.y !== opt.y ||
    leg.width !== opt.width ||
    leg.height !== opt.height
  ) {
    throw new Error(
      `Equivalence mismatch in run ${runIndex}: legacy=(${leg.x},${leg.y},${leg.width},${leg.height}) vs opt=(${opt.x},${opt.y},${opt.width},${opt.height})`,
    );
  }
}

function assertGridEquivalence(
  leg: boolean[][],
  opt: Uint8Array,
  w: number,
  h: number,
  runIndex: number,
): void {
  if (leg.length !== w || opt.length !== w * h) {
    throw new Error(`createGrid dimension mismatch in run ${runIndex}`);
  }
  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      const expected = leg[c][r] ? 1 : 0;
      const actual = opt[r * w + c];
      if (actual !== expected) {
        throw new Error(
          `createGrid cell mismatch at (${c}, ${r}) in run ${runIndex}`,
        );
      }
    }
  }
}

function createTestGrids(
  cols: number,
  rows: number,
): { legacyGrid: boolean[][]; flatGrid: Uint8Array } {
  const legacyGrid: boolean[][] = Array(cols)
    .fill(null)
    .map(() => Array(rows).fill(false));
  const flatGrid = new Uint8Array(cols * rows);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const isSet = (c * 17 + r * 31 + ((c * r) % 19)) % 7 > 2;
      legacyGrid[c][r] = isSet;
      if (isSet) flatGrid[r * cols + c] = 1;
    }
  }
  return { legacyGrid, flatGrid };
}

async function setupBenchmarkGame(): Promise<{
  game: Game;
  player: Player;
  boundingBox: { min: Point; max: Point };
}> {
  const pInfo = new PlayerInfo("perfPlayer", PlayerType.Human, "c1", "p1");
  const game = await setup("plains", {}, [pInfo]);
  const player = game.player("p1");

  for (let x = 10; x <= 60; x++) {
    for (let y = 10; y <= 60; y++) {
      if ((x + y) % 5 !== 0) {
        player.conquer(game.ref(x, y));
      }
    }
  }
  const boundingBox = { min: { x: 10, y: 10 }, max: { x: 60, y: 60 } };
  return { game, player, boundingBox };
}

function measureFindRectangleRun(
  legacyGrid: boolean[][],
  flatGrid: Uint8Array,
  cols: number,
  rows: number,
  iterations: number,
  runIndex: number,
): SingleRunMetric {
  const leg = benchmarkFn(
    () => legacyFindLargestInscribedRectangle(legacyGrid),
    iterations,
  );
  const opt = benchmarkFn(
    () => optimizedFindLargestInscribedRectangle(flatGrid, cols, rows),
    iterations,
  );
  assertRectEquivalence(leg.lastResult, opt.lastResult, runIndex);
  return buildMetric(runIndex, leg, opt);
}

function measureCreateGridRun(
  game: Game,
  player: Player,
  bb: { min: Point; max: Point },
  sf: number,
  iterations: number,
  runIndex: number,
): SingleRunMetric {
  const leg = benchmarkFn(
    () => legacyCreateGrid(game, player, bb, sf),
    iterations,
  );
  const opt = benchmarkFn(
    () => optimizedCreateGrid(game, player, bb, sf),
    iterations,
  );
  const w = Math.floor(bb.max.x / sf) - Math.floor(bb.min.x / sf) + 1;
  const h = Math.floor(bb.max.y / sf) - Math.floor(bb.min.y / sf) + 1;
  assertGridEquivalence(leg.lastResult, opt.lastResult, w, h, runIndex);
  return buildMetric(runIndex, leg, opt);
}

function computeAverages(runs: SingleRunMetric[]): AverageMetric {
  const count = runs.length;
  const sum = runs.reduce(
    (acc, r) => ({
      legDur: acc.legDur + r.legacyDurationMs,
      optDur: acc.optDur + r.optimizedDurationMs,
      speedup: acc.speedup + r.speedup,
      legAlloc: acc.legAlloc + r.legacyAllocatedBytes,
      optAlloc: acc.optAlloc + r.optimizedAllocatedBytes,
      memRed: acc.memRed + r.memoryReductionPercent,
    }),
    { legDur: 0, optDur: 0, speedup: 0, legAlloc: 0, optAlloc: 0, memRed: 0 },
  );

  return {
    avgLegacyDurationMs: sum.legDur / count,
    avgOptimizedDurationMs: sum.optDur / count,
    avgSpeedup: sum.speedup / count,
    avgLegacyAllocatedBytes: sum.legAlloc / count,
    avgOptimizedAllocatedBytes: sum.optAlloc / count,
    avgMemoryReductionPercent: sum.memRed / count,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRow(
  label: string,
  legMs: number,
  optMs: number,
  spd: number,
  legBytes: number,
  optBytes: number,
  redPct: number,
): string {
  const lbl = label.padEnd(5);
  const legT = `${legMs.toFixed(2)} ms`.padStart(11);
  const optT = `${optMs.toFixed(2)} ms`.padStart(10);
  const spdStr = `${spd.toFixed(2)}x`.padStart(7);
  const legC = formatBytes(legBytes).padStart(12);
  const optC = formatBytes(optBytes).padStart(10);
  const red = `-${redPct.toFixed(1)}%`.padStart(15);
  return `${lbl} | ${legT} | ${optT} | ${spdStr} | ${legC} | ${optC} | ${red}`;
}

function printTableHeader(title: string, iterations: number): void {
  console.log(`\n${"=".repeat(65)}`);
  console.log(`  ${title} (${iterations} ops/run)`);
  console.log("=".repeat(65));
  console.log(
    "Run   | Legacy Time | Opt Time   | Speedup | Legacy Churn | Opt Churn  | Churn Reduction",
  );
  console.log(
    "------+-------------+------------+---------+--------------+------------+----------------",
  );
}

function printTableRows(runs: SingleRunMetric[], avg: AverageMetric): void {
  for (const r of runs) {
    console.log(
      formatRow(
        `Run ${r.runIndex}`,
        r.legacyDurationMs,
        r.optimizedDurationMs,
        r.speedup,
        r.legacyAllocatedBytes,
        r.optimizedAllocatedBytes,
        r.memoryReductionPercent,
      ),
    );
  }
  console.log(
    "------+-------------+------------+---------+--------------+------------+----------------",
  );
  console.log(
    formatRow(
      "AVG",
      avg.avgLegacyDurationMs,
      avg.avgOptimizedDurationMs,
      avg.avgSpeedup,
      avg.avgLegacyAllocatedBytes,
      avg.avgOptimizedAllocatedBytes,
      avg.avgMemoryReductionPercent,
    ),
  );
}

function printMetricsTable(
  title: string,
  runs: SingleRunMetric[],
  avg: AverageMetric,
  iterations: number,
): void {
  printTableHeader(title, iterations);
  printTableRows(runs, avg);
}

function warmup(
  legacyGrid: boolean[][],
  flatGrid: Uint8Array,
  cols: number,
  rows: number,
  game: Game,
  player: Player,
  bb: { min: Point; max: Point },
): void {
  for (let i = 0; i < 50; i++) {
    legacyFindLargestInscribedRectangle(legacyGrid);
    optimizedFindLargestInscribedRectangle(flatGrid, cols, rows);
    legacyCreateGrid(game, player, bb, 1);
    optimizedCreateGrid(game, player, bb, 1);
  }
}

async function collectRunMetrics(
  legacyGrid: boolean[][],
  flatGrid: Uint8Array,
  cols: number,
  rows: number,
  game: Game,
  player: Player,
  bb: { min: Point; max: Point },
  runsCount: number,
): Promise<{ rectRuns: SingleRunMetric[]; gridRuns: SingleRunMetric[] }> {
  const rectRuns: SingleRunMetric[] = [];
  const gridRuns: SingleRunMetric[] = [];
  for (let i = 1; i <= runsCount; i++) {
    rectRuns.push(
      measureFindRectangleRun(legacyGrid, flatGrid, cols, rows, 2000, i),
    );
    gridRuns.push(measureCreateGridRun(game, player, bb, 1, 1000, i));
  }
  return { rectRuns, gridRuns };
}

function printBenchmarkSummary(
  rectRuns: SingleRunMetric[],
  gridRuns: SingleRunMetric[],
): void {
  printMetricsTable(
    "1. findLargestInscribedRectangle",
    rectRuns,
    computeAverages(rectRuns),
    2000,
  );
  printMetricsTable(
    "2. createGrid (Territory Grid Gen)",
    gridRuns,
    computeAverages(gridRuns),
    1000,
  );
}

async function runAllBenchmarks(): Promise<void> {
  const COLS = 60;
  const ROWS = 60;
  console.log("Initializing NameBoxCalculator 5-Run Benchmark Suite...");
  const { legacyGrid, flatGrid } = createTestGrids(COLS, ROWS);
  const { game, player, boundingBox } = await setupBenchmarkGame();

  console.log("Warming up JIT compiler...");
  warmup(legacyGrid, flatGrid, COLS, ROWS, game, player, boundingBox);

  const { rectRuns, gridRuns } = await collectRunMetrics(
    legacyGrid,
    flatGrid,
    COLS,
    ROWS,
    game,
    player,
    boundingBox,
    5,
  );
  printBenchmarkSummary(rectRuns, gridRuns);
}

await runAllBenchmarks();
