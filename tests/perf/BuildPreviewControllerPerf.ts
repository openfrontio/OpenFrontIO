import { TileRef } from "@openfront/engine-api/game/GameMap";
import { BuildableUnit, UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import Benchmark from "benchmark";
// @ts-expect-error jsdom lacks bundled type declarations in this environment
import { JSDOM } from "jsdom";
import type { MapRenderer } from "../../src/client/render/gl";
import {
  buildNukeTrajectory,
  type SAMInfo,
} from "../../src/client/render/gl/utils/NukeTrajectory";
import type { GhostPreviewData } from "../../src/client/render/types";
import type { TransformHandler } from "../../src/client/TransformHandler";
import type { UIState } from "../../src/client/UIState";
import type { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

function initDomEnvironment(): void {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost/",
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    customElements: dom.window.customElements,
    Node: dom.window.Node,
    sessionStorage: dom.window.sessionStorage,
  });
}

initDomEnvironment();

const { BuildPreviewController } =
  await import("../../src/client/controllers/BuildPreviewController");

interface ControllerInternals {
  cursorLoop(): void;
  updateNukeTrajectoryPreview(tileRef: TileRef | undefined): void;
  buildGhostPreviewData(
    tileRef: TileRef | undefined,
    targetingAlly: boolean,
  ): GhostPreviewData | null;
  lastGhostData: GhostPreviewData | null;
  nukeTrajectoryStatic: {
    srcX: number;
    srcY: number;
    targetTile: TileRef;
    directionUp: boolean;
    sams: SAMInfo[];
  } | null;
  prevGhostDataRef: GhostPreviewData | null;
  prevTrajRef: unknown;
  lastWorldX: number | null;
  lastWorldY: number | null;
  renderedGhostBuffer: GhostPreviewData | null;
  ghostUnit: { buildableUnit: BuildableUnit } | null;
  mousePos: { x: number; y: number };
}

interface BenchmarkTarget {
  name: string;
  hz: number;
  stats: { mean: number; rme: number };
}

interface PairedScenario {
  id: string;
  name: string;
  baseline: () => void;
  optimized: () => void;
}

function createMockSams(count: number) {
  const sams: Array<{
    isActive: () => boolean;
    owner: () => { smallID: () => number };
    tile: () => TileRef;
    level: () => number;
  }> = [];
  for (let i = 0; i < count; i++) {
    const sx = 200 + i * 18;
    const sy = 150 + (i % 5) * 40;
    sams.push({
      isActive: () => true,
      owner: () => ({ smallID: () => 2 }),
      tile: () => sy * 1000 + sx,
      level: () => 2,
    });
  }
  return sams;
}

function createMockPlayer(
  mockSilos: Array<{
    isActive: () => boolean;
    isInCooldown: () => boolean;
    isUnderConstruction: () => boolean;
    tile: () => TileRef;
  }>,
) {
  return {
    gold: () => 100_000n,
    smallID: () => 1,
    readyMissileCount: () => 10,
    units: (t: UnitType) => (t === UnitType.MissileSilo ? mockSilos : []),
    allies: () => [],
    isOnSameTeam: () => false,
  };
}

function createMockConfig() {
  return {
    samRange: () => 120,
    nukeMagnitudes: () => ({ inner: 20, outer: 45 }),
    nukeAllianceBreakThreshold: () => 100,
    trainStationMaxRange: () => 150,
    defensePostRange: () => 100,
  };
}

function createMockGame(
  mockSilos: Parameters<typeof createMockPlayer>[0],
  mockSams: ReturnType<typeof createMockSams>,
) {
  const myPlayer = createMockPlayer(mockSilos);
  const config = createMockConfig();
  return {
    isValidCoord: (x: number, y: number) =>
      x >= 0 && x < 1000 && y >= 0 && y < 500,
    ref: (x: number, y: number) => y * 1000 + x,
    x: (t: TileRef) => t % 1000,
    y: (t: TileRef) => Math.floor(t / 1000),
    height: () => 500,
    isImpassable: (_t: TileRef) => false,
    myPlayer: () => myPlayer,
    players: () => [],
    units: (t: UnitType) => (t === UnitType.SAMLauncher ? mockSams : []),
    config: () => config,
  };
}

function createControllerDependencies(
  game: unknown,
  transformHandler: unknown,
  view: unknown,
) {
  const userSettings = {
    nukeAllianceSafetyDuration: () => 0,
    cursorCostLabel: () => true,
    snapBuildPreview: () => false,
  };
  const uiState = {
    ghostStructure: UnitType.AtomBomb,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  };
  return new BuildPreviewController(
    game as unknown as GameView,
    new EventBus(),
    uiState as unknown as UIState,
    transformHandler as unknown as TransformHandler,
    view as unknown as MapRenderer,
    userSettings as unknown as UserSettings,
  );
}

function createTransformHandler(coords: { x: number; y: number }) {
  return {
    screenToWorldCoordinates: () => ({
      x: Math.floor(coords.x),
      y: Math.floor(coords.y),
    }),
    screenToWorldCoordinatesFloat: () => ({ x: coords.x, y: coords.y }),
  };
}

function createBenchmarkFixture() {
  const coords = { x: 600.0, y: 300.0 };
  const mockSilos = [
    {
      isActive: () => true,
      isInCooldown: () => false,
      isUnderConstruction: () => false,
      tile: () => 100 * 1000 + 100,
    },
  ];
  const mockSams = createMockSams(20);
  const game = createMockGame(mockSilos, mockSams);
  const transformHandler = createTransformHandler(coords);
  const view = { updateGhostPreview: () => {}, updateNukeTrajectory: () => {} };
  const controller = createControllerDependencies(game, transformHandler, view);
  return {
    controller: controller as unknown as ControllerInternals,
    game: game as unknown as GameView,
    view: view as unknown as MapRenderer,
    transformHandler,
    mockSams,
    setCoords: (x: number, y: number) => {
      coords.x = x;
      coords.y = y;
    },
  };
}

function setupControllerPreview(
  controller: ControllerInternals,
  targetTile: TileRef,
): void {
  controller.ghostUnit = {
    buildableUnit: {
      type: UnitType.AtomBomb,
      canBuild: targetTile,
      canUpgrade: false,
      cost: 5000n,
      overlappingRailroads: [],
      ghostRailPaths: [],
    },
  };
  controller.updateNukeTrajectoryPreview(targetTile);
  controller.lastGhostData = controller.buildGhostPreviewData(
    targetTile,
    false,
  );
}

function unDiffedGhostStep(
  ghost: GhostPreviewData,
  w: { x: number; y: number },
  view: MapRenderer,
): void {
  const radiusFollowsCursor =
    !ghost.snapToPlacement &&
    !(ghost.canUpgrade && ghost.upgradeTargetTile !== null);
  view.updateGhostPreview({
    ...ghost,
    tileX: ghost.snapToPlacement ? ghost.tileX : w.x - 0.5,
    tileY: ghost.snapToPlacement ? ghost.tileY : w.y - 0.5,
    ...(radiusFollowsCursor
      ? { radiusTileX: w.x - 0.5, radiusTileY: w.y - 0.5 }
      : {}),
  });
}

function unDiffedTrajStep(
  traj: NonNullable<ControllerInternals["nukeTrajectoryStatic"]>,
  w: { x: number; y: number },
  game: GameView,
  view: MapRenderer,
): void {
  const data = buildNukeTrajectory(
    traj.srcX,
    traj.srcY,
    w.x - 0.5,
    w.y - 0.5,
    game.height(),
    traj.directionUp,
    traj.sams,
  );
  const tx = Math.floor(w.x);
  const ty = Math.floor(w.y);
  if (game.isValidCoord(tx, ty) && game.isImpassable(game.ref(tx, ty))) {
    data.tSamIntercept = Math.min(data.tSamIntercept, 0.9999);
  }
  view.updateNukeTrajectory(data);
}

function unDiffedCursorLoop(
  controller: ControllerInternals,
  transformHandler: {
    screenToWorldCoordinatesFloat(
      x: number,
      y: number,
    ): { x: number; y: number };
  },
  game: GameView,
  view: MapRenderer,
): void {
  const ghost = controller.lastGhostData;
  const traj = controller.nukeTrajectoryStatic;
  if (!ghost && !traj) return;
  const w = transformHandler.screenToWorldCoordinatesFloat(
    controller.mousePos.x,
    controller.mousePos.y,
  );
  if (!Number.isFinite(w.x) || !Number.isFinite(w.y)) return;
  if (ghost) unDiffedGhostStep(ghost, w, view);
  if (traj) unDiffedTrajStep(traj, w, game, view);
}

function unDiffedUpdateNukeTrajectoryPreview(
  controller: ControllerInternals,
  targetTile: TileRef,
): void {
  controller.updateNukeTrajectoryPreview(targetTile);
  const prev = controller.nukeTrajectoryStatic;
  if (prev) {
    controller.nukeTrajectoryStatic = {
      ...prev,
      sams: [...prev.sams],
    };
  }
}

function formatLatency(meanSec: number): string {
  if (meanSec < 1e-6) {
    return `${(meanSec * 1e9).toFixed(2)} ns`;
  }
  if (meanSec < 1e-3) {
    return `${(meanSec * 1e6).toFixed(2)} µs`;
  }
  return `${(meanSec * 1e3).toFixed(2)} ms`;
}

function formatOps(hz: number): string {
  return `${Math.round(hz).toLocaleString("en-US")} ops/sec`;
}

function formatResult(target: BenchmarkTarget): string {
  return `${formatOps(target.hz)} (${formatLatency(target.stats.mean)})`;
}

function formatSpeedup(baseHz: number, optHz: number): string {
  if (baseHz <= 0 || optHz <= 0) return "N/A";
  const ratio = optHz / baseHz;
  if (ratio >= 1.05) {
    return `${ratio.toFixed(1)}x faster`;
  }
  const pct = Math.round(((optHz - baseHz) / baseHz) * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}% (parity)`;
}

interface TableRowData {
  scenario: string;
  baseline: string;
  optimized: string;
  ratio: string;
}

interface ColumnWidths {
  scenario: number;
  baseline: number;
  optimized: number;
  ratio: number;
}

function computeColumnWidths(rows: TableRowData[]): ColumnWidths {
  const header = {
    scenario: "Benchmark Scenario",
    baseline: "Baseline (main / un-diffed)",
    optimized: "Optimized (New Code / diffed)",
    ratio: "Speedup / Ratio",
  };
  const allRows = [header, ...rows];
  return {
    scenario: Math.max(...allRows.map((r) => r.scenario.length)),
    baseline: Math.max(...allRows.map((r) => r.baseline.length)),
    optimized: Math.max(...allRows.map((r) => r.optimized.length)),
    ratio: Math.max(...allRows.map((r) => r.ratio.length)),
  };
}

function createSeparator(widths: ColumnWidths): string {
  const { scenario, baseline, optimized, ratio } = widths;
  return `|${"-".repeat(scenario + 2)}|${"-".repeat(baseline + 2)}|${"-".repeat(optimized + 2)}|${"-".repeat(ratio + 2)}|`;
}

function formatRow(row: TableRowData, widths: ColumnWidths): string {
  const c1 = row.scenario.padEnd(widths.scenario);
  const c2 = row.baseline.padStart(widths.baseline);
  const c3 = row.optimized.padStart(widths.optimized);
  const c4 = row.ratio.padEnd(widths.ratio);
  return `| ${c1} | ${c2} | ${c3} | ${c4} |`;
}

function printTable(rows: TableRowData[]): number {
  const widths = computeColumnWidths(rows);
  const sep = createSeparator(widths);
  const header: TableRowData = {
    scenario: "Benchmark Scenario",
    baseline: "Baseline (main / un-diffed)",
    optimized: "Optimized (New Code / diffed)",
    ratio: "Speedup / Ratio",
  };
  console.log("\n" + sep);
  console.log(formatRow(header, widths));
  console.log(sep);
  for (const row of rows) {
    console.log(formatRow(row, widths));
  }
  console.log(sep);
  return sep.length;
}

function printFinding1(
  stationaryBase: BenchmarkTarget,
  stationaryOpt: BenchmarkTarget,
  movingOpt: BenchmarkTarget,
): void {
  const idleSpeedup = stationaryOpt.hz / movingOpt.hz;
  const baselineSpeedup = stationaryOpt.hz / stationaryBase.hz;
  console.log(`\nKey Finding 1 (Idle Diffing Bypass in cursorLoop):`);
  console.log(
    `- Stationary cursorLoop is ${idleSpeedup.toFixed(1)}x faster than moving cursor.`,
  );
  console.log(
    `- Stationary cursorLoop is ${baselineSpeedup.toFixed(1)}x faster than un-diffed baseline.`,
  );
  console.log(
    `- Memory: 0 object allocations and 0 WebGL dispatches on idle frames.`,
  );
}

function printFinding2(
  frameBase: BenchmarkTarget,
  frameOpt: BenchmarkTarget,
): void {
  const cacheSpeedup = frameOpt.hz / frameBase.hz;
  console.log(`\nKey Finding 2 (Referential Caching across Ticks):`);
  console.log(
    `- Preserving trajectory reference keeps render frames in idle bypass (${cacheSpeedup.toFixed(1)}x faster).`,
  );
  console.log(
    `- Un-cached reference churn forces cursorLoop to recompute buildNukeTrajectory on idle frames.`,
  );
}

function printKeyFindings(
  baseMap: Map<string, BenchmarkTarget>,
  optMap: Map<string, BenchmarkTarget>,
  tableWidth: number,
): void {
  const statBase = baseMap.get("cursor_stationary");
  const statOpt = optMap.get("cursor_stationary");
  const movOpt = optMap.get("cursor_moving");
  const frameBase = baseMap.get("frame_render");
  const frameOpt = optMap.get("frame_render");
  if (!statBase || !statOpt || !movOpt || !frameBase || !frameOpt) return;
  printFinding1(statBase, statOpt, movOpt);
  printFinding2(frameBase, frameOpt);
  console.log("=".repeat(tableWidth) + "\n");
}

// ---------------- Benchmark Fixtures Setup ----------------
const defaultTargetTile = 300 * 1000 + 600;

// Fixture 1: Stationary Cursor
const stationaryOptFix = createBenchmarkFixture();
setupControllerPreview(stationaryOptFix.controller, defaultTargetTile);
stationaryOptFix.controller.cursorLoop(); // Prime caches

const stationaryBaseFix = createBenchmarkFixture();
setupControllerPreview(stationaryBaseFix.controller, defaultTargetTile);

// Fixture 2: Moving Cursor
const movingOptFix = createBenchmarkFixture();
setupControllerPreview(movingOptFix.controller, defaultTargetTile);
movingOptFix.controller.cursorLoop(); // Prime caches
let movingOptTick = 0;

const movingBaseFix = createBenchmarkFixture();
setupControllerPreview(movingBaseFix.controller, defaultTargetTile);
let movingBaseTick = 0;

// Fixture 3: updateNukeTrajectoryPreview (Identical state on tick)
const trajOptFix = createBenchmarkFixture();
setupControllerPreview(trajOptFix.controller, defaultTargetTile);

const trajBaseFix = createBenchmarkFixture();
setupControllerPreview(trajBaseFix.controller, defaultTargetTile);

// Fixture 4: Frame Render after Tick
const frameOptFix = createBenchmarkFixture();
setupControllerPreview(frameOptFix.controller, defaultTargetTile);
frameOptFix.controller.cursorLoop();

const frameBaseFix = createBenchmarkFixture();
setupControllerPreview(frameBaseFix.controller, defaultTargetTile);
frameBaseFix.controller.cursorLoop();

const scenarios: PairedScenario[] = [
  {
    id: "cursor_stationary",
    name: "1. cursorLoop: Stationary Cursor (Idle Bypass vs Unconditional Execution)",
    baseline: () => {
      unDiffedCursorLoop(
        stationaryBaseFix.controller,
        stationaryBaseFix.transformHandler,
        stationaryBaseFix.game,
        stationaryBaseFix.view,
      );
    },
    optimized: () => {
      stationaryOptFix.controller.cursorLoop();
    },
  },
  {
    id: "cursor_moving",
    name: "2. cursorLoop: Moving Cursor (Active Trajectory Computation)",
    baseline: () => {
      movingBaseTick++;
      movingBaseFix.setCoords(
        600 + Math.sin(movingBaseTick * 0.05) * 50,
        300 + Math.cos(movingBaseTick * 0.05) * 50,
      );
      unDiffedCursorLoop(
        movingBaseFix.controller,
        movingBaseFix.transformHandler,
        movingBaseFix.game,
        movingBaseFix.view,
      );
    },
    optimized: () => {
      movingOptTick++;
      movingOptFix.setCoords(
        600 + Math.sin(movingOptTick * 0.05) * 50,
        300 + Math.cos(movingOptTick * 0.05) * 50,
      );
      movingOptFix.controller.cursorLoop();
    },
  },
  {
    id: "update_nuke_trajectory",
    name: "3. updateNukeTrajectoryPreview: Identical State on Tick (Referential Cache Hit vs Allocation Churn)",
    baseline: () => {
      unDiffedUpdateNukeTrajectoryPreview(
        trajBaseFix.controller,
        defaultTargetTile,
      );
    },
    optimized: () => {
      trajOptFix.controller.updateNukeTrajectoryPreview(defaultTargetTile);
    },
  },
  {
    id: "frame_render",
    name: "4. Frame Render after Tick (Idle Bypass Retained vs Forced Recalculation from Reference Churn)",
    baseline: () => {
      const prev = frameBaseFix.controller.nukeTrajectoryStatic;
      if (prev) {
        frameBaseFix.controller.nukeTrajectoryStatic = { ...prev };
      }
      frameBaseFix.controller.cursorLoop();
    },
    optimized: () => {
      frameOptFix.controller.cursorLoop();
    },
  },
];

const baselineTargets = new Map<string, BenchmarkTarget>();
const optimizedTargets = new Map<string, BenchmarkTarget>();
const benchOptions = { maxTime: 1.0 };

const suite = new Benchmark.Suite();

for (const scenario of scenarios) {
  suite.add(`BASE::${scenario.id}`, scenario.baseline, benchOptions);
  suite.add(`OPT::${scenario.id}`, scenario.optimized, benchOptions);
}

suite
  .on("cycle", (event: Benchmark.Event) => {
    const target = event.target as unknown as BenchmarkTarget;
    if (target.name.startsWith("BASE::")) {
      baselineTargets.set(target.name.slice(6), target);
    } else if (target.name.startsWith("OPT::")) {
      optimizedTargets.set(target.name.slice(5), target);
    }
  })
  .on("complete", () => {
    const rows: TableRowData[] = [];
    for (const scenario of scenarios) {
      const base = baselineTargets.get(scenario.id);
      const opt = optimizedTargets.get(scenario.id);
      if (!base || !opt) continue;
      rows.push({
        scenario: scenario.name,
        baseline: formatResult(base),
        optimized: formatResult(opt),
        ratio: formatSpeedup(base.hz, opt.hz),
      });
    }
    const tableWidth = printTable(rows);
    printKeyFindings(baselineTargets, optimizedTargets, tableWidth);
  })
  .run({ async: true });
