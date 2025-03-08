import { Cell, TerrainType } from "./Game";

export type TileRef = number;
export type TileUpdate = bigint;

export interface GameMap {
  ref(x: number, y: number): TileRef;

  x(ref: TileRef): number;
  y(ref: TileRef): number;
  cell(ref: TileRef): Cell;
  width(): number;
  height(): number;
  numLandTiles(): number;

  isValidCoord(x: number, y: number): boolean;
  // Terrain getters (immutable)
  isLand(ref: TileRef): boolean;
  isOceanShore(ref: TileRef): boolean;
  isOcean(ref: TileRef): boolean;
  isShoreline(ref: TileRef): boolean;
  magnitude(ref: TileRef): number;
  // State getters and setters (mutable)
  ownerID(ref: TileRef): number;
  hasOwner(ref: TileRef): boolean;

  setOwnerID(ref: TileRef, playerId: number): void;
  hasFallout(ref: TileRef): boolean;
  setFallout(ref: TileRef, value: boolean): void;
  isOnEdgeOfMap(ref: TileRef): boolean;
  isBorder(ref: TileRef): boolean;
  neighbors(ref: TileRef): TileRef[];
  isWater(ref: TileRef): boolean;
  isLake(ref: TileRef): boolean;
  isShore(ref: TileRef): boolean;
  cost(ref: TileRef): number;
  terrainType(ref: TileRef): TerrainType;
  forEachTile(fn: (tile: TileRef) => void): void;

  manhattanDist(c1: TileRef, c2: TileRef): number;
  euclideanDist(c1: TileRef, c2: TileRef): number;
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef>;

  toTileUpdate(tile: TileRef): bigint;
  updateTile(tu: TileUpdate): TileRef;

  numTilesWithFallout(): number;
}

export class GameMapImpl implements GameMap {
  private _numTilesWithFallout = 0;

  private readonly terrain: Uint8Array; // Immutable terrain data
  private readonly state: Uint16Array; // Mutable game state
  private readonly width_: number;
  private readonly height_: number;

  // Terrain bits (Uint8Array)
  private static readonly IS_LAND_BIT = 7;
  private static readonly SHORELINE_BIT = 6;
  private static readonly OCEAN_BIT = 5;
  private static readonly MAGNITUDE_OFFSET = 4; // Uses bits 3-7 (5 bits)
  private static readonly MAGNITUDE_MASK = 0x1f; // 11111 in binary

  // State bits (Uint16Array)
  private static readonly PLAYER_ID_OFFSET = 0; // Uses bits 0-11 (12 bits)
  private static readonly PLAYER_ID_MASK = 0xfff;
  private static readonly FALLOUT_BIT = 13;
  private static readonly DEFENSE_BONUS_BIT = 14;
  // Bit 15 still reserved

  constructor(
    width: number,
    height: number,
    terrainData: Uint8Array,
    private numLandTiles_: number,
  ) {
    if (terrainData.length !== width * height) {
      throw new Error(
        `Terrain data length ${terrainData.length} doesn't match dimensions ${width}x${height}`,
      );
    }
    this.width_ = width;
    this.height_ = height;
    this.terrain = terrainData;
    this.state = new Uint16Array(width * height);
  }
  numTilesWithFallout(): number {
    return this._numTilesWithFallout;
  }

  ref(x: number, y: number): TileRef {
    if (!this.isValidCoord(x, y)) {
      throw new Error(`Invalid coordinates: ${x},${y}`);
    }
    return y * this.width_ + x;
  }

  x(ref: TileRef): number {
    return ref % this.width_;
  }

  y(ref: TileRef): number {
    return Math.floor(ref / this.width_);
  }

  cell(ref: TileRef): Cell {
    return new Cell(this.x(ref), this.y(ref));
  }

  width(): number {
    return this.width_;
  }
  height(): number {
    return this.height_;
  }
  numLandTiles(): number {
    return this.numLandTiles_;
  }

  isValidCoord(x: number, y: number): boolean {
    return x >= 0 && x < this.width_ && y >= 0 && y < this.height_;
  }

  // Terrain getters (immutable)
  isLand(ref: TileRef): boolean {
    return Boolean(this.terrain[ref] & (1 << GameMapImpl.IS_LAND_BIT));
  }

  isOceanShore(ref: TileRef): boolean {
    return (
      this.isLand(ref) && this.neighbors(ref).some((tr) => this.isOcean(tr))
    );
  }

  isOcean(ref: TileRef): boolean {
    return Boolean(this.terrain[ref] & (1 << GameMapImpl.OCEAN_BIT));
  }

  isShoreline(ref: TileRef): boolean {
    return Boolean(this.terrain[ref] & (1 << GameMapImpl.SHORELINE_BIT));
  }

  magnitude(ref: TileRef): number {
    return this.terrain[ref] & GameMapImpl.MAGNITUDE_MASK;
  }

  // State getters and setters (mutable)
  ownerID(ref: TileRef): number {
    return this.state[ref] & GameMapImpl.PLAYER_ID_MASK;
  }

  hasOwner(ref: TileRef): boolean {
    return this.ownerID(ref) != 0;
  }

  setOwnerID(ref: TileRef, playerId: number): void {
    if (playerId > GameMapImpl.PLAYER_ID_MASK) {
      throw new Error(
        `Player ID ${playerId} exceeds maximum value ${GameMapImpl.PLAYER_ID_MASK}`,
      );
    }
    this.state[ref] =
      (this.state[ref] & ~GameMapImpl.PLAYER_ID_MASK) | playerId;
  }

  hasFallout(ref: TileRef): boolean {
    return Boolean(this.state[ref] & (1 << GameMapImpl.FALLOUT_BIT));
  }

  setFallout(ref: TileRef, value: boolean): void {
    const existingFallout = this.hasFallout(ref);
    if (value) {
      if (!existingFallout) {
        this._numTilesWithFallout++;
        this.state[ref] |= 1 << GameMapImpl.FALLOUT_BIT;
      }
    } else {
      if (existingFallout) {
        this._numTilesWithFallout--;
        this.state[ref] &= ~(1 << GameMapImpl.FALLOUT_BIT);
      }
    }
  }

  isOnEdgeOfMap(ref: TileRef): boolean {
    const x = this.x(ref);
    const y = this.y(ref);
    return x == 0 || x == this.width() - 1 || y == 0 || y == this.height() - 1;
  }

  isBorder(ref: TileRef): boolean {
    return this.neighbors(ref).some(
      (tr) => this.ownerID(tr) != this.ownerID(ref),
    );
  }

  hasDefenseBonus(ref: TileRef): boolean {
    return Boolean(this.state[ref] & (1 << GameMapImpl.DEFENSE_BONUS_BIT));
  }

  setDefenseBonus(ref: TileRef, value: boolean): void {
    if (value) {
      this.state[ref] |= 1 << GameMapImpl.DEFENSE_BONUS_BIT;
    } else {
      this.state[ref] &= ~(1 << GameMapImpl.DEFENSE_BONUS_BIT);
    }
  }

  // Helper methods
  isWater(ref: TileRef): boolean {
    return !this.isLand(ref);
  }

  isLake(ref: TileRef): boolean {
    return !this.isLand(ref) && !this.isOcean(ref);
  }

  isShore(ref: TileRef): boolean {
    return this.isLand(ref) && this.isShoreline(ref);
  }

  cost(ref: TileRef): number {
    return this.magnitude(ref) < 10 ? 2 : 1;
  }

  terrainType(ref: TileRef): TerrainType {
    if (this.isLand(ref)) {
      const magnitude = this.magnitude(ref);
      if (magnitude < 10) return TerrainType.Plains;
      if (magnitude < 20) return TerrainType.Highland;
      return TerrainType.Mountain;
    }
    return this.isOcean(ref) ? TerrainType.Ocean : TerrainType.Lake;
  }

  neighbors(ref: TileRef): TileRef[] {
    const neighbors: TileRef[] = [];
    const w = this.width_;

    if (ref >= w) neighbors.push(ref - w);
    if (ref < (this.height_ - 1) * w) neighbors.push(ref + w);
    if (ref % w !== 0) neighbors.push(ref - 1);
    if (ref % w !== w - 1) neighbors.push(ref + 1);

    for (const n of neighbors) {
      this.ref(this.x(n), this.y(n));
    }

    return neighbors;
  }

  forEachTile(fn: (tile: TileRef) => void): void {
    for (let x = 0; x < this.width_; x++) {
      for (let y = 0; y < this.height_; y++) {
        fn(this.ref(x, y));
      }
    }
  }

  manhattanDist(c1: TileRef, c2: TileRef): number {
    return (
      Math.abs(this.x(c1) - this.x(c2)) + Math.abs(this.y(c1) - this.y(c2))
    );
  }
  euclideanDist(c1: TileRef, c2: TileRef): number {
    return Math.sqrt(
      Math.pow(this.x(c1) - this.x(c2), 2) +
        Math.pow(this.y(c1) - this.y(c2), 2),
    );
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    const seen = new Set<TileRef>();
    const q: TileRef[] = [];
    q.push(tile);
    while (q.length > 0) {
      const curr = q.pop();
      for (const n of this.neighbors(curr)) {
        if (!seen.has(n) && filter(this, n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    return seen;
  }

  toTileUpdate(tile: TileRef): bigint {
    // Pack the tile reference and state into a bigint
    // Format: [32 bits for tile reference][16 bits for state]
    return (BigInt(tile) << 16n) | BigInt(this.state[tile]);
  }

  updateTile(tu: TileUpdate): TileRef {
    // Extract tile reference and state from the TileUpdate
    // Last 16 bits are state, rest is tile reference
    const tileRef = Number(tu >> 16n);
    const state = Number(tu & 0xffffn);

    const existingFallout = this.hasFallout(tileRef);
    this.state[tileRef] = state;
    const newFallout = this.hasFallout(tileRef);
    if (existingFallout && !newFallout) {
      this._numTilesWithFallout--;
    }
    if (!existingFallout && newFallout) {
      this._numTilesWithFallout++;
    }

    return tileRef;
  }
}

export function euclDistFN(
  root: TileRef,
  dist: number,
  center: boolean,
): (gm: GameMap, tile: TileRef) => boolean {
  if (!center) {
    return (gm: GameMap, n: TileRef) => gm.euclideanDist(root, n) <= dist;
  } else {
    return (gm: GameMap, n: TileRef) => {
      // shifts the root tile’s coordinates by -0.5 so that its “center”
      // center becomes the corner of four pixels rather than the middle of one pixel.
      // just makes things based off even pixels instead of odd. Used to use 9x9 icons now 10x10 icons etc...
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;
      const dx = gm.x(n) - rootX;
      const dy = gm.y(n) - rootY;
      return Math.sqrt(dx * dx + dy * dy) <= dist;
    };
  }
}

export function manhattanDistFN(
  root: TileRef,
  dist: number,
): (gm: GameMap, tile: TileRef) => boolean {
  return (gm: GameMap, n: TileRef) => gm.manhattanDist(root, n) <= dist;
}

export function andFN(
  x: (gm: GameMap, tile: TileRef) => boolean,
  y: (gm: GameMap, tile: TileRef) => boolean,
): (gm: GameMap, tile: TileRef) => boolean {
  return (gm: GameMap, tile: TileRef) => x(gm, tile) && y(gm, tile);
}
