import { Cell, TerrainType } from "./GameTypes";

export type TileRef = number;

export interface GameMap {
  ref(x: number, y: number): TileRef;
  isValidRef(ref: TileRef): boolean;
  x(ref: TileRef): number;
  y(ref: TileRef): number;
  cell(ref: TileRef): Cell;
  width(): number;
  height(): number;
  numLandTiles(): number;

  isValidCoord(x: number, y: number): boolean;
  // Terrain getters
  isLand(ref: TileRef): boolean;
  isImpassable(ref: TileRef): boolean;
  isOceanShore(ref: TileRef): boolean;
  isOcean(ref: TileRef): boolean;
  isShoreline(ref: TileRef): boolean;
  magnitude(ref: TileRef): number;
  terrainByte(ref: TileRef): number;
  // Terrain setters
  setWater(ref: TileRef): void;
  /** Bumped every time a land tile turns to water; lets callers cache anything derived from water components. */
  waterVersion(): number;
  setShorelineBit(ref: TileRef): void;
  clearShorelineBit(ref: TileRef): void;
  setOcean(ref: TileRef): void;
  setMagnitude(ref: TileRef, value: number): void;
  // State getters and setters (mutable)
  ownerID(ref: TileRef): number;
  hasOwner(ref: TileRef): boolean;

  setOwnerID(ref: TileRef, playerId: number): void;
  hasFallout(ref: TileRef): boolean;
  setFallout(ref: TileRef, value: boolean): void;
  isOnEdgeOfMap(ref: TileRef): boolean;
  isBorder(ref: TileRef): boolean;
  neighbors(ref: TileRef): TileRef[];
  // Zero-allocation neighbor iteration (cardinal only), in the same N, S, W, E
  // order as neighbors(). All cardinal-neighbor helpers share this order so
  // they are interchangeable even in order-sensitive simulation code.
  forEachNeighbor(ref: TileRef, callback: (neighbor: TileRef) => void): void;
  // Writes the cardinal neighbors of ref into out (same N, S, W, E order as
  // neighbors()) and returns the count. out must have length >= 4; reuse it
  // across calls to avoid allocation in hot loops.
  neighbors4(ref: TileRef, out: TileRef[]): number;
  neighbors8(ref: TileRef, out: TileRef[]): number;
  // Zero-allocation neighbor iteration including diagonals, in dx-major
  // order: (-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1).
  forEachNeighborWithDiag(
    ref: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;
  isWater(ref: TileRef): boolean;
  isShore(ref: TileRef): boolean;
  cost(ref: TileRef): number;
  terrainType(ref: TileRef): TerrainType;
  forEachTile(fn: (tile: TileRef) => void): void;

  manhattanDist(c1: TileRef, c2: TileRef): number;
  euclideanDistSquared(c1: TileRef, c2: TileRef): number;
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef>;
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef>;

  /**
   * Returns the packed per-tile state as an unsigned 16-bit value (`0..65535`).
   *
   * Backed by a `Uint16Array` in `GameMapImpl`, so callers must treat this as `uint16`.
   */
  tileState(tile: TileRef): number;

  /**
   * Applies a packed per-tile state value.
   *
   * `state` must be an unsigned 16-bit value (`0..65535`). Implementations may
   * store this in a `Uint16Array` and will truncate higher bits if provided.
   *
   * Returns `true` when the terrain byte changed (land/water/shoreline/magnitude).
   */
  updateTile(tile: TileRef, state: number): boolean;

  /**
   * Direct access to the per-tile state buffer for zero-copy consumers
   * (e.g. WebGL renderer uploading to a R16UI texture).
   *
   * The returned array is a live reference — it is mutated by `updateTile()`
   * each tick. Callers must not write to it.
   *
   * The bit layout of each `uint16` matches the renderer's tile state:
   *   bits  0-11: ownerID
   *   bit   13:  fallout
   *   bit   14:  defense bonus
   */
  tileStateBuffer(): Uint16Array;

  numTilesWithFallout(): number;
}
