/**
 * SAM Radius Main-Thread CPU Geometry & Buffer Packing Benchmark.
 *
 * Measures CPU overhead on the main JavaScript thread before WebGL draw:
 *   - Tests 100 SAM launchers in heavy overlapping cluster formation
 *   - Continuous sub-tick range interpolation at 60 / 144 FPS
 *   - 2D Circle Union Geometry (computeUncoveredArcs, angular interval merge)
 *   - Layer 0 (active operating radius) vs. Layer 1 (preview network) separation
 *   - 10-float GPU instance buffer packing ([x, y, radius, r, g, b, alpha, arcStart, arcEnd, spin])
 *
 * Usage:
 *   npx vitest run tests/perf/client/SamRadiusPassPerf.test.ts
 */
import "./Shims"; // Browser-global shims for client code

import { performance } from "perf_hooks";
import { describe, expect, it } from "vitest";
import { SAMRadiusPass } from "../../../src/client/render/gl/passes/SamRadiusPass";
import { createRenderSettings } from "../../../src/client/render/gl/RenderSettings";
import { UnitState } from "../../../src/client/render/types/Renderer";
import { UnitType } from "../../../src/core/game/Game";
import { GcTracker, summarizeGcEvents } from "../fullgame/GcProfiler";
import { TickStats } from "../fullgame/Profiler";

// ── WebGL2 Headless Context Stub ──

function createWebGL2Stub(): WebGL2RenderingContext {
  const dummyProgram = {} as WebGLProgram;
  const dummyBuffer = {} as WebGLBuffer;
  const dummyVao = {} as WebGLVertexArrayObject;
  const dummyLocation = {} as WebGLUniformLocation;
  const dummyShader = {} as WebGLShader;

  const gl = {
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    TRIANGLE_STRIP: 0x0005,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,

    createProgram: () => dummyProgram,
    createShader: () => dummyShader,
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    getShaderInfoLog: () => "",
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    getProgramInfoLog: () => "",
    useProgram: () => {},
    deleteShader: () => {},

    createBuffer: () => dummyBuffer,
    bindBuffer: () => {},
    bufferData: () => {},
    bufferSubData: () => {},

    createVertexArray: () => dummyVao,
    bindVertexArray: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribDivisor: () => {},

    getUniformLocation: () => dummyLocation,
    uniform1f: () => {},
    uniform2f: () => {},
    uniform4f: () => {},
    uniformMatrix3fv: () => {},

    drawArraysInstanced: () => {},
  } as unknown as WebGL2RenderingContext;

  return gl;
}

// ── Formatting Utilities ──

function fmtMs(ms: number): string {
  return ms >= 100 ? ms.toFixed(0) : ms >= 10 ? ms.toFixed(1) : ms.toFixed(3);
}

function fmtMB(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 100 ? mb.toFixed(0) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
}

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, c) => cell.padEnd(widths[c])).join("  ");
  return [line(headers), line(widths.map((w) => "-".repeat(w)))]
    .concat(rows.map(line))
    .join("\n");
}

// ── Mock Structure Factory ──

function createMockSAMStructures(
  samCount: number,
  mapWidth: number,
): Map<number, UnitState> {
  const structures = new Map<number, UnitState>();
  const startX = 50;
  const startY = 50;

  for (let i = 0; i < samCount; i++) {
    // Dense 10x10 cluster formation with heavily intersecting radii
    const x = startX + (i % 10) * 12;
    const y = startY + Math.floor(i / 10) * 12;
    const pos = y * mapWidth + x;
    const ownerID = i < samCount / 2 ? 1 : 2;

    const isUpgrading = i % 3 === 0;
    const level = 1 + (i % 4);

    const state: UnitState = {
      id: 1000 + i,
      ownerID,
      lastOwnerID: null,
      unitType: UnitType.SAMLauncher,
      pos,
      lastPos: pos,
      isActive: true,
      reachedTarget: false,
      retreating: false,
      targetable: false,
      waitTicks: 0,
      markedForDeletion: false,
      health: 100,
      underConstruction: false,
      constructionStartTick: null,
      targetUnitId: null,
      targetTile: null,
      troops: 0,
      missileTimerQueue: [],
      level,
      veterancy: 0,
      hasTrainStation: false,
      trainType: 0,
      loaded: null,
      samUpgradeStartTick: isUpgrading ? (i * 7) % 50 : null,
      samUpgradeStartRange: isUpgrading ? 70 + (level - 1) * 16 : null,
      samUpgradeTargetLevel: isUpgrading ? level + 1 : null,
      samUpgradeDuration: isUpgrading ? 45 : null,
    };

    structures.set(state.id, state);
  }

  return structures;
}

describe("SAMRadiusPass WebGL Performance", () => {
  it("profiles 100 SAMs under continuous 60 FPS sub-tick frame rendering", async () => {
    const FRAMES = 1000;
    const SAM_COUNT = 100;
    const MAP_WIDTH = 500;
    const BUDGET_60FPS_MS = 16.67;
    const BUDGET_144FPS_MS = 6.94;

    const gl = createWebGL2Stub();
    const settings = createRenderSettings();
    const pass = new SAMRadiusPass(gl, MAP_WIDTH, settings);

    pass.setLocalPlayer(1);
    pass.setAllies(new Set([1]));
    pass.setColorMode("owner");
    pass.setVisible(true);

    const allianceClusters = new Map<number, number>([
      [1, 1], // Friendly cluster
      [2, 2], // Enemy cluster
    ]);
    pass.setAllianceClusters(allianceClusters);

    const structures = createMockSAMStructures(SAM_COUNT, MAP_WIDTH);
    pass.updateStructures(structures);

    const cameraMatrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

    const frameStats = new TickStats();
    let gcTracker: GcTracker | null = null;
    try {
      gcTracker = new GcTracker();
      gcTracker.start();
    } catch {
      // GC observer fallback
    }

    let heapPeak = process.memoryUsage().heapUsed;
    const wallStart = performance.now();

    for (let frame = 1; frame <= FRAMES; frame++) {
      const tick = Math.floor(frame / 6);
      pass.setTick(tick);

      const t0 = performance.now();
      pass.draw(cameraMatrix);
      const dt = performance.now() - t0;
      frameStats.record(frame, dt);

      const mem = process.memoryUsage().heapUsed;
      if (mem > heapPeak) heapPeak = mem;
    }

    const totalWallMs = performance.now() - wallStart;
    const summary = frameStats.summarize(1.0); // 1.0ms frame slice budget
    const over1ms = summary.overBudget;
    const gcEvents = gcTracker ? await gcTracker.stop() : [];

    // ── Print Performance Report ──

    console.log(`\n${"=".repeat(72)}`);
    console.log(
      `SAM Radius WebGL Render Pass Perf: ${SAM_COUNT} SAMs, ${FRAMES} Frames (60/144 FPS simulation)`,
    );
    console.log("=".repeat(72));

    console.log(`\n--- Frame Rendering Performance (Client Main Thread) ---`);
    console.log(
      `Total: ${fmtMs(summary.totalMs)}ms render time over ${fmtMs(totalWallMs)}ms wall ` +
        `(${(FRAMES / (totalWallMs / 1000)).toFixed(0)} FPS throughput capacity)`,
    );
    console.log(
      `mean ${fmtMs(summary.meanMs)}ms | p50 ${fmtMs(summary.p50Ms)}ms | ` +
        `p95 ${fmtMs(summary.p95Ms)}ms | p99 ${fmtMs(summary.p99Ms)}ms | ` +
        `max ${fmtMs(summary.maxMs)}ms`,
    );
    console.log(
      `60 FPS Frame Budget (16.7ms): ${((summary.meanMs / BUDGET_60FPS_MS) * 100).toFixed(2)}% consumed`,
    );
    console.log(
      `144 FPS Frame Budget (6.9ms):  ${((summary.meanMs / BUDGET_144FPS_MS) * 100).toFixed(2)}% consumed`,
    );
    console.log(`Frames Exceeding 1.0ms:        ${over1ms} / ${FRAMES}`);
    console.log(
      `Slowest frames: ` +
        summary.slowest
          .slice(0, 5)
          .map((s) => `#${s.tick} (${fmtMs(s.ms)}ms)`)
          .join(", "),
    );

    console.log(`\n--- Memory & GPU Buffering ---`);
    console.log(`Peak heap:             ${fmtMB(heapPeak)} MB`);
    console.log(
      `Instance buffer layout:10 floats/quad ([pos, col, arcs, spin])`,
    );

    if (gcEvents.length > 0) {
      const gc = summarizeGcEvents(gcEvents);
      console.log(`\n--- GC Pauses during Rendering ---`);
      console.log(
        table(
          ["kind", "count", "total ms", "avg ms", "max ms"],
          (["minor", "major", "incremental", "weakcb", "all"] as const).map(
            (kind) => [
              kind,
              String(gc[kind].count),
              fmtMs(gc[kind].totalMs),
              fmtMs(gc[kind].count > 0 ? gc[kind].totalMs / gc[kind].count : 0),
              fmtMs(gc[kind].maxMs),
            ],
          ),
        ),
      );
    }
    console.log("=".repeat(72) + "\n");

    expect(summary.meanMs).toBeLessThan(1.0);
    expect(over1ms).toBeLessThan(FRAMES * 0.05);
  });
});
