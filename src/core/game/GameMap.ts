import { Cell, TerrainType } from "./Game";

export type TileRef = number;
export type TileUpdate = bigint;

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

  // Lookup tables (LUTs) contain pre-computed values to avoid performing division at runtime
  private readonly refToX: number[];
  private readonly refToY: number[];
  private readonly yToRef: number[];

  // Terrain bits (Uint8Array)
  private static readonly IS_LAND_BIT = 7;
  private static readonly SHORELINE_BIT = 6;
  private static readonly OCEAN_BIT = 5;
  private static readonly MAGNITUDE_MASK = 0x1f; // 11111 in binary

  // State bits (Uint16Array)
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
    // Precompute the LUTs
    let ref = 0;
    this.refToX = new Array(width * height);
    this.refToY = new Array(width * height);
    this.yToRef = new Array(height);
    for (let y = 0; y < height; y++) {
      this.yToRef[y] = ref;
      for (let x = 0; x < width; x++) {
        this.refToX[ref] = x;
        this.refToY[ref] = y;
        ref++;
      }
    }
  }
  numTilesWithFallout(): number {
    return this._numTilesWithFallout;
  }

  ref(x: number, y: number): TileRef {
    if (!this.isValidCoord(x, y)) {
      throw new Error(`Invalid coordinates: ${x},${y}`);
    }
    return this.yToRef[y] + x;
  }

  isValidRef(ref: TileRef): boolean {
    return ref >= 0 && ref < this.refToX.length;
  }

  x(ref: TileRef): number {
    return this.refToX[ref];
  }

  y(ref: TileRef): number {
    return this.refToY[ref];
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
    return this.ownerID(ref) !== 0;
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
    return (
      x === 0 || x === this.width() - 1 || y === 0 || y === this.height() - 1
    );
  }

  isBorder(ref: TileRef): boolean {
    return this.neighbors(ref).some(
      (tr) => this.ownerID(tr) !== this.ownerID(ref),
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

  // if updating these magnitude values, also update
  // `../../../map-generator/map_generator.go` `getThumbnailColor`
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
    const x = this.refToX[ref];

    if (ref >= w) neighbors.push(ref - w);
    if (ref < (this.height_ - 1) * w) neighbors.push(ref + w);
    if (x !== 0) neighbors.push(ref - 1);
    if (x !== w - 1) neighbors.push(ref + 1);

    return neighbors;
  }

  forEachTile(fn: (tile: TileRef) => void): void {
    for (let ref: TileRef = 0; ref < this.width_ * this.height_; ref++) {
      fn(ref);
    }
  }

  manhattanDist(c1: TileRef, c2: TileRef): number {
    return (
      Math.abs(this.x(c1) - this.x(c2)) + Math.abs(this.y(c1) - this.y(c2))
    );
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    const x = this.x(c1) - this.x(c2);
    const y = this.y(c1) - this.y(c2);
    return x * x + y * y;
  }
  circleSearch(
    tile: TileRef,
    radius: number,
    filter?: (tile: TileRef, d2: number) => boolean,
  ): Set<TileRef> {
    const center = { x: this.x(tile), y: this.y(tile) };
    const tiles: Set<TileRef> = new Set<TileRef>();
    const minX = Math.max(0, center.x - radius);
    const maxX = Math.min(this.width_ - 1, center.x + radius);
    const minY = Math.max(0, center.y - radius);
    const maxY = Math.min(this.height_ - 1, center.y + radius);
    for (let i = minX; i <= maxX; ++i) {
      for (let j = minY; j <= maxY; j++) {
        const t = this.yToRef[j] + i;
        const d2 = this.euclideanDistSquared(tile, t);
        if (d2 > radius * radius) continue;
        if (!filter || filter(t, d2)) {
          tiles.add(t);
        }
      }
    }
    return tiles;
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    const seen = new Set<TileRef>();
    const q: TileRef[] = [];
    if (filter(this, tile)) {
      seen.add(tile);
      q.push(tile);
    }

    while (q.length > 0) {
      const curr = q.pop();
      if (curr === undefined) continue;
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
  center: boolean = false,
): (gm: GameMap, tile: TileRef) => boolean {
  const dist2 = dist * dist;
  if (!center) {
    return (gm: GameMap, n: TileRef) =>
      gm.euclideanDistSquared(root, n) <= dist2;
  } else {
    return (gm: GameMap, n: TileRef) => {
      // shifts the root tile’s coordinates by -0.5 so that its “center”
      // center becomes the corner of four pixels rather than the middle of one pixel.
      // just makes things based off even pixels instead of odd. Used to use 9x9 icons now 10x10 icons etc...
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;
      const dx = gm.x(n) - rootX;
      const dy = gm.y(n) - rootY;
      return dx * dx + dy * dy <= dist2;
    };
  }
}

export function manhattanDistFN(
  root: TileRef,
  dist: number,
  center: boolean = false,
): (gm: GameMap, tile: TileRef) => boolean {
  if (!center) {
    return (gm: GameMap, n: TileRef) => gm.manhattanDist(root, n) <= dist;
  } else {
    return (gm: GameMap, n: TileRef) => {
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;
      const dx = Math.abs(gm.x(n) - rootX);
      const dy = Math.abs(gm.y(n) - rootY);
      return dx + dy <= dist;
    };
  }
}

export function rectDistFN(
  root: TileRef,
  dist: number,
  center: boolean = false,
): (gm: GameMap, tile: TileRef) => boolean {
  if (!center) {
    return (gm: GameMap, n: TileRef) => {
      const dx = Math.abs(gm.x(n) - gm.x(root));
      const dy = Math.abs(gm.y(n) - gm.y(root));
      return dx <= dist && dy <= dist;
    };
  } else {
    return (gm: GameMap, n: TileRef) => {
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;
      const dx = Math.abs(gm.x(n) - rootX);
      const dy = Math.abs(gm.y(n) - rootY);
      return dx <= dist && dy <= dist;
    };
  }
}

function isInIsometricTile(
  center: { x: number; y: number },
  tile: { x: number; y: number },
  yOffset: number,
  distance: number,
): boolean {
  const dx = Math.abs(tile.x - center.x);
  const dy = Math.abs(tile.y - (center.y + yOffset));
  return dx + dy * 2 <= distance + 1;
}

export function isometricDistFN(
  root: TileRef,
  dist: number,
  center: boolean = false,
): (gm: GameMap, tile: TileRef) => boolean {
  if (!center) {
    return (gm: GameMap, n: TileRef) => gm.manhattanDist(root, n) <= dist;
  } else {
    return (gm: GameMap, n: TileRef) => {
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;

      return isInIsometricTile(
        { x: rootX, y: rootY },
        { x: gm.x(n), y: gm.y(n) },
        0,
        dist,
      );
    };
  }
}

export function hexDistFN(
  root: TileRef,
  dist: number,
  center: boolean = false,
): (gm: GameMap, tile: TileRef) => boolean {
  if (!center) {
    return (gm: GameMap, n: TileRef) => {
      const dx = Math.abs(gm.x(n) - gm.x(root));
      const dy = Math.abs(gm.y(n) - gm.y(root));
      return dx <= dist && dy <= dist && dx + dy <= dist * 1.5;
    };
  } else {
    return (gm: GameMap, n: TileRef) => {
      const rootX = gm.x(root) - 0.5;
      const rootY = gm.y(root) - 0.5;
      const dx = Math.abs(gm.x(n) - rootX);
      const dy = Math.abs(gm.y(n) - rootY);
      return dx <= dist && dy <= dist && dx + dy <= dist * 1.5;
    };
  }
}

export function andFN(
  x: (gm: GameMap, tile: TileRef) => boolean,
  y: (gm: GameMap, tile: TileRef) => boolean,
): (gm: GameMap, tile: TileRef) => boolean {
  return (gm: GameMap, tile: TileRef) => x(gm, tile) && y(gm, tile);
}
