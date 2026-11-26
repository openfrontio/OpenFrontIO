// Validates every map's info.json and writes
// packages/engine-api/src/game/Maps.gen.ts and the map sections of en.json.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MapEntry } from "./paths";
import { inputMapDir, repoRoot } from "./paths";

const q = (s: string) => JSON.stringify(s);

/** JSON.stringify with every object's keys sorted, so the files don't churn. */
export function sortedJSON(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val: unknown) =>
      val !== null && typeof val === "object" && !Array.isArray(val)
        ? Object.fromEntries(
            Object.entries(val).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : val,
    2,
  );
}

export const categoryOrder = [
  "featured",
  "new",
  "world",
  "continental",
  "europe",
  "asia",
  "north_america",
  "africa",
  "south_america",
  "oceania",
  "antarctica",
  "countries",
  "cosmic",
  "fictional",
  "arcade",
  "tournament",
];

const modifierKeys = [
  "isRandomSpawn",
  "isCompact",
  "isCrowded",
  "isHardNations",
  "startingGold1M",
  "startingGold5M",
  "startingGold25M",
  "goldMultiplier",
  "isAlliancesDisabled",
  "isNukesDisabled",
  "isSAMsDisabled",
  "isPeaceTime",
  "isWaterNukes",
  "isDoomsdayClock",
];

interface MapLayer {
  id: string;
  placement: string;
  nukeable: boolean;
}

interface CustomTribe {
  name: string;
  coordinates: [number, number] | null;
}

export interface MapInfoJSON {
  id: string;
  name: string;
  translationKey: string;
  categories: string[];
  displayName: string;
  featuredRank: number;
  hidden: boolean;
  specialTeamCount: number;
  disabledModifiers: string[];
  forcedModifiers: string[];
  themes: string[];
  customTribes: CustomTribe[];
  nationNames: string[];
  layers: MapLayer[];
  author: string;
  description: string;
  location: { lat: number | null; lon: number | null } | null;
}

// Typed field readers standing in for Go's json.Unmarshal into a struct:
// absent and null fields take the zero value, wrong types are an error.
type Raw = Record<string, unknown>;
function typeErr(field: string, want: string, got: unknown): Error {
  const kind = Array.isArray(got)
    ? "array"
    : typeof got === "object"
      ? "object"
      : typeof got;
  return new Error(
    `json: cannot unmarshal ${kind} into Go struct field mapInfo.${field} of type ${want}`,
  );
}
function str(o: Raw, k: string): string {
  const v = o[k];
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw typeErr(k, "string", v);
  return v;
}
function int(o: Raw, k: string): number {
  const v = o[k];
  if (v === undefined || v === null) return 0;
  if (typeof v !== "number" || !Number.isInteger(v)) throw typeErr(k, "int", v);
  return v;
}
function bool(o: Raw, k: string): boolean {
  const v = o[k];
  if (v === undefined || v === null) return false;
  if (typeof v !== "boolean") throw typeErr(k, "bool", v);
  return v;
}
function arr(o: Raw, k: string): unknown[] {
  const v = o[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw typeErr(k, "[]", v);
  return v;
}
function strArr(o: Raw, k: string): string[] {
  return arr(o, k).map((e) => {
    if (typeof e !== "string") throw typeErr(k, "string", e);
    return e;
  });
}
function obj(v: unknown, field: string): Raw {
  if (v === null || typeof v !== "object" || Array.isArray(v))
    throw typeErr(field, "struct", v);
  return v as Raw;
}

function rawLayers(o: Raw): MapLayer[] {
  return arr(o, "layers").map((l) => {
    const lo = obj(l, "layers");
    return {
      id: str(lo, "id"),
      placement: str(lo, "placement"),
      nukeable: bool(lo, "nukeable"),
    };
  });
}

function checkLayers(mapName: string, layers: MapLayer[]): void {
  const fail = (msg: string) => new Error(`map ${mapName}: info.json ${msg}`);
  const layerIDs = new Set<string>();
  layers.forEach((layer, i) => {
    if (layer.id === "") throw fail(`layers[${i}] "id" must not be empty`);
    if (layer.id === "image")
      throw fail(`layers[${i}] "id" must not be "image"`);
    if (!/^[A-Za-z0-9-]+$/.test(layer.id)) {
      throw fail(
        `layers[${i}] "id" (${q(layer.id)}) must be alphanumeric (hyphens allowed)`,
      );
    }
    if (layerIDs.has(layer.id))
      throw fail(`layers[${i}] duplicate layer id ${q(layer.id)}`);
    layerIDs.add(layer.id);
    if (layer.placement !== "land" && layer.placement !== "water") {
      throw fail(
        `layers[${i}] "placement" (${q(layer.placement)}) must be "land" or "water"`,
      );
    }
  });
}

/**
 * info.json's "layers", parsed and checked as loadMapInfos does. processMap
 * calls this because loadMapInfos skips test maps.
 */
export function parseLayers(mapName: string, info: Raw): MapLayer[] {
  let layers: MapLayer[];
  try {
    layers = rawLayers(info);
  } catch (e) {
    throw new Error(
      `failed to parse info.json for ${mapName}: ${(e as Error).message}`,
    );
  }
  checkLayers(mapName, layers);
  return layers;
}

function parseInfo(raw: unknown): { info: MapInfoJSON; rawTribes: unknown[] } {
  const o = obj(raw, "");
  const loc =
    o.location === undefined || o.location === null
      ? null
      : obj(o.location, "location");
  const num = (v: unknown, f: string) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== "number") throw typeErr(f, "float64", v);
    return v;
  };
  return {
    rawTribes: arr(o, "custom_tribes"),
    info: {
      id: str(o, "id"),
      name: str(o, "name"),
      translationKey: str(o, "translation_key"),
      categories: strArr(o, "categories"),
      displayName: str(o, "display_name"),
      featuredRank: int(o, "featured_rank"),
      hidden: bool(o, "hidden"),
      specialTeamCount: int(o, "special_team_count"),
      disabledModifiers: strArr(o, "disabled_modifiers"),
      forcedModifiers: strArr(o, "forced_modifiers"),
      themes: strArr(o, "themes"),
      customTribes: [],
      nationNames: arr(o, "nations").map((n) => str(obj(n, "nations"), "name")),
      layers: rawLayers(o),
      author: str(o, "author"),
      description: str(o, "description"),
      location: loc
        ? {
            lat: num(loc.lat, "location.lat"),
            lon: num(loc.lon, "location.lon"),
          }
        : null,
    },
  };
}

function parseCustomTribes(raw: unknown[]): CustomTribe[] {
  return raw.map((r, i) => {
    if (typeof r === "string" || r === null) {
      if (!r) throw new Error(`custom_tribes[${i}]: empty string`);
      return { name: r, coordinates: null };
    }
    if (typeof r !== "object" || Array.isArray(r)) {
      throw new Error(
        `custom_tribes[${i}]: invalid entry: json: cannot unmarshal ${Array.isArray(r) ? "array" : typeof r} into Go value`,
      );
    }
    const o = r as Raw;
    if (o.name !== undefined && o.name !== null && typeof o.name !== "string") {
      throw new Error(
        `custom_tribes[${i}]: invalid entry: json: cannot unmarshal ${typeof o.name} into Go struct field .name of type string`,
      );
    }
    const name = (o.name as string | null | undefined) ?? "";
    if (name === "") throw new Error(`custom_tribes[${i}]: name is empty`);
    let coordinates: [number, number] | null = null;
    if (o.coordinates !== undefined && o.coordinates !== null) {
      const c = o.coordinates;
      if (
        !Array.isArray(c) ||
        c.length !== 2 ||
        !c.every((v) => typeof v === "number" && Number.isInteger(v))
      ) {
        throw new Error(`custom_tribes[${i}]: coordinates must be [x, y]`);
      }
      coordinates = [c[0], c[1]];
    }
    return { name, coordinates };
  });
}

export function loadMapInfos(maps: MapEntry[]): MapInfoJSON[] {
  const inputDir = inputMapDir(false);
  const validModifiers = new Set(modifierKeys);
  const infos: MapInfoJSON[] = [];
  for (const m of maps) {
    if (m.isTest) continue;
    let buf: string;
    try {
      buf = readFileSync(join(inputDir, m.name, "info.json"), "utf8");
    } catch (e) {
      throw new Error(
        `failed to read info.json for ${m.name}: ${(e as Error).message}`,
      );
    }
    let parsed: ReturnType<typeof parseInfo>;
    try {
      parsed = parseInfo(JSON.parse(buf));
    } catch (e) {
      throw new Error(
        `failed to parse info.json for ${m.name}: ${(e as Error).message}`,
      );
    }
    const info = parsed.info;
    const fail = (msg: string) => new Error(`map ${m.name}: info.json ${msg}`);
    if (info.id === "" || info.id.toLowerCase() !== m.name) {
      throw fail(
        `"id" (${q(info.id)}) must be the folder name in UpperCamelCase`,
      );
    }
    if (info.name === "") throw fail(`is missing "name"`);
    if (info.translationKey !== "map." + m.name) {
      throw fail(
        `"translation_key" (${q(info.translationKey)}) must be ${q("map." + m.name)}`,
      );
    }
    if (info.featuredRank < 0)
      throw fail(`"featured_rank" (${info.featuredRank}) must be >= 1`);
    if (info.featuredRank > 0 && !info.categories.includes("featured")) {
      throw fail(
        `sets "featured_rank" but "categories" does not include "featured"`,
      );
    }
    if (info.specialTeamCount < 0 || info.specialTeamCount === 1) {
      throw fail(
        `"special_team_count" (${info.specialTeamCount}) must be >= 2`,
      );
    }
    for (const mod of info.forcedModifiers) {
      let base = mod;
      const idx = mod.indexOf(":");
      if (idx >= 0) {
        base = mod.slice(0, idx);
        // fmt.Sscanf(pct, "%d", &n)
        const match = /^\s*([+-]?\d+)/.exec(mod.slice(idx + 1));
        const n = match ? Number(match[1]) : NaN;
        if (!match || n < 1 || n > 100) {
          throw fail(
            `forced_modifiers ${q(mod)} has invalid percentage (must be 1-100)`,
          );
        }
      }
      if (!validModifiers.has(base))
        throw fail(`forced_modifiers contains invalid modifier ${q(base)}`);
    }
    for (const mod of info.disabledModifiers) {
      if (!validModifiers.has(mod))
        throw fail(`disabled_modifiers contains invalid modifier ${q(mod)}`);
    }
    const loc = info.location;
    if (
      loc &&
      (loc.lat === null ||
        loc.lon === null ||
        loc.lat < -90 ||
        loc.lat > 90 ||
        loc.lon < -180 ||
        loc.lon > 180)
    ) {
      throw fail(
        `"location" must have lat in [-90, 90] and lon in [-180, 180]`,
      );
    }
    if (info.categories.length === 0)
      throw fail(`"categories" must list at least one category`);
    try {
      info.customTribes = parseCustomTribes(parsed.rawTribes);
    } catch (e) {
      throw fail(`"custom_tribes" ${(e as Error).message}`);
    }
    const ctSeen = new Set<string>();
    for (const ct of info.customTribes) {
      if (ctSeen.has(ct.name))
        throw fail(`"custom_tribes" contains duplicate ${q(ct.name)}`);
      ctSeen.add(ct.name);
    }
    const nationNames = new Set(info.nationNames);
    for (const ct of info.customTribes) {
      if (nationNames.has(ct.name))
        throw fail(
          `"custom_tribes" contains ${q(ct.name)} which is already a nation name`,
        );
    }
    const seen = new Set<string>();
    for (const category of info.categories) {
      if (!categoryOrder.includes(category)) {
        throw fail(
          `category ${q(category)} must be one of: ${categoryOrder.join(", ")}`,
        );
      }
      if (seen.has(category))
        throw fail(`lists category ${q(category)} more than once`);
      seen.add(category);
    }
    checkLayers(m.name, info.layers);
    infos.push(info);
  }
  return infos;
}

export function generateMapsTS(infos: MapInfoJSON[]): string {
  const outPath = join(
    repoRoot,
    "packages",
    "engine-api",
    "src",
    "game",
    "Maps.gen.ts",
  );
  const b: string[] = [];
  const list = (xs: string[]) => xs.map(q).join(", ");
  b.push("// Code generated by map-generator; DO NOT EDIT.\n");
  b.push(
    "// Map metadata lives in map-generator/assets/maps/<map>/info.json.\n",
  );
  b.push("// Regenerate with `npm run gen-maps`.\n\n");

  b.push("export enum GameMapType {\n");
  for (const info of infos) {
    b.push(
      `  ${info.id} = ${q(info.name)}, // map-generator/assets/maps/${info.id.toLowerCase()}/info.json\n`,
    );
  }
  b.push("}\n\n");
  b.push("export type GameMapName = keyof typeof GameMapType;\n\n");

  b.push("export type MapCategory =\n");
  categoryOrder.forEach((c, i) =>
    b.push(`  | ${q(c)}${i === categoryOrder.length - 1 ? ";\n\n" : "\n"}`),
  );
  b.push("// Category display order in the map picker.\n");
  b.push("export const mapCategoryOrder: readonly MapCategory[] = [\n");
  for (const c of categoryOrder) b.push(`  ${q(c)},\n`);
  b.push("];\n\n");

  b.push("export type SpecialModifierKey =\n");
  modifierKeys.forEach((k, i) =>
    b.push(`  | ${q(k)}${i === modifierKeys.length - 1 ? ";\n\n" : "\n"}`),
  );

  b.push(`export interface MapInfo {
  /** GameMapType enum key — the UpperCamelCase folder name. */
  id: GameMapName;
  /** Canonical map name (wire format) — the GameMapType enum value. */
  type: GameMapType;
  /** Key of the map's display name in resources/lang/en.json. */
  translationKey: string;
  /** Map picker categories. */
  categories: MapCategory[];
  /** Position in the featured grid (1 = first); unranked featured maps sort last. */
  featuredRank?: number;
  /** Kept out of map pickers, random picks and public lobbies. */
  hidden?: boolean;
  /** Preferred team count in team/special games (see MapPlaylist). */
  specialTeamCount?: number;
  /** Modifiers that should never be rolled for this map in special games. */
  disabledModifiers?: SpecialModifierKey[];
  /** Modifiers forced on for this map. Plain key or "key:percentage" (e.g. "goldMultiplier:75"). */
  forcedModifiers?: string[];
  /** Tribe name theme(s) (keys in tribeNameThemes.json). */
  themes?: string[];
  /** Custom tribe entry: a string (random spawn) or an object with name and coordinates. */
  customTribes?: CustomTribe[];
  /** Map layers rendered between terrain and territory. */
  layers?: MapLayer[];
  /** Default nation count defined in the map's manifest/info. */
  defaultNationCount: number;
  /** Map creator. */
  author?: string;
  /** Key of the map's description in resources/lang/en.json. */
  descriptionKey?: string;
  /** Where the map lies on Earth (the map picker's Atlas tab). */
  location?: { lat: number; lon: number };
}

export interface CustomTribe {
  name: string;
  coordinates?: [number, number];
}

export type LayerPlacement = "land" | "water";

export interface MapLayer {
  /** Unique identifier — also the PNG filename (without extension). */
  id: string;
  /** Whether the layer sits on land or water tiles. */
  placement: LayerPlacement;
  /** If true, the layer is permanently destroyed in nuke impact radii. */
  nukeable?: boolean;
}

`);

  b.push("export const maps: readonly MapInfo[] = [\n");
  for (const info of infos) {
    b.push("  {\n");
    b.push(`    id: ${q(info.id)},\n`);
    b.push(`    type: GameMapType.${info.id},\n`);
    b.push(`    translationKey: ${q(info.translationKey)},\n`);
    b.push(`    categories: [${list(info.categories)}],\n`);
    b.push(`    defaultNationCount: ${info.nationNames.length},\n`);
    if (info.featuredRank > 0)
      b.push(`    featuredRank: ${info.featuredRank},\n`);
    if (info.hidden) b.push("    hidden: true,\n");
    if (info.specialTeamCount > 0)
      b.push(`    specialTeamCount: ${info.specialTeamCount},\n`);
    if (info.disabledModifiers.length > 0)
      b.push(`    disabledModifiers: [${list(info.disabledModifiers)}],\n`);
    if (info.forcedModifiers.length > 0)
      b.push(`    forcedModifiers: [${list(info.forcedModifiers)}],\n`);
    if (info.themes.length > 0) b.push(`    themes: [${list(info.themes)}],\n`);
    if (info.customTribes.length > 0) {
      const tribes = info.customTribes.map((ct) =>
        ct.coordinates
          ? `{name: ${q(ct.name)}, coordinates: [${ct.coordinates[0]}, ${ct.coordinates[1]}]}`
          : `{name: ${q(ct.name)}}`,
      );
      b.push(`    customTribes: [${tribes.join(", ")}],\n`);
    }
    if (info.layers.length > 0) {
      const layers = info.layers.map(
        (l) =>
          `{id: ${q(l.id)}, placement: ${q(l.placement)}${l.nukeable ? ", nukeable: true" : ""}}`,
      );
      b.push(`    layers: [${layers.join(", ")}],\n`);
    }
    if (info.author !== "") b.push(`    author: ${q(info.author)},\n`);
    if (info.description !== "")
      b.push(
        `    descriptionKey: ${q("map_description." + info.id.toLowerCase())},\n`,
      );
    if (info.location) {
      b.push(
        `    location: {lat: ${info.location.lat}, lon: ${info.location.lon}},\n`,
      );
    }
    b.push("  },\n");
  }
  b.push("];\n");
  writeFileSync(outPath, b.join(""));
  return outPath;
}

export function generateEnJSON(infos: MapInfoJSON[]): string {
  const enPath = join(repoRoot, "resources", "lang", "en.json");
  const root = JSON.parse(readFileSync(enPath, "utf8")) as Record<
    string,
    unknown
  >;
  const old = root.map;
  if (old === null || typeof old !== "object" || Array.isArray(old)) {
    throw new Error('en.json has no top-level "map" object');
  }
  const folders = new Set(infos.map((i) => i.id.toLowerCase()));
  const section: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(old)) if (!folders.has(k)) section[k] = v;
  for (const info of infos)
    section[info.id.toLowerCase()] = info.displayName || info.name;
  root.map = section;

  const descriptions: Record<string, unknown> = {};
  for (const info of infos)
    if (info.description !== "")
      descriptions[info.id.toLowerCase()] = info.description;
  root.map_description = descriptions;

  const layers: Record<string, unknown> = {};
  const existing = root.map_layers;
  if (
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
  )
    Object.assign(layers, existing);
  for (const info of infos)
    for (const l of info.layers)
      if (!Object.prototype.hasOwnProperty.call(layers, l.id))
        layers[l.id] = l.id;
  root.map_layers = layers;

  writeFileSync(enPath, sortedJSON(root) + "\n");
  return enPath;
}
