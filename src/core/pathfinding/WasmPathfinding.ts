/**
 * WASM-based pathfinding implementations
 *
 * This module provides WASM-accelerated pathfinding algorithms
 * that replace the TypeScript implementations for better performance.
 */

import type { GameMap, TileRef } from "../game/GameMap";
import type { PathFinder } from "./types";

// WASM module types (imported dynamically)
type WasmModule = typeof import("wasm-core");

// Singleton for WASM module instance
let wasmModule: WasmModule | null = null;
let wasmInitPromise: Promise<WasmModule> | null = null;

/**
 * Initialize the WASM module
 * Must be called before using any WASM pathfinding functions
 */
export async function initWasm(): Promise<WasmModule> {
  if (wasmModule) {
    return wasmModule;
  }

  if (wasmInitPromise) {
    return wasmInitPromise;
  }

  wasmInitPromise = (async () => {
    const wasm = await import("wasm-core");
    await wasm.default();
    wasm.init(); // Initialize panic hook
    wasmModule = wasm;
    return wasm;
  })();

  return wasmInitPromise;
}

/**
 * Check if WASM is initialized
 */
export function isWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Get the WASM module (throws if not initialized)
 */
export function getWasmModule(): WasmModule {
  if (!wasmModule) {
    throw new Error("WASM module not initialized. Call initWasm() first.");
  }
  return wasmModule;
}

/**
 * WASM-accelerated A* water pathfinder
 * Drop-in replacement for the TypeScript AStarWater implementation
 */
export class AStarWaterWasm implements PathFinder<number> {
  private inner: InstanceType<WasmModule["AStarWater"]>;

  constructor(map: GameMap, heuristicWeight?: number, maxIterations?: number) {
    const wasm = getWasmModule();

    // Access terrain data from the map
    // Note: GameMap stores terrain as Uint8Array internally
    const terrain = (map as unknown as { terrain: Uint8Array }).terrain;
    const width = map.width();
    const height = map.height();

    this.inner = new wasm.AStarWater(
      terrain,
      width,
      height,
      heuristicWeight ?? null,
      maxIterations ?? null,
    );
  }

  findPath(from: number | number[], to: number): number[] | null {
    let result: Uint32Array | undefined;

    if (Array.isArray(from)) {
      const starts = new Uint32Array(from);
      result = this.inner.findPathMulti(starts, to);
    } else {
      result = this.inner.findPath(from, to);
    }

    if (!result) {
      return null;
    }

    // Convert Uint32Array to number[] for compatibility
    return Array.from(result) as TileRef[];
  }

  /**
   * Free the WASM memory when done
   * Call this when the pathfinder is no longer needed
   */
  dispose(): void {
    this.inner.free();
  }
}

/**
 * WASM-accelerated A* rail pathfinder
 * Drop-in replacement for the TypeScript AStarRail implementation
 */
export class AStarRailWasm implements PathFinder<number> {
  private inner: InstanceType<WasmModule["AStarRail"]>;

  constructor(map: GameMap, maxIterations?: number) {
    const wasm = getWasmModule();

    // Access terrain data from the map
    const terrain = (map as unknown as { terrain: Uint8Array }).terrain;
    const width = map.width();
    const height = map.height();

    this.inner = new wasm.AStarRail(
      terrain,
      width,
      height,
      maxIterations ?? null,
    );
  }

  findPath(from: number | number[], to: number): number[] | null {
    let result: Uint32Array | undefined;

    if (Array.isArray(from)) {
      const starts = new Uint32Array(from);
      result = this.inner.findPathMulti(starts, to);
    } else {
      result = this.inner.findPath(from, to);
    }

    if (!result) {
      return null;
    }

    // Convert Uint32Array to number[] for compatibility
    return Array.from(result) as TileRef[];
  }

  /**
   * Free the WASM memory when done
   * Call this when the pathfinder is no longer needed
   */
  dispose(): void {
    this.inner.free();
  }
}

/**
 * Search bounds for bounded A* search
 */
export interface SearchBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * WASM-accelerated A* water pathfinder with bounded search
 * Drop-in replacement for the TypeScript AStarWaterBounded implementation
 */
export class AStarWaterBoundedWasm implements PathFinder<number> {
  private inner: InstanceType<WasmModule["AStarWaterBounded"]>;

  constructor(
    map: GameMap,
    maxSearchArea: number,
    config?: { heuristicWeight?: number; maxIterations?: number },
  ) {
    const wasm = getWasmModule();

    // Access terrain data from the map
    const terrain = (map as unknown as { terrain: Uint8Array }).terrain;
    const width = map.width();
    const height = map.height();

    this.inner = new wasm.AStarWaterBounded(
      terrain,
      width,
      height,
      maxSearchArea,
      config?.heuristicWeight ?? null,
      config?.maxIterations ?? null,
    );
  }

  findPath(from: number | number[], to: number): number[] | null {
    let result: Uint32Array | undefined;

    if (Array.isArray(from)) {
      const starts = new Uint32Array(from);
      result = this.inner.findPathMulti(starts, to);
    } else {
      result = this.inner.findPath(from, to);
    }

    if (!result) {
      return null;
    }

    return Array.from(result) as TileRef[];
  }

  /**
   * Search within explicit bounds
   */
  searchBounded(
    start: TileRef | TileRef[],
    goal: TileRef,
    bounds: SearchBounds,
  ): TileRef[] | null {
    let result: Uint32Array | undefined;

    if (Array.isArray(start)) {
      const starts = new Uint32Array(start);
      result = this.inner.searchBoundedMulti(
        starts,
        goal,
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
      );
    } else {
      result = this.inner.searchBounded(
        start,
        goal,
        bounds.minX,
        bounds.maxX,
        bounds.minY,
        bounds.maxY,
      );
    }

    if (!result) {
      return null;
    }

    return Array.from(result) as TileRef[];
  }

  /**
   * Free the WASM memory when done
   */
  dispose(): void {
    this.inner.free();
  }
}

/**
 * WASM-accelerated MinHeap priority queue
 * Drop-in replacement for the TypeScript MinHeap implementation
 */
export class MinHeapWasm {
  private inner: InstanceType<WasmModule["MinHeap"]>;

  constructor(capacity: number) {
    const wasm = getWasmModule();
    this.inner = new wasm.MinHeap(capacity);
  }

  push(node: number, priority: number): void {
    this.inner.push(node, priority);
  }

  pop(): number {
    return this.inner.pop();
  }

  isEmpty(): boolean {
    return this.inner.isEmpty();
  }

  clear(): void {
    this.inner.clear();
  }

  get size(): number {
    return this.inner.len();
  }

  /**
   * Free the WASM memory when done
   */
  dispose(): void {
    this.inner.free();
  }
}

/**
 * Test function to verify WASM is working
 */
export function testWasm(): { greeting: string; sum: number } {
  const wasm = getWasmModule();
  return {
    greeting: wasm.greet("OpenFront"),
    sum: wasm.add(40, 2),
  };
}
