/**
 * generate-regions.ts — offline generator for the Europe map's region data
 * (region-based conquest / "majority snap").
 *
 * Pipeline:
 *   1. Read resources/maps/europe/map.bin + manifest.json → ownable-land mask.
 *   2. Load Natural Earth 10m admin-1 + land GeoJSON (downloaded to
 *      scripts/regions/data/, or pass --ne-dir <dir> for an existing cache).
 *   3. Calibrate the map's projection (equirectangular with a small quadratic
 *      latitude correction) against the NE land polygons by hill-climbing the
 *      land-mask agreement. Build FAILS if agreement < 0.93.
 *   4. Group NE admin-1 features into regions using merge-table.json
 *      (European-I rules); everything else that intersects the map bounds is
 *      plain admin-1 passthrough, so the whole map is covered.
 *   5. Rasterize region polygons (node-canvas, antialias off, region id
 *      encoded in RGB) at full map resolution; clear non-ownable tiles.
 *   6. Nearest-region fill (BFS over ownable land, then a global BFS crossing
 *      water for islands). Every ownable tile must end with an id > 0.
 *   7. Drop empty regions, renumber densely.
 *   8. Downsample to the map4x grid (majority of each 2×2 block + fill).
 *   9. Emit resources/maps/europe/regions.bin (uint16 LE), regions4x.bin and
 *      regions.json (metadata for debugging; not fetched at runtime).
 *
 * Run: npm run gen-regions -- [--ne-dir /path/to/cache]
 *
 * NOTE: `npm run gen-maps` (the Go map generator) only rewrites the map
 * binaries and never deletes other files, so regions.* survive regeneration —
 * but if europe/map.bin materially changes, re-run this script.
 */
import { createCanvas } from "canvas";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downsample4x,
  nearestFillGlobal,
  nearestFillLand,
} from "./raster-utils";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const MAP_DIR = join(ROOT, "resources", "maps", "europe");
const DEFAULT_NE_DIR = join(HERE, "data");
const NE_ADMIN1 = "ne_10m_admin_1_states_provinces.geojson";
const NE_LAND = "ne_10m_land.geojson";
const NE_BASE =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";

const MIN_AGREEMENT = 0.93;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Position = [number, number];
type PolygonCoords = Position[][];
type MultiPolygonCoords = PolygonCoords[];

interface GeoFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

interface CountryRule {
  iso: string;
  mode: "passthrough" | "region" | "map" | "dissolveAll";
  regionName?: string;
  includeNames?: string[];
  excludeNames?: string[];
  excludeRegions?: string[];
  map?: Record<string, string>;
  passthroughUnmapped?: boolean;
  nameOverrides?: Record<string, string>;
  regionRename?: Record<string, string>;
  geonunitMap?: Record<string, string>;
}
interface MergeTable {
  countries: Record<string, CountryRule>;
  absorb: Record<string, { toAdmin: string; region: string }>;
  reassignNames: {
    fromAdmin: string;
    names: string[];
    toAdmin: string;
    region: string;
  }[];
}

/** Projection parameters: lon = (x - lonOff)/lonScale; lat = A + B·y + C·y². */
interface Proj {
  lonScale: number;
  lonOff: number;
  A: number;
  B: number;
  C: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function parseArgs(): { neDir: string } {
  let neDir = DEFAULT_NE_DIR;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ne-dir" && argv[i + 1]) neDir = argv[++i];
  }
  return { neDir };
}

function ensureNeFile(neDir: string, file: string): string {
  const path = join(neDir, file);
  if (existsSync(path)) return path;
  mkdirSync(neDir, { recursive: true });
  const url = `${NE_BASE}/${file}`;
  console.log(`[regions] downloading ${url} …`);
  execSync(`curl -fsSL -o ${JSON.stringify(path)} ${JSON.stringify(url)}`, {
    stdio: "inherit",
  });
  return path;
}

interface EuropeMap {
  width: number;
  height: number;
  /** 1 = ownable land (land && !impassable). */
  ownable: Uint8Array;
  /** 1 = land (incl. impassable). */
  land: Uint8Array;
  /** 1 = impassable land (excluded from agreement scoring). */
  impassable: Uint8Array;
  manifest: {
    map: { width: number; height: number };
    map4x: { width: number; height: number };
  };
}

function loadEuropeMap(): EuropeMap {
  const manifest = JSON.parse(
    readFileSync(join(MAP_DIR, "manifest.json"), "utf8"),
  );
  const { width, height } = manifest.map;
  const bin = readFileSync(join(MAP_DIR, "map.bin"));
  if (bin.length !== width * height) {
    throw new Error(`map.bin length ${bin.length} != ${width}x${height}`);
  }
  const ownable = new Uint8Array(width * height);
  const land = new Uint8Array(width * height);
  const impassable = new Uint8Array(width * height);
  for (let t = 0; t < bin.length; t++) {
    const b = bin[t];
    const isLand = (b & 0x80) !== 0;
    const mag = b & 0x1f;
    if (isLand) {
      land[t] = 1;
      if (mag === 31) impassable[t] = 1;
      else ownable[t] = 1;
    }
  }
  return { width, height, ownable, land, impassable, manifest };
}

function loadOwnable4x(): {
  width: number;
  height: number;
  ownable: Uint8Array;
} {
  const manifest = JSON.parse(
    readFileSync(join(MAP_DIR, "manifest.json"), "utf8"),
  );
  const { width, height } = manifest.map4x;
  const bin = readFileSync(join(MAP_DIR, "map4x.bin"));
  if (bin.length !== width * height) {
    throw new Error(`map4x.bin length ${bin.length} != ${width}x${height}`);
  }
  const ownable = new Uint8Array(width * height);
  for (let t = 0; t < bin.length; t++) {
    const b = bin[t];
    if ((b & 0x80) !== 0 && (b & 0x1f) !== 31) ownable[t] = 1;
  }
  return { width, height, ownable };
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/** Rasterized NE land in a lon/lat grid for fast point-in-land lookups. */
class LonLatLandGrid {
  readonly lonMin = -35;
  readonly lonMax = 55;
  readonly latMin = 24;
  readonly latMax = 76;
  readonly perDeg = 64;
  readonly w: number;
  readonly h: number;
  readonly bits: Uint8Array;

  constructor(landFc: FeatureCollection) {
    this.w = (this.lonMax - this.lonMin) * this.perDeg;
    this.h = (this.latMax - this.latMin) * this.perDeg;
    console.log(
      `[regions] rasterizing NE land into ${this.w}x${this.h} lon/lat grid…`,
    );
    const canvas = createCanvas(this.w, this.h);
    const ctx = canvas.getContext("2d");
    (ctx as unknown as { antialias: string }).antialias = "none";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.fillStyle = "#ffffff";
    for (const f of landFc.features) {
      for (const poly of toMultiPolygon(f)) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const px = (ring[i][0] - this.lonMin) * this.perDeg;
            const py = (this.latMax - ring[i][1]) * this.perDeg;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
    }
    const data = ctx.getImageData(0, 0, this.w, this.h).data;
    this.bits = new Uint8Array(this.w * this.h);
    for (let i = 0; i < this.bits.length; i++) {
      this.bits[i] = data[i * 4] > 127 ? 1 : 0;
    }
  }

  isLand(lon: number, lat: number): boolean {
    const gx = Math.floor((lon - this.lonMin) * this.perDeg);
    const gy = Math.floor((this.latMax - lat) * this.perDeg);
    if (gx < 0 || gx >= this.w || gy < 0 || gy >= this.h) return false;
    return this.bits[gy * this.w + gx] !== 0;
  }
}

function agreement(
  proj: Proj,
  map: EuropeMap,
  grid: LonLatLandGrid,
  step: number,
): number {
  let match = 0;
  let total = 0;
  for (let y = 0; y < map.height; y += step) {
    const lat = proj.A + proj.B * y + proj.C * y * y;
    const row = y * map.width;
    for (let x = 0; x < map.width; x += step) {
      const t = row + x;
      if (map.impassable[t] !== 0) continue;
      const lon = (x - proj.lonOff) / proj.lonScale;
      const neLand = grid.isLand(lon, lat);
      const mapLand = map.land[t] !== 0;
      total++;
      if (neLand === mapLand) match++;
    }
  }
  return total === 0 ? 0 : match / total;
}

function calibrate(map: EuropeMap, grid: LonLatLandGrid): Proj {
  // Seed constants measured against the real map (see PR description).
  const p: Proj = {
    lonScale: 40.61,
    lonOff: 1005.2,
    A: 71.423,
    B: -0.025013,
    C: 2.3e-7,
  };
  const keys: (keyof Proj)[] = ["lonScale", "lonOff", "A", "B", "C"];
  let steps: Record<keyof Proj, number> = {
    lonScale: 0.2,
    lonOff: 2.0,
    A: 0.1,
    B: 5e-5,
    C: 1e-7,
  };
  let best = agreement(p, map, grid, 3);
  console.log(`[regions] calibration seed agreement: ${best.toFixed(4)}`);
  for (let round = 0; round < 8; round++) {
    let improved = false;
    for (const k of keys) {
      for (const dir of [1, -1]) {
        const trial = { ...p, [k]: p[k] + dir * steps[k] };
        const a = agreement(trial, map, grid, 3);
        if (a > best) {
          best = a;
          p[k] = trial[k];
          improved = true;
        }
      }
    }
    if (!improved) {
      steps = Object.fromEntries(
        keys.map((k) => [k, steps[k] * 0.5]),
      ) as Record<keyof Proj, number>;
    }
  }
  const finalAgreement = agreement(p, map, grid, 1);
  console.log(
    `[regions] calibrated: lon=(x-${p.lonOff.toFixed(3)})/${p.lonScale.toFixed(4)}, ` +
      `lat=${p.A.toFixed(4)}${p.B.toExponential(4)}*y+${p.C.toExponential(3)}*y^2`,
  );
  console.log(
    `[regions] land-mask agreement (full res): ${finalAgreement.toFixed(4)}`,
  );
  if (finalAgreement < MIN_AGREEMENT) {
    throw new Error(
      `calibration agreement ${finalAgreement.toFixed(4)} < ${MIN_AGREEMENT} — projection fit failed`,
    );
  }
  return p;
}

/** Forward transform lon/lat → map pixel (float). */
function makeForward(p: Proj): (lon: number, lat: number) => Position {
  return (lon: number, lat: number): Position => {
    const x = p.lonOff + p.lonScale * lon;
    // Solve C·y² + B·y + (A - lat) = 0 for y (the root near the map).
    let y: number;
    if (Math.abs(p.C) < 1e-15) {
      y = (lat - p.A) / p.B;
    } else {
      const disc = p.B * p.B - 4 * p.C * (p.A - lat);
      y = (-p.B - Math.sqrt(Math.max(0, disc))) / (2 * p.C);
    }
    return [x, y];
  };
}

// ---------------------------------------------------------------------------
// Merge table / grouping
// ---------------------------------------------------------------------------

interface RegionGroup {
  key: string; // "Country/Region"
  country: string; // ISO cc when known, else NE admin name
  name: string;
  features: GeoFeature[];
}

function toMultiPolygon(f: GeoFeature): MultiPolygonCoords {
  if (!f.geometry) return [];
  if (f.geometry.type === "Polygon") {
    return [f.geometry.coordinates as PolygonCoords];
  }
  return f.geometry.coordinates as MultiPolygonCoords;
}

function featureBbox(f: GeoFeature): [number, number, number, number] {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const poly of toMultiPolygon(f)) {
    for (const ring of poly) {
      for (const p of ring) {
        if (p[0] < minLon) minLon = p[0];
        if (p[0] > maxLon) maxLon = p[0];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
      }
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Group NE admin-1 features into named regions.
 *
 * Deviation from European-I's build-map.ts: `includeNames` filters are
 * IGNORED — European-I used them to crop Russia/Turkey to its smaller board,
 * but OpenFront's Europe map extends further (deeper Russia, Anatolia, North
 * Africa, the Levant, the Caucasus…), so unlisted features fall through to
 * admin-1 passthrough instead of being dropped. `excludeNames` /
 * `excludeRegions` (genuinely off-map: DOM-TOM, Svalbard, Azores…) still
 * drop. Countries not in the table at all are plain admin-1 passthrough.
 * Only features whose bbox intersects the map's lon/lat bounds are kept.
 */
function groupFeatures(
  raw: FeatureCollection,
  table: MergeTable,
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number },
): RegionGroup[] {
  const adminToIso = new Map<string, string>(
    Object.entries(table.countries).map(([admin, rule]) => [admin, rule.iso]),
  );
  const groups = new Map<string, RegionGroup>();
  const unmapped = new Map<string, string[]>();

  const add = (country: string, region: string, f: GeoFeature): void => {
    const key = `${country}/${region}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, country, name: region, features: [] };
      groups.set(key, g);
    }
    g.features.push(f);
  };

  for (const f of raw.features) {
    if (!f.geometry) continue;
    const [minLon, minLat, maxLon, maxLat] = featureBbox(f);
    if (
      maxLon < bounds.lonMin ||
      minLon > bounds.lonMax ||
      maxLat < bounds.latMin ||
      minLat > bounds.latMax
    ) {
      continue;
    }

    const admin = String(f.properties.admin ?? "");
    const name = String(
      f.properties.name ?? f.properties.name_en ?? f.properties.gn_name ?? "",
    );

    // reassignNames (e.g. NE places Crimea under Russia)
    const re = table.reassignNames.find(
      (r) => r.fromAdmin === admin && r.names.includes(name),
    );
    if (re) {
      add(adminToIso.get(re.toAdmin) ?? re.toAdmin, re.region, f);
      continue;
    }

    // absorbed microstates / Åland
    const ab = table.absorb[admin];
    if (ab) {
      add(adminToIso.get(ab.toAdmin) ?? ab.toAdmin, ab.region, f);
      continue;
    }

    const rule = table.countries[admin];
    if (!rule) {
      // Country not in the table: plain admin-1 passthrough.
      add(admin, name !== "" ? name : `admin1-${groups.size}`, f);
      continue;
    }
    if (rule.excludeNames?.includes(name)) continue;
    const neRegion = String(f.properties.region ?? "");
    if (rule.excludeRegions?.includes(neRegion)) continue;

    let region: string;
    switch (rule.mode) {
      case "passthrough":
        region = name;
        break;
      case "dissolveAll":
        region = rule.regionName ?? admin;
        break;
      case "region": {
        const geonunit = String(f.properties.geonunit ?? "");
        const overridden = rule.nameOverrides?.[name];
        if (overridden !== undefined) region = overridden;
        else if (rule.geonunitMap?.[geonunit] !== undefined) {
          region = rule.geonunitMap[geonunit];
        } else region = rule.regionRename?.[neRegion] ?? neRegion;
        if (region === "" || region === "null") {
          throw new Error(`${admin}/${name}: empty NE region (mode=region)`);
        }
        break;
      }
      case "map": {
        const mapped = rule.map?.[name];
        if (mapped !== undefined) region = mapped;
        else if (
          rule.passthroughUnmapped === true ||
          rule.includeNames !== undefined
        ) {
          // includeNames countries (Russia, Turkey): unlisted features are
          // in-map here (bigger board than European-I) — passthrough.
          region = name;
        } else {
          const list = unmapped.get(admin) ?? [];
          list.push(name);
          unmapped.set(admin, list);
          continue;
        }
        break;
      }
    }
    add(rule.iso, region, f);
  }

  if (unmapped.size > 0) {
    for (const [admin, names] of unmapped) {
      console.error(
        `[regions] UNMAPPED in ${admin}: ${[...new Set(names)].sort().join(", ")}`,
      );
    }
    throw new Error("merge-table.json does not cover all features (see above)");
  }

  // Deterministic id order: country, then region name (binary compare).
  return [...groups.values()].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
}

// ---------------------------------------------------------------------------
// Rasterization
// ---------------------------------------------------------------------------

function rasterizeRegions(
  groups: RegionGroup[],
  forward: (lon: number, lat: number) => Position,
  width: number,
  height: number,
): Uint16Array {
  if (groups.length > 0xffff) {
    throw new Error(`too many regions for uint16: ${groups.length}`);
  }
  console.log(
    `[regions] rasterizing ${groups.length} regions at ${width}x${height}…`,
  );
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  (ctx as unknown as { antialias: string }).antialias = "none";
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  groups.forEach((g, i) => {
    const id = i + 1;
    const r = (id >> 16) & 0xff;
    const gg = (id >> 8) & 0xff;
    const b = id & 0xff;
    ctx.fillStyle = `rgb(${r},${gg},${b})`;
    for (const f of g.features) {
      for (const poly of toMultiPolygon(f)) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let j = 0; j < ring.length; j++) {
            const [px, py] = forward(ring[j][0], ring[j][1]);
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }
    }
  });
  const data = ctx.getImageData(0, 0, width, height).data;
  const ids = new Uint16Array(width * height);
  for (let t = 0; t < ids.length; t++) {
    ids[t] =
      ((data[t * 4] << 16) | (data[t * 4 + 1] << 8) | data[t * 4 + 2]) & 0xffff;
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function writeUint16LE(path: string, arr: Uint16Array): void {
  const buf = Buffer.alloc(arr.length * 2);
  for (let i = 0; i < arr.length; i++) buf.writeUInt16LE(arr[i], i * 2);
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { neDir } = parseArgs();
  const map = loadEuropeMap();
  console.log(
    `[regions] europe map ${map.width}x${map.height}, ` +
      `${map.ownable.reduce((a, b) => a + b, 0)} ownable land tiles`,
  );

  const landPath = ensureNeFile(neDir, NE_LAND);
  const admin1Path = ensureNeFile(neDir, NE_ADMIN1);
  console.log(`[regions] reading NE data from ${neDir}…`);
  const landFc = JSON.parse(
    readFileSync(landPath, "utf8"),
  ) as FeatureCollection;
  const admin1Fc = JSON.parse(
    readFileSync(admin1Path, "utf8"),
  ) as FeatureCollection;

  const grid = new LonLatLandGrid(landFc);
  const proj = calibrate(map, grid);
  const forward = makeForward(proj);

  // Map lon/lat bounds (with margin) for the feature bbox filter.
  const lonMin = (0 - proj.lonOff) / proj.lonScale - 0.5;
  const lonMax = (map.width - proj.lonOff) / proj.lonScale + 0.5;
  const latMax = proj.A + 0.5;
  const latMin =
    proj.A + proj.B * map.height + proj.C * map.height * map.height - 0.5;
  console.log(
    `[regions] map bounds: lon ${lonMin.toFixed(2)}…${lonMax.toFixed(2)}, ` +
      `lat ${latMin.toFixed(2)}…${latMax.toFixed(2)}`,
  );

  const table = JSON.parse(
    readFileSync(join(HERE, "merge-table.json"), "utf8"),
  ) as MergeTable;
  const groups = groupFeatures(admin1Fc, table, {
    lonMin,
    lonMax,
    latMin,
    latMax,
  });

  // Rasterize + clear non-ownable tiles.
  const ids = rasterizeRegions(groups, forward, map.width, map.height);
  for (let t = 0; t < ids.length; t++) {
    if (map.ownable[t] === 0) ids[t] = 0;
  }

  // Fill: BFS over ownable land, then across water for islands.
  console.log(`[regions] nearest-region fill…`);
  nearestFillLand(ids, map.ownable, map.width, map.height);
  nearestFillGlobal(ids, map.ownable, map.width, map.height);
  let unassigned = 0;
  for (let t = 0; t < ids.length; t++) {
    if (map.ownable[t] !== 0 && ids[t] === 0) unassigned++;
  }
  if (unassigned > 0) {
    throw new Error(`${unassigned} ownable tiles left without a region id`);
  }

  // Drop empty regions and renumber densely (ascending old-id order).
  const counts = new Uint32Array(groups.length + 1);
  for (let t = 0; t < ids.length; t++) counts[ids[t]]++;
  const remap = new Uint16Array(groups.length + 1);
  const kept: { id: number; name: string; country: string; tiles: number }[] =
    [];
  for (let old = 1; old <= groups.length; old++) {
    if (counts[old] === 0) continue;
    remap[old] = kept.length + 1;
    kept.push({
      id: kept.length + 1,
      name: groups[old - 1].name,
      country: groups[old - 1].country,
      tiles: counts[old],
    });
  }
  for (let t = 0; t < ids.length; t++) ids[t] = remap[ids[t]];
  console.log(
    `[regions] ${kept.length} regions after dropping ${groups.length - kept.length} empty`,
  );
  if (kept.length < 300 || kept.length > 2000) {
    throw new Error(
      `suspicious region count ${kept.length} (expected 300–2000)`,
    );
  }
  const largest = kept.reduce((a, b) => (b.tiles > a.tiles ? b : a));
  console.log(
    `[regions] largest region: ${largest.country}/${largest.name} (${largest.tiles} tiles)`,
  );

  // Downsample for Compact (map4x) and fill against the map4x land mask.
  const m4 = loadOwnable4x();
  const ids4 = downsample4x(ids, map.width, map.height, m4.width, m4.height);
  for (let t = 0; t < ids4.length; t++) {
    if (m4.ownable[t] === 0) ids4[t] = 0;
  }
  nearestFillLand(ids4, m4.ownable, m4.width, m4.height);
  nearestFillGlobal(ids4, m4.ownable, m4.width, m4.height);
  let unassigned4 = 0;
  for (let t = 0; t < ids4.length; t++) {
    if (m4.ownable[t] !== 0 && ids4[t] === 0) unassigned4++;
  }
  if (unassigned4 > 0) {
    throw new Error(`${unassigned4} map4x ownable tiles without a region id`);
  }

  writeUint16LE(join(MAP_DIR, "regions.bin"), ids);
  writeUint16LE(join(MAP_DIR, "regions4x.bin"), ids4);
  writeFileSync(
    join(MAP_DIR, "regions.json"),
    JSON.stringify(
      {
        version: 1,
        regionCount: kept.length,
        regions: kept.map(({ id, name, country }) => ({ id, name, country })),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[regions] wrote regions.bin (${ids.length * 2} bytes), ` +
      `regions4x.bin (${ids4.length * 2} bytes), regions.json (${kept.length} regions)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
