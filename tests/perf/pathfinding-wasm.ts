/**
 * Benchmark comparing WASM vs TypeScript pathfinding implementations
 *
 * Run with: npx tsx tests/perf/pathfinding-wasm.ts
 */

import { AStarWater as AStarWaterTS } from "../../src/core/pathfinding/algorithms/AStar.Water";
import { AStarRail as AStarRailTS } from "../../src/core/pathfinding/algorithms/AStar.Rail";
import { AStarWaterBounded as AStarWaterBoundedTS } from "../../src/core/pathfinding/algorithms/AStar.WaterBounded";

// Simple mock GameMap for benchmarking
class MockGameMap {
  private _terrain: Uint8Array;
  private _width: number;
  private _height: number;

  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;

    // Create terrain data with mostly water (magnitude 5)
    // and some land obstacles
    this._terrain = new Uint8Array(width * height);

    for (let i = 0; i < this._terrain.length; i++) {
      // 5 = moderate depth water
      this._terrain[i] = 5;
    }

    // Add some land obstacles (set bit 7)
    const landBit = 1 << 7;
    for (let y = height / 4; y < (3 * height) / 4; y++) {
      // Vertical wall with gaps
      if (y % 10 !== 0) {
        const x = Math.floor(width / 2);
        this._terrain[y * width + x] = 5 | landBit;
      }
    }
  }

  get terrain(): Uint8Array {
    return this._terrain;
  }

  width(): number {
    return this._width;
  }

  height(): number {
    return this._height;
  }

  // Rail pathfinding needs isShoreline and isWater
  isShoreline(ref: number): boolean {
    return (this._terrain[ref] & (1 << 6)) !== 0;
  }

  isWater(ref: number): boolean {
    return (this._terrain[ref] & (1 << 7)) === 0;
  }
}

// Mock map for rail benchmarking (mostly land with some water)
class MockRailGameMap {
  private _terrain: Uint8Array;
  private _width: number;
  private _height: number;

  constructor(width: number, height: number) {
    this._width = width;
    this._height = height;

    // Create terrain data with mostly land (bit 7 set)
    this._terrain = new Uint8Array(width * height);
    const landBit = 1 << 7;

    for (let i = 0; i < this._terrain.length; i++) {
      this._terrain[i] = landBit;
    }

    // Add some water obstacles with shorelines
    const shorelineBit = 1 << 6;
    for (let y = height / 4; y < (3 * height) / 4; y++) {
      // Vertical water strip with gaps
      if (y % 15 !== 0) {
        const x = Math.floor(width / 2);
        // Add shoreline tiles adjacent to water
        if (y === Math.floor(height / 4) || y === Math.floor((3 * height) / 4) - 1) {
          this._terrain[y * width + x] = shorelineBit; // Water with shoreline
        } else {
          this._terrain[y * width + x] = 0; // Pure water
        }
      }
    }
  }

  get terrain(): Uint8Array {
    return this._terrain;
  }

  width(): number {
    return this._width;
  }

  height(): number {
    return this._height;
  }

  isShoreline(ref: number): boolean {
    return (this._terrain[ref] & (1 << 6)) !== 0;
  }

  isWater(ref: number): boolean {
    return (this._terrain[ref] & (1 << 7)) === 0;
  }
}

async function runBenchmark() {
  console.log("=".repeat(60));
  console.log("Pathfinding WASM vs TypeScript Benchmark");
  console.log("=".repeat(60));
  console.log();

  // Create test map
  const width = 1000;
  const height = 1000;
  const map = new MockGameMap(width, height);
  console.log(`Map size: ${width}x${height} (${width * height} tiles)`);
  console.log();

  // Create TypeScript pathfinder
  const tsPf = new AStarWaterTS(map as any);

  // Create test cases (start, goal) pairs
  const testCases = [
    { name: "Short path", start: 0, goal: 100 },
    { name: "Medium path", start: 0, goal: width * 100 + 100 },
    { name: "Long path across map", start: 0, goal: (height - 1) * width + (width - 1) },
    { name: "Path around obstacle", start: width * (height / 2) + 10, goal: width * (height / 2) + (width - 10) },
  ];

  // Warmup
  console.log("Warming up TypeScript implementation...");
  for (let i = 0; i < 10; i++) {
    tsPf.findPath(0, width * 50 + 50);
  }

  // Try to load WASM
  let wasmPf: any = null;
  let wasmAvailable = false;

  try {
    console.log("\nLoading WASM module...");
    const fs = await import("fs");
    const path = await import("path");
    const url = await import("url");

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const wasmPath = path.join(__dirname, "../../rust/wasm-core/pkg/wasm_core_bg.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);

    const wasm = await import("../../rust/wasm-core/pkg/wasm_core.js");
    wasm.initSync({ module: wasmBuffer });
    wasm.init();

    wasmPf = new wasm.AStarWater(
      map.terrain,
      width,
      height,
      null, // default heuristic weight
      null, // default max iterations
    );
    wasmAvailable = true;
    console.log("WASM module loaded successfully!");

    // Warmup WASM
    console.log("Warming up WASM implementation...");
    for (let i = 0; i < 10; i++) {
      wasmPf.findPath(0, width * 50 + 50);
    }
  } catch (err) {
    console.log("WASM module not available:", err);
    console.log("Run 'npm run wasm:build' first to build the WASM module.");
  }

  console.log();
  console.log("-".repeat(60));
  console.log("Results:");
  console.log("-".repeat(60));

  const iterations = 100;

  for (const tc of testCases) {
    console.log(`\n${tc.name}:`);

    // TypeScript benchmark
    const tsStart = performance.now();
    let tsPath: number[] | null = null;
    for (let i = 0; i < iterations; i++) {
      tsPath = tsPf.findPath(tc.start, tc.goal);
    }
    const tsEnd = performance.now();
    const tsTime = (tsEnd - tsStart) / iterations;

    console.log(`  TypeScript: ${tsTime.toFixed(3)}ms avg (${iterations} iterations)`);
    if (tsPath) {
      console.log(`    Path length: ${tsPath.length} tiles`);
    } else {
      console.log("    No path found");
    }

    // WASM benchmark
    if (wasmAvailable && wasmPf) {
      const wasmStart = performance.now();
      let wasmPath: Uint32Array | undefined = undefined;
      for (let i = 0; i < iterations; i++) {
        wasmPath = wasmPf.findPath(tc.start, tc.goal);
      }
      const wasmEnd = performance.now();
      const wasmTime = (wasmEnd - wasmStart) / iterations;

      console.log(`  WASM:       ${wasmTime.toFixed(3)}ms avg (${iterations} iterations)`);
      if (wasmPath) {
        console.log(`    Path length: ${wasmPath.length} tiles`);
      } else {
        console.log("    No path found");
      }

      // Compare
      const speedup = tsTime / wasmTime;
      if (speedup > 1) {
        console.log(`  \x1b[32mWASM is ${speedup.toFixed(2)}x faster\x1b[0m`);
      } else {
        console.log(`  \x1b[33mTypeScript is ${(1 / speedup).toFixed(2)}x faster\x1b[0m`);
      }
    }
  }

  // Cleanup water pathfinder
  if (wasmPf && typeof wasmPf.free === "function") {
    wasmPf.free();
  }

  // ============================================================
  // Rail Pathfinding Benchmark
  // ============================================================
  console.log();
  console.log("=".repeat(60));
  console.log("Rail Pathfinding Benchmark");
  console.log("=".repeat(60));
  console.log();

  // Create rail test map (mostly land)
  const railMap = new MockRailGameMap(width, height);
  console.log(`Rail Map size: ${width}x${height} (${width * height} tiles)`);
  console.log();

  // Create TypeScript rail pathfinder
  const tsRailPf = new AStarRailTS(railMap as any);

  // Rail test cases
  const railTestCases = [
    { name: "Short path (land)", start: 0, goal: 100 },
    { name: "Medium path (land)", start: 0, goal: width * 100 + 100 },
    { name: "Long path across map", start: 0, goal: (height - 1) * width + (width - 1) },
    { name: "Path around water", start: width * (height / 2) + 10, goal: width * (height / 2) + (width - 10) },
  ];

  // Warmup TypeScript
  console.log("Warming up TypeScript Rail implementation...");
  for (let i = 0; i < 10; i++) {
    tsRailPf.findPath(0, width * 50 + 50);
  }

  // Try to load WASM Rail pathfinder
  let wasmRailPf: any = null;
  let wasmRailAvailable = false;

  try {
    console.log("\nLoading WASM Rail module...");
    const fs = await import("fs");
    const path = await import("path");
    const url = await import("url");

    const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
    const wasmPath = path.join(__dirname, "../../rust/wasm-core/pkg/wasm_core_bg.wasm");
    const wasmBuffer = fs.readFileSync(wasmPath);

    const wasm = await import("../../rust/wasm-core/pkg/wasm_core.js");
    // WASM already initialized from water benchmark

    wasmRailPf = new wasm.AStarRail(
      railMap.terrain,
      width,
      height,
      null, // default max iterations
    );
    wasmRailAvailable = true;
    console.log("WASM Rail module loaded successfully!");

    // Warmup WASM Rail
    console.log("Warming up WASM Rail implementation...");
    for (let i = 0; i < 10; i++) {
      wasmRailPf.findPath(0, width * 50 + 50);
    }
  } catch (err) {
    console.log("WASM Rail module not available:", err);
  }

  console.log();
  console.log("-".repeat(60));
  console.log("Rail Results:");
  console.log("-".repeat(60));

  for (const tc of railTestCases) {
    console.log(`\n${tc.name}:`);

    // TypeScript benchmark
    const tsStart = performance.now();
    let tsPath: number[] | null = null;
    for (let i = 0; i < iterations; i++) {
      tsPath = tsRailPf.findPath(tc.start, tc.goal);
    }
    const tsEnd = performance.now();
    const tsTime = (tsEnd - tsStart) / iterations;

    console.log(`  TypeScript: ${tsTime.toFixed(3)}ms avg (${iterations} iterations)`);
    if (tsPath) {
      console.log(`    Path length: ${tsPath.length} tiles`);
    } else {
      console.log("    No path found");
    }

    // WASM benchmark
    if (wasmRailAvailable && wasmRailPf) {
      const wasmStart = performance.now();
      let wasmPath: Uint32Array | undefined = undefined;
      for (let i = 0; i < iterations; i++) {
        wasmPath = wasmRailPf.findPath(tc.start, tc.goal);
      }
      const wasmEnd = performance.now();
      const wasmTime = (wasmEnd - wasmStart) / iterations;

      console.log(`  WASM:       ${wasmTime.toFixed(3)}ms avg (${iterations} iterations)`);
      if (wasmPath) {
        console.log(`    Path length: ${wasmPath.length} tiles`);
      } else {
        console.log("    No path found");
      }

      // Compare
      const speedup = tsTime / wasmTime;
      if (speedup > 1) {
        console.log(`  \x1b[32mWASM is ${speedup.toFixed(2)}x faster\x1b[0m`);
      } else {
        console.log(`  \x1b[33mTypeScript is ${(1 / speedup).toFixed(2)}x faster\x1b[0m`);
      }
    }
  }

  // Cleanup rail pathfinder
  if (wasmRailPf && typeof wasmRailPf.free === "function") {
    wasmRailPf.free();
  }

  // ============================================================
  // Water Bounded Pathfinding Benchmark
  // ============================================================
  console.log();
  console.log("=".repeat(60));
  console.log("Water Bounded Pathfinding Benchmark");
  console.log("=".repeat(60));
  console.log();

  // Use original water map for bounded tests
  const boundedMaxArea = 100 * 100; // Same as LOCAL_ASTAR_MAX_AREA
  console.log(`Max search area: ${boundedMaxArea} tiles`);
  console.log();

  // Create TypeScript bounded pathfinder
  const tsBoundedPf = new AStarWaterBoundedTS(map as any, boundedMaxArea);

  // Bounded test cases - using searchBounded with explicit bounds
  const boundedTestCases = [
    {
      name: "Small bounded region (50x50)",
      start: width * 100 + 100,
      goal: width * 140 + 140,
      bounds: { minX: 90, maxX: 150, minY: 90, maxY: 150 },
    },
    {
      name: "Medium bounded region (80x80)",
      start: width * 100 + 100,
      goal: width * 160 + 160,
      bounds: { minX: 80, maxX: 180, minY: 80, maxY: 180 },
    },
    {
      name: "Large bounded region (100x100)",
      start: width * 50 + 50,
      goal: width * 140 + 140,
      bounds: { minX: 40, maxX: 150, minY: 40, maxY: 150 },
    },
    {
      name: "Multi-start bounded search",
      start: [width * 100 + 100, width * 100 + 110, width * 110 + 100],
      goal: width * 140 + 140,
      bounds: { minX: 90, maxX: 150, minY: 90, maxY: 150 },
    },
  ];

  // Warmup TypeScript bounded
  console.log("Warming up TypeScript Bounded implementation...");
  for (let i = 0; i < 10; i++) {
    tsBoundedPf.searchBounded(
      width * 100 + 100,
      width * 140 + 140,
      { minX: 90, maxX: 150, minY: 90, maxY: 150 },
    );
  }

  // Try to load WASM bounded pathfinder
  let wasmBoundedPf: any = null;
  let wasmBoundedAvailable = false;

  try {
    console.log("\nLoading WASM Bounded module...");
    const wasm = await import("../../rust/wasm-core/pkg/wasm_core.js");
    // WASM already initialized

    wasmBoundedPf = new wasm.AStarWaterBounded(
      map.terrain,
      width,
      height,
      boundedMaxArea,
      null, // default heuristic weight
      null, // default max iterations
    );
    wasmBoundedAvailable = true;
    console.log("WASM Bounded module loaded successfully!");

    // Warmup WASM bounded
    console.log("Warming up WASM Bounded implementation...");
    for (let i = 0; i < 10; i++) {
      wasmBoundedPf.searchBounded(
        width * 100 + 100,
        width * 140 + 140,
        90, 150, 90, 150,
      );
    }
  } catch (err) {
    console.log("WASM Bounded module not available:", err);
  }

  console.log();
  console.log("-".repeat(60));
  console.log("Bounded Results:");
  console.log("-".repeat(60));

  for (const tc of boundedTestCases) {
    console.log(`\n${tc.name}:`);

    // TypeScript benchmark
    const tsStart = performance.now();
    let tsPath: number[] | null = null;
    for (let i = 0; i < iterations; i++) {
      if (Array.isArray(tc.start)) {
        tsPath = tsBoundedPf.searchBounded(tc.start as number[], tc.goal, tc.bounds);
      } else {
        tsPath = tsBoundedPf.searchBounded(tc.start, tc.goal, tc.bounds);
      }
    }
    const tsEnd = performance.now();
    const tsTime = (tsEnd - tsStart) / iterations;

    console.log(`  TypeScript: ${tsTime.toFixed(3)}ms avg (${iterations} iterations)`);
    if (tsPath) {
      console.log(`    Path length: ${tsPath.length} tiles`);
    } else {
      console.log("    No path found");
    }

    // WASM benchmark
    if (wasmBoundedAvailable && wasmBoundedPf) {
      const wasmStart = performance.now();
      let wasmPath: Uint32Array | undefined = undefined;
      for (let i = 0; i < iterations; i++) {
        if (Array.isArray(tc.start)) {
          const starts = new Uint32Array(tc.start);
          wasmPath = wasmBoundedPf.searchBoundedMulti(
            starts,
            tc.goal,
            tc.bounds.minX,
            tc.bounds.maxX,
            tc.bounds.minY,
            tc.bounds.maxY,
          );
        } else {
          wasmPath = wasmBoundedPf.searchBounded(
            tc.start,
            tc.goal,
            tc.bounds.minX,
            tc.bounds.maxX,
            tc.bounds.minY,
            tc.bounds.maxY,
          );
        }
      }
      const wasmEnd = performance.now();
      const wasmTime = (wasmEnd - wasmStart) / iterations;

      console.log(`  WASM:       ${wasmTime.toFixed(3)}ms avg (${iterations} iterations)`);
      if (wasmPath) {
        console.log(`    Path length: ${wasmPath.length} tiles`);
      } else {
        console.log("    No path found");
      }

      // Compare
      const speedup = tsTime / wasmTime;
      if (speedup > 1) {
        console.log(`  \x1b[32mWASM is ${speedup.toFixed(2)}x faster\x1b[0m`);
      } else {
        console.log(`  \x1b[33mTypeScript is ${(1 / speedup).toFixed(2)}x faster\x1b[0m`);
      }
    }
  }

  // Cleanup bounded pathfinder
  if (wasmBoundedPf && typeof wasmBoundedPf.free === "function") {
    wasmBoundedPf.free();
  }

  console.log();
  console.log("=".repeat(60));
  console.log("Benchmark complete");
  console.log("=".repeat(60));
}

runBenchmark().catch(console.error);
