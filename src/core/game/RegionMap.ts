/**
 * RegionMap — static per-tile region ids for region-based conquest
 * ("majority snap"), plus the RegionTracker bookkeeping that decides when a
 * region snaps to a player.
 *
 * Region data is generated offline (scripts/regions/generate-regions.ts) and
 * shipped as `regions.bin` / `regions4x.bin` next to the map binaries. Every
 * ownable land tile (land && !impassable) has a region id in 1..N; water,
 * impassable terrain and maps without region data have id 0.
 *
 * Feature gating is an explicit allowlist (REGION_ENABLED_MAPS) so every
 * client deterministically agrees on whether the mechanic is active — a
 * failed regions.bin fetch on an allowlisted map fails game init exactly like
 * a failed map.bin fetch.
 */

import { TileRef } from "./GameMap";
import { GameMapType } from "./Maps.gen";

/** Maps with committed region data. Must match resources/maps/<map>/regions.bin. */
export const REGION_ENABLED_MAPS: ReadonlySet<GameMapType> = new Set([
  GameMapType.Europe,
]);

/**
 * Decode a little-endian uint16 raster from raw bytes (regions.bin payload).
 * Explicit byte-order decode so big-endian hosts stay deterministic.
 */
export function decodeRegionRaster(bytes: Uint8Array): Uint16Array {
  if (bytes.length % 2 !== 0) {
    throw new Error(`region raster byte length ${bytes.length} is not even`);
  }
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = bytes[2 * i] | (bytes[2 * i + 1] << 8);
  }
  return out;
}

/**
 * Marks tiles lying on a region border: a tile is marked when its id differs
 * from its right or down neighbor and both ids are > 0 (coastlines are
 * already visible, so land/water edges are not marked). Used to darken the
 * baked terrain texture; cosmetic only.
 */
export function computeRegionBorderMask(
  ids: ArrayLike<number>,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const t = row + x;
      const id = ids[t];
      if (id === 0) continue;
      if (x + 1 < width) {
        const r = ids[t + 1];
        if (r !== 0 && r !== id) {
          mask[t] = 1;
          continue;
        }
      }
      if (y + 1 < height) {
        const d = ids[t + width];
        if (d !== 0 && d !== id) {
          mask[t] = 1;
        }
      }
    }
  }
  return mask;
}

/** Minimal view of the game map needed to build a RegionMap (GameMap subset). */
export interface RegionTerrainView {
  width(): number;
  height(): number;
  isLand(ref: TileRef): boolean;
  isImpassable(ref: TileRef): boolean;
}

/** One country: a named, flagged group of region ids (countries.json entry). */
export interface CountryData {
  name: string;
  flag: string;
  regions: number[];
}

/** Parsed resources/maps/<map>/countries.json. */
export interface CountriesJson {
  version: number;
  countries: CountryData[];
}

/**
 * Immutable region raster + CSR tile lists. Constructed once per loaded map;
 * ids on non-ownable tiles are cleared so `regionId()` is 0 there.
 */
export class RegionMap {
  private readonly ids: Uint16Array;
  private readonly width_: number;
  private readonly height_: number;
  private readonly regionCount_: number;
  /** Ownable-land tile count per region id (index 0 unused). */
  private readonly landTotals: Uint32Array;
  /** CSR layout: tiles of region id are csrTiles[csrOffsets[id]..csrOffsets[id+1]), ascending TileRef. */
  private readonly csrOffsets: Uint32Array;
  private readonly csrTiles: Uint32Array;

  // Country data (country-start mode). Index 0 unused; country ids are
  // 1..countryCount_ in countries.json order. Empty when no countries given.
  private readonly countryNames_: string[] = [];
  private readonly countryFlags_: string[] = [];
  /** Region ids per country, ascending (deterministic iteration order). */
  private readonly countryRegions_: number[][] = [];
  /** regionId → country id (0 = unassigned; only when countries present). */
  private readonly regionCountry_: Uint16Array;

  constructor(
    raster: Uint16Array,
    map: RegionTerrainView,
    countries?: CountriesJson | null,
  ) {
    const w = map.width();
    const h = map.height();
    if (raster.length !== w * h) {
      throw new Error(
        `region raster length ${raster.length} does not match map ${w}x${h}`,
      );
    }
    this.width_ = w;
    this.height_ = h;
    // Clear ids on non-ownable tiles (takes ownership of the raster).
    this.ids = raster;
    let maxId = 0;
    const n = w * h;
    for (let t = 0; t < n; t++) {
      if (raster[t] === 0) continue;
      if (!map.isLand(t) || map.isImpassable(t)) {
        raster[t] = 0;
      } else if (raster[t] > maxId) {
        maxId = raster[t];
      }
    }
    this.regionCount_ = maxId;
    this.landTotals = new Uint32Array(maxId + 1);
    for (let t = 0; t < n; t++) {
      if (raster[t] !== 0) this.landTotals[raster[t]]++;
    }
    // CSR via counting sort — ascending TileRef within each region.
    this.csrOffsets = new Uint32Array(maxId + 2);
    for (let id = 1; id <= maxId; id++) {
      this.csrOffsets[id + 1] = this.csrOffsets[id] + this.landTotals[id];
    }
    this.csrTiles = new Uint32Array(this.csrOffsets[maxId + 1]);
    const cursor = this.csrOffsets.slice(0, maxId + 1);
    for (let t = 0; t < n; t++) {
      const id = raster[t];
      if (id !== 0) this.csrTiles[cursor[id]++] = t;
    }

    if (countries === undefined || countries === null) {
      this.regionCountry_ = new Uint16Array(0);
      return;
    }

    // Validate the countries form a partition of the region-id space: every
    // region id 1..N (N = max of the raster's highest id and the highest id
    // referenced in countries.json) belongs to exactly one country. Ids
    // referenced beyond the raster's max are tolerated as long as they are
    // covered — a region can be empty in a given raster (e.g. lost during the
    // Compact 4x downsample) while still listed in the shared countries.json.
    if (countries.countries.length === 0) {
      throw new Error("countries.json contains no countries");
    }
    let maxRef = 0;
    for (const c of countries.countries) {
      for (const r of c.regions) {
        if (!Number.isInteger(r) || r < 1) {
          throw new Error(`country ${c.name} has invalid region id ${r}`);
        }
        if (r > maxRef) maxRef = r;
      }
    }
    const top = Math.max(maxRef, this.regionCount_);
    this.regionCountry_ = new Uint16Array(top + 1);
    const seenNames = new Set<string>();
    countries.countries.forEach((c, idx) => {
      const countryId = idx + 1;
      if (c.name === "") {
        throw new Error(`country ${countryId} has an empty name`);
      }
      if (seenNames.has(c.name)) {
        throw new Error(`duplicate country name ${c.name}`);
      }
      seenNames.add(c.name);
      if (c.regions.length === 0) {
        throw new Error(`country ${c.name} has no regions`);
      }
      for (const r of c.regions) {
        if (this.regionCountry_[r] !== 0) {
          throw new Error(
            `region ${r} is assigned to multiple countries ` +
              `(${this.countryNames_[this.regionCountry_[r]]} and ${c.name})`,
          );
        }
        this.regionCountry_[r] = countryId;
      }
      this.countryNames_[countryId] = c.name;
      this.countryFlags_[countryId] = c.flag;
      this.countryRegions_[countryId] = [...c.regions].sort((a, b) => a - b);
    });
    for (let id = 1; id <= top; id++) {
      if (this.regionCountry_[id] === 0) {
        throw new Error(`region ${id} is not covered by any country`);
      }
    }
  }

  width(): number {
    return this.width_;
  }

  height(): number {
    return this.height_;
  }

  /** Highest region id (ids are 1..regionCount; some may be empty). */
  regionCount(): number {
    return this.regionCount_;
  }

  /** Region id of a tile; 0 for water/impassable/unassigned. */
  regionId(tile: TileRef): number {
    return this.ids[tile];
  }

  /** Number of ownable land tiles in the region at generation time. */
  regionLandTiles(id: number): number {
    return id >= 1 && id <= this.regionCount_ ? this.landTotals[id] : 0;
  }

  /** Iterate the region's tiles in ascending TileRef order (deterministic). */
  forEachRegionTile(id: number, cb: (tile: TileRef) => void): void {
    if (id < 1 || id > this.regionCount_) return;
    const end = this.csrOffsets[id + 1];
    for (let i = this.csrOffsets[id]; i < end; i++) {
      cb(this.csrTiles[i]);
    }
  }

  /** Border mask for rendering (see computeRegionBorderMask). */
  computeBorderMask(): Uint8Array {
    return computeRegionBorderMask(this.ids, this.width_, this.height_);
  }

  // -------------------------------------------------------------------------
  // Countries (country-start mode)
  // -------------------------------------------------------------------------

  /** Whether country data was supplied (country-start mode is active). */
  hasCountries(): boolean {
    return this.countryNames_.length > 0;
  }

  /** Number of countries; country ids are 1..countryCount(). */
  countryCount(): number {
    return Math.max(0, this.countryNames_.length - 1);
  }

  countryName(countryId: number): string {
    const name = this.countryNames_[countryId];
    if (name === undefined) {
      throw new Error(`unknown country id ${countryId}`);
    }
    return name;
  }

  countryFlag(countryId: number): string {
    const flag = this.countryFlags_[countryId];
    if (flag === undefined) {
      throw new Error(`unknown country id ${countryId}`);
    }
    return flag;
  }

  /** Country id owning the region; 0 when unknown/no country data. */
  countryOfRegion(regionId: number): number {
    return regionId >= 0 && regionId < this.regionCountry_.length
      ? this.regionCountry_[regionId]
      : 0;
  }

  /** Country id of a tile; 0 for water/impassable/no country data. */
  countryOfTile(tile: TileRef): number {
    return this.countryOfRegion(this.ids[tile]);
  }

  /**
   * Iterate every ownable tile of the country: regions in ascending region-id
   * order, tiles in ascending TileRef order within each region (deterministic).
   */
  forEachCountryTile(countryId: number, cb: (tile: TileRef) => void): void {
    const regions = this.countryRegions_[countryId];
    if (regions === undefined) return;
    for (const regionId of regions) {
      this.forEachRegionTile(regionId, cb);
    }
  }

  /**
   * Deterministic representative tile of the country: the first CSR tile of
   * its lowest non-empty region id. Undefined when every region is empty in
   * this raster (should not happen for real countries).
   */
  countryCanonicalTile(countryId: number): TileRef | undefined {
    const regions = this.countryRegions_[countryId];
    if (regions === undefined) return undefined;
    for (const regionId of regions) {
      if (regionId > this.regionCount_) continue;
      const start = this.csrOffsets[regionId];
      if (start < this.csrOffsets[regionId + 1]) {
        return this.csrTiles[start];
      }
    }
    return undefined;
  }
}

/** Result of a land-loss update that pushed an owner over the threshold. */
export interface RegionMajorityChange {
  regionId: number;
  ownerSmallID: number;
}

/**
 * Per-region ownership counters, updated O(1) from the two tile-ownership
 * choke points in GameImpl (conquer/relinquish) plus land→water conversion.
 *
 * Snap trigger semantics: a region is reported exactly when an owner CROSSES
 * the capture threshold (strictly more than threshold × regionLandTotal),
 * not merely while holding it — so a defender chipping tiles off a majority
 * holder is not instantly reverted.
 *
 * smallID 0 (TerraNullius / unowned) is never counted.
 */
export class RegionTracker {
  /** Mutable copy of per-region ownable-land totals (water nukes decrement). */
  private readonly totals: Uint32Array;
  /** Per-region owner→tile-count. Plain Maps with get/set only (deterministic). */
  private readonly counts: Array<Map<number, number>>;

  constructor(
    private readonly regionMap: RegionMap,
    private readonly threshold: number,
  ) {
    const n = regionMap.regionCount();
    this.totals = new Uint32Array(n + 1);
    for (let id = 1; id <= n; id++) {
      this.totals[id] = regionMap.regionLandTiles(id);
    }
    this.counts = new Array(n + 1);
    for (let id = 0; id <= n; id++) {
      this.counts[id] = new Map<number, number>();
    }
  }

  ownedInRegion(regionId: number, smallID: number): number {
    return this.counts[regionId]?.get(smallID) ?? 0;
  }

  regionLandTotal(regionId: number): number {
    return regionId >= 1 && regionId < this.totals.length
      ? this.totals[regionId]
      : 0;
  }

  /**
   * Record a tile changing owner. Returns the region id to snap for the new
   * owner when this conquest crosses the capture threshold, or -1.
   */
  recordConquer(
    tile: TileRef,
    prevOwnerSmallID: number,
    newOwnerSmallID: number,
  ): number {
    const id = this.regionMap.regionId(tile);
    if (id === 0) return -1;
    if (prevOwnerSmallID === newOwnerSmallID) return -1;
    if (prevOwnerSmallID !== 0) this.dec(id, prevOwnerSmallID);
    if (newOwnerSmallID === 0) return -1;
    const map = this.counts[id];
    const before = map.get(newOwnerSmallID) ?? 0;
    const after = before + 1;
    map.set(newOwnerSmallID, after);
    const bar = this.threshold * this.totals[id];
    if (after > bar && before <= bar) return id;
    return -1;
  }

  /** Record a tile becoming unowned (relinquish). */
  recordRelinquish(tile: TileRef, prevOwnerSmallID: number): void {
    const id = this.regionMap.regionId(tile);
    if (id === 0 || prevOwnerSmallID === 0) return;
    this.dec(id, prevOwnerSmallID);
  }

  /**
   * Record an (unowned) ownable land tile turning to water. Shrinks the
   * region's total; if that pushes an existing owner over the threshold,
   * returns the change (lowest smallID wins ties deterministically).
   */
  onLandLost(tile: TileRef): RegionMajorityChange | null {
    const id = this.regionMap.regionId(tile);
    if (id === 0) return null;
    const oldTotal = this.totals[id];
    if (oldTotal === 0) return null;
    const newTotal = oldTotal - 1;
    this.totals[id] = newTotal;
    const oldBar = this.threshold * oldTotal;
    const newBar = this.threshold * newTotal;
    let crossed = -1;
    for (const [smallID, count] of this.counts[id]) {
      if (count > newBar && count <= oldBar) {
        if (crossed === -1 || smallID < crossed) crossed = smallID;
      }
    }
    return crossed === -1 ? null : { regionId: id, ownerSmallID: crossed };
  }

  private dec(regionId: number, smallID: number): void {
    const map = this.counts[regionId];
    const c = map.get(smallID) ?? 0;
    if (c <= 1) {
      map.delete(smallID);
    } else {
      map.set(smallID, c - 1);
    }
  }
}
