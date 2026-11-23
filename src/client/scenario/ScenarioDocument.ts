/**
 * The scenario document (docs/ScenarioEditor.md, "1. Scenario document"):
 * the editor's own format and the only thing it edits. It holds what the
 * author decided and nothing the engine derives, and it takes from the
 * engine only its stable contract (command, id and config schemas), so a
 * document written today opens in a later build.
 *
 * The schema is the stored form, JSON for browser storage and the API. It
 * parses into a ScenarioDocument, the form the editor works on.
 */

import {
  AddNationCommandSchema,
  PlaceStructureCommandSchema,
  SetNationCommandSchema,
} from "@openfront/engine-api/EditorCommands";
import { Difficulty, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameConfigSchema, ID } from "@openfront/engine-api/Schemas";
import { generateID } from "@openfront/shared/SharedUtil";
import { z } from "zod";

/** The version of the stored form. A change to it gets a new one. */
export const SCENARIO_FORMAT = 1;

// Each side is at least 100, which leaves room for a few nations and a 16x
// map at least 25 tiles wide, and at most 5000, so a map is at most 25M
// tiles: about three times the largest stock maps in play.
export const MIN_SIDE = 100;
export const MAX_SIDE = 5000;

/** Whether a scenario's map can be this size. */
export function isScenarioSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_SIDE &&
    height >= MIN_SIDE &&
    width % 4 === 0 &&
    height % 4 === 0 &&
    width <= MAX_SIDE &&
    height <= MAX_SIDE
  );
}

// GameConfig's limit on the number of nations.
export const MAX_NATIONS = 400;

/** Authored terrain bytes (see SetTerrainCommandSchema). */
export const WATER = 0;
export const IMPASSABLE = 0x9f;
export const MAX_ELEVATION = 30;
export function land(elevation: number): number {
  return 0x80 | elevation;
}

export function isAuthoredTerrain(b: number): boolean {
  return Number.isInteger(b) && (b === WATER || (b >= 0x80 && b <= IMPASSABLE));
}

/** Land a nation can own: not water and not impassable. */
export function isOwnable(b: number): boolean {
  return b !== WATER && b !== IMPASSABLE;
}

const Amount = SetNationCommandSchema.shape.troops.unwrap();

export const ScenarioNationSchema = z.object({
  /** The engine's id for the nation, the one add_nation takes. */
  id: ID,
  name: AddNationCommandSchema.shape.name,
  flag: AddNationCommandSchema.shape.flag,
  troops: Amount,
  gold: Amount,
  /** A human may be assigned this nation. */
  playable: z.boolean(),
});
export type ScenarioNation = z.infer<typeof ScenarioNationSchema>;

// What a human starts with in play.
const NEW_NATION_TROOPS = 25_000;

/**
 * A nation to add to the document: a new id, and the first of `name(1)`,
 * `name(2)`, ... that no nation has.
 */
export function newNation(
  doc: ScenarioDocument,
  name: (n: number) => string,
): ScenarioNation {
  const names = new Set(doc.nations.map((n) => n.name));
  let n = 1;
  while (names.has(name(n))) n++;
  let id = generateID();
  while (doc.nations.some((other) => other.id === id)) id = generateID();
  return {
    id,
    name: name(n),
    flag: null,
    troops: NEW_NATION_TROOPS,
    gold: 0,
    playable: false,
  };
}

export const ScenarioStructureSchema = z.object({
  type: PlaceStructureCommandSchema.shape.unit,
  tile: z.int().nonnegative(),
  /** The id of the nation it belongs to, which owns its tile. */
  nation: ID,
  level: PlaceStructureCommandSchema.shape.level,
});
export type ScenarioStructure = z.infer<typeof ScenarioStructureSchema>;

/**
 * The game settings an author chooses. A scenario is always free-for-all,
 * at normal size, on its own map, with its own nations and no bots or
 * random spawns, and each nation's gold is its own, so the settings for
 * those are not here.
 */
export const ScenarioConfigSchema = GameConfigSchema.pick({
  difficulty: true,
  donateGold: true,
  donateTroops: true,
  infiniteGold: true,
  infiniteTroops: true,
  instantBuild: true,
  disabledUnits: true,
  maxTimerValue: true,
  goldMultiplier: true,
  customAllianceDuration: true,
  waterNukes: true,
  doomsdayClock: true,
  overtime: true,
});
export type ScenarioConfig = z.infer<typeof ScenarioConfigSchema>;

export const ScenarioWarshipSchema = z.object({
  /** The id of the nation it belongs to. */
  nation: ID,
  /** A water tile, which it patrols around once the game starts. */
  tile: z.int().nonnegative(),
});
export type ScenarioWarship = z.infer<typeof ScenarioWarshipSchema>;

// Each one runs a warship's execution, with its targeting and pathfinding,
// every tick of the game.
export const MAX_WARSHIPS = 1000;

/** Whether the settings allow warships. */
export function warshipsAllowed(config: ScenarioConfig): boolean {
  return !config.disabledUnits?.includes(UnitType.Warship);
}

/** Two nations allied from the start, by id, the lesser id first. */
export type ScenarioAlliance = [string, string];

/** Whether the settings allow alliances (as Config.disableAlliances). */
export function alliancesAllowed(config: ScenarioConfig): boolean {
  return config.customAllianceDuration !== 0;
}

export interface ScenarioMeta {
  name: string;
  description: string;
}

/** The document as the editor works on it. */
export interface ScenarioDocument {
  meta: ScenarioMeta;
  width: number;
  height: number;
  /** One authored byte per tile, row by row. */
  terrain: Uint8Array;
  nations: ScenarioNation[];
  /** Per tile: 0 for nobody, i for nations[i - 1]. */
  owners: Uint16Array;
  /** At most one per tile, in tile order. */
  structures: ScenarioStructure[];
  /** Each pair once, in order (see addAlliance). */
  alliances: ScenarioAlliance[];
  /** At most one per tile, in tile order. */
  warships: ScenarioWarship[];
  config: ScenarioConfig;
}

const Side = z.int().min(MIN_SIDE).max(MAX_SIDE).multipleOf(4);

/**
 * The stored form. Terrain is base64. Ownership is run-length encoded as
 * [owner, count, owner, count, ...] over the tiles in row order, with
 * owner 0 for nobody and i for nations[i - 1].
 */
export const ScenarioDocumentSchema = z
  .object({
    format: z.literal(SCENARIO_FORMAT),
    meta: z.object({
      name: z.string().min(1).max(64),
      description: z.string().max(1000),
    }),
    terrain: z.object({
      width: Side,
      height: Side,
      tiles: z.base64(),
    }),
    nations: z.array(ScenarioNationSchema).max(MAX_NATIONS),
    ownership: z.array(z.int().nonnegative()),
    structures: z.array(ScenarioStructureSchema),
    // Optional, so a document from before alliances still loads, and left
    // out when there are none.
    alliances: z.array(z.tuple([ID, ID])).optional(),
    // Optional for the same reasons.
    warships: z.array(ScenarioWarshipSchema).max(MAX_WARSHIPS).optional(),
    config: ScenarioConfigSchema,
  })
  .transform((stored, ctx): ScenarioDocument => {
    try {
      return decode(stored);
    } catch (e) {
      ctx.issues.push({
        code: "custom",
        message: e instanceof Error ? e.message : String(e),
        input: stored,
      });
      return z.NEVER;
    }
  });
export type StoredScenarioDocument = z.input<typeof ScenarioDocumentSchema>;

function decode(stored: StoredScenarioDocument): ScenarioDocument {
  const { width, height } = stored.terrain;
  const size = width * height;
  const terrain = base64ToBytes(stored.terrain.tiles);
  if (terrain.length !== size) {
    throw new Error(`${terrain.length} terrain bytes for ${size} tiles`);
  }
  terrain.forEach((b, tile) => {
    if (!isAuthoredTerrain(b)) {
      throw new Error(`tile ${tile} has terrain ${b}, not an authored value`);
    }
  });
  const ids = new Set(stored.nations.map((n) => n.id));
  if (ids.size !== stored.nations.length) {
    throw new Error("two nations have the same id");
  }
  const owners = decodeOwnership(stored.ownership, size, stored.nations.length);
  owners.forEach((owner, tile) => {
    if (owner !== 0 && !isOwnable(terrain[tile])) {
      throw new Error(`tile ${tile} is owned but is not land`);
    }
  });
  const doc: ScenarioDocument = {
    meta: { ...stored.meta },
    width,
    height,
    terrain,
    nations: stored.nations.map((n) => ({ ...n })),
    owners,
    structures: stored.structures
      .map((s) => ({ ...s }))
      .sort((a, b) => a.tile - b.tile),
    alliances: [],
    warships: [],
    config: stored.config,
  };
  doc.structures.forEach((s, i) => {
    if (i > 0 && doc.structures[i - 1].tile === s.tile) {
      throw new Error(`tile ${s.tile} already has a structure`);
    }
    checkStructure(doc, s);
  });
  // addAlliance's rules, checked in one pass: a dense document has tens of
  // thousands of pairs, too many to insert one at a time.
  const alliances = stored.alliances ?? [];
  if (alliances.length > 0 && !alliancesAllowed(doc.config)) {
    throw new Error("alliances are disabled in this scenario");
  }
  doc.alliances = alliances
    .map(([a, b]): ScenarioAlliance => {
      // nationIndex throws the error for a nation that isn't there.
      if (!ids.has(a)) nationIndex(doc, a);
      if (!ids.has(b)) nationIndex(doc, b);
      if (a === b) throw new Error(`${a} can't ally with itself`);
      return a < b ? [a, b] : [b, a];
    })
    .sort(comparePairs);
  doc.alliances.forEach((p, i) => {
    if (i > 0 && comparePairs(doc.alliances[i - 1], p) === 0) {
      throw new Error(`${p[0]} and ${p[1]} are already allies`);
    }
  });
  // addWarship's rules, in one pass as well.
  const warships = stored.warships ?? [];
  if (warships.length > 0 && !warshipsAllowed(doc.config)) {
    throw new Error(`${UnitType.Warship} is disabled in this scenario`);
  }
  doc.warships = warships
    .map((w) => ({ ...w }))
    .sort((a, b) => a.tile - b.tile);
  doc.warships.forEach((w, i) => {
    if (!ids.has(w.nation)) nationIndex(doc, w.nation);
    checkWarshipTile(doc, w.tile);
    if (i > 0 && doc.warships[i - 1].tile === w.tile) {
      throw new Error(`tile ${w.tile} already has a warship`);
    }
  });
  return doc;
}

export function serializeScenarioDocument(
  doc: ScenarioDocument,
): StoredScenarioDocument {
  return {
    format: SCENARIO_FORMAT,
    meta: { ...doc.meta },
    terrain: {
      width: doc.width,
      height: doc.height,
      tiles: bytesToBase64(doc.terrain),
    },
    nations: doc.nations.map((n) => ({ ...n })),
    ownership: encodeOwnership(doc.owners),
    structures: doc.structures.map((s) => ({ ...s })),
    ...(doc.alliances.length > 0
      ? { alliances: doc.alliances.map(([a, b]): ScenarioAlliance => [a, b]) }
      : {}),
    ...(doc.warships.length > 0
      ? { warships: doc.warships.map((w) => ({ ...w })) }
      : {}),
    config: doc.config,
  };
}

/** A new document: all water, no nations, the game's default settings. */
export function newScenarioDocument(
  name: string,
  width: number,
  height: number,
): ScenarioDocument {
  return ScenarioDocumentSchema.parse({
    format: SCENARIO_FORMAT,
    meta: { name, description: "" },
    terrain: {
      width,
      height,
      tiles: bytesToBase64(new Uint8Array(width * height)),
    },
    nations: [],
    ownership: [0, width * height],
    structures: [],
    config: {
      difficulty: Difficulty.Medium,
      donateGold: false,
      donateTroops: false,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
    },
  } satisfies StoredScenarioDocument);
}

/**
 * The document on a map of another size, which keeps its top-left corner:
 * cropped tiles go with their owners, structures and warships, new ones
 * are water, and a port left without a shore goes. Nations, alliances and
 * settings stay.
 */
export function resizeScenarioDocument(
  doc: ScenarioDocument,
  width: number,
  height: number,
): ScenarioDocument {
  if (!isScenarioSize(width, height)) {
    throw new Error(`a scenario can't be ${width}x${height}`);
  }
  const terrain = new Uint8Array(width * height);
  const owners = new Uint16Array(width * height);
  const rowLength = Math.min(width, doc.width);
  for (let y = 0; y < Math.min(height, doc.height); y++) {
    const from = y * doc.width;
    terrain.set(doc.terrain.subarray(from, from + rowLength), y * width);
    owners.set(doc.owners.subarray(from, from + rowLength), y * width);
  }
  const resized: ScenarioDocument = {
    ...doc,
    meta: { ...doc.meta },
    width,
    height,
    terrain,
    nations: doc.nations.map((n) => ({ ...n })),
    owners,
    structures: [],
    alliances: doc.alliances.map(([a, b]): ScenarioAlliance => [a, b]),
    warships: [],
  };
  for (const s of doc.structures) {
    const x = s.tile % doc.width;
    const y = Math.floor(s.tile / doc.width);
    if (x >= width || y >= height) continue;
    const tile = y * width + x;
    if (s.type === UnitType.Port && !isShore(resized, tile)) continue;
    resized.structures.push({ ...s, tile });
  }
  // A tile kept keeps its terrain, so a warship on one is still on water.
  for (const w of doc.warships) {
    const x = w.tile % doc.width;
    const y = Math.floor(w.tile / doc.width);
    if (x >= width || y >= height) continue;
    resized.warships.push({ ...w, tile: y * width + x });
  }
  return resized;
}

export function encodeOwnership(owners: Uint16Array): number[] {
  const runs: number[] = [];
  for (let i = 0; i < owners.length;) {
    let end = i + 1;
    while (end < owners.length && owners[end] === owners[i]) end++;
    runs.push(owners[i], end - i);
    i = end;
  }
  return runs;
}

export function decodeOwnership(
  runs: readonly number[],
  size: number,
  nations: number,
): Uint16Array {
  if (runs.length % 2 !== 0) {
    throw new Error("ownership runs come in [owner, count] pairs");
  }
  const uncovered = new Error(`ownership runs don't cover the ${size} tiles`);
  const owners = new Uint16Array(size);
  let at = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const [owner, count] = [runs[i], runs[i + 1]];
    if (owner > nations) throw new Error(`ownership names nation ${owner}`);
    if (count === 0) throw new Error("an ownership run is empty");
    if (at + count > size) throw uncovered;
    owners.fill(owner, at, at + count);
    at += count;
  }
  if (at !== size) throw uncovered;
  return owners;
}

export function nationIndex(doc: ScenarioDocument, id: string): number {
  const i = doc.nations.findIndex((n) => n.id === id);
  if (i === -1) throw new Error(`no nation ${id}`);
  return i;
}

export function structureAt(
  doc: ScenarioDocument,
  tile: number,
): ScenarioStructure | undefined {
  return doc.structures.find((s) => s.tile === tile);
}

/** Land beside water, as the engine marks shore (a port needs one). */
export function isShore(doc: ScenarioDocument, tile: number): boolean {
  const { terrain, width: w, height: h } = doc;
  if (!isOwnable(terrain[tile])) return false;
  const x = tile % w;
  return (
    (tile >= w && terrain[tile - w] === WATER) ||
    (tile < (h - 1) * w && terrain[tile + w] === WATER) ||
    (x > 0 && terrain[tile - 1] === WATER) ||
    (x < w - 1 && terrain[tile + 1] === WATER)
  );
}

/**
 * Throws unless the structure could stand in the document as it is, other
 * structures aside.
 */
function checkStructure(doc: ScenarioDocument, s: ScenarioStructure): void {
  checkTile(doc, s.tile);
  if (doc.owners[s.tile] !== nationIndex(doc, s.nation) + 1) {
    throw new Error(`tile ${s.tile} is not ${s.nation}'s`);
  }
  if (s.type === UnitType.Port && !isShore(doc, s.tile)) {
    throw new Error(`a port needs a shore tile, ${s.tile} is not`);
  }
  if (doc.config.disabledUnits?.includes(s.type)) {
    throw new Error(`${s.type} is disabled in this scenario`);
  }
  // The one structure Config doesn't make upgradable.
  if (s.level > 1 && s.type === UnitType.DefensePost) {
    throw new Error(`${s.type} has no levels`);
  }
}

/**
 * Adds the structure in tile order, so a document's structures don't
 * depend on the order they were placed in. Throws unless it can stand.
 */
export function addStructure(
  doc: ScenarioDocument,
  s: ScenarioStructure,
): void {
  if (structureAt(doc, s.tile) !== undefined) {
    throw new Error(`tile ${s.tile} already has a structure`);
  }
  checkStructure(doc, s);
  const i = doc.structures.findIndex((other) => other.tile > s.tile);
  doc.structures.splice(i === -1 ? doc.structures.length : i, 0, s);
}

export function warshipAt(
  doc: ScenarioDocument,
  tile: number,
): ScenarioWarship | undefined {
  return doc.warships.find((w) => w.tile === tile);
}

/** Throws unless a warship can be on the tile: on the map, and water. */
function checkWarshipTile(doc: ScenarioDocument, tile: number): void {
  checkTile(doc, tile);
  if (doc.terrain[tile] !== WATER) {
    throw new Error(`a warship needs water, tile ${tile} is not`);
  }
}

/**
 * Adds the warship in tile order, as structures are kept. Throws unless
 * its nation exists, its tile is water with no warship, the settings allow
 * warships and the document has fewer than MAX_WARSHIPS.
 */
export function addWarship(doc: ScenarioDocument, w: ScenarioWarship): void {
  nationIndex(doc, w.nation);
  checkWarshipTile(doc, w.tile);
  if (warshipAt(doc, w.tile) !== undefined) {
    throw new Error(`tile ${w.tile} already has a warship`);
  }
  if (!warshipsAllowed(doc.config)) {
    throw new Error(`${UnitType.Warship} is disabled in this scenario`);
  }
  if (doc.warships.length >= MAX_WARSHIPS) {
    throw new Error(`a scenario has at most ${MAX_WARSHIPS} warships`);
  }
  const i = doc.warships.findIndex((other) => other.tile > w.tile);
  doc.warships.splice(i === -1 ? doc.warships.length : i, 0, w);
}

/** Orders alliance pairs by their first id, then their second. */
function comparePairs(p: ScenarioAlliance, q: ScenarioAlliance): number {
  if (p[0] !== q[0]) return p[0] < q[0] ? -1 : 1;
  if (p[1] !== q[1]) return p[1] < q[1] ? -1 : 1;
  return 0;
}

/** The pair's place in doc.alliances, or -1. */
export function allianceIndex(
  doc: ScenarioDocument,
  a: string,
  b: string,
): number {
  const [x, y] = a < b ? [a, b] : [b, a];
  return doc.alliances.findIndex(([p, q]) => p === x && q === y);
}

/**
 * Allies two nations, as a pair with the lesser id first (the engine's
 * requestor), kept in order of the pairs, so a document's alliances don't
 * depend on the order they were made in. Returns the pair; throws unless
 * both nations exist and differ, they are not allies yet, and the settings
 * allow alliances.
 */
export function addAlliance(
  doc: ScenarioDocument,
  a: string,
  b: string,
): ScenarioAlliance {
  nationIndex(doc, a);
  nationIndex(doc, b);
  if (a === b) throw new Error(`${a} can't ally with itself`);
  if (!alliancesAllowed(doc.config)) {
    throw new Error("alliances are disabled in this scenario");
  }
  if (allianceIndex(doc, a, b) !== -1) {
    throw new Error(`${a} and ${b} are already allies`);
  }
  const pair: ScenarioAlliance = a < b ? [a, b] : [b, a];
  const i = doc.alliances.findIndex((p) => comparePairs(p, pair) > 0);
  doc.alliances.splice(i === -1 ? doc.alliances.length : i, 0, pair);
  return pair;
}

export function checkTile(doc: ScenarioDocument, tile: number): void {
  if (!Number.isInteger(tile) || tile < 0 || tile >= doc.terrain.length) {
    throw new Error(`tile ${tile} is not on the map`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
