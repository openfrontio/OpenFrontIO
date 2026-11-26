// @vitest-environment node
/**
 * Scenario bundles (docs/ScenarioEditor.md, "3. Snapshot"): a document
 * exports to bundle bytes, the bytes load back through the client's map
 * loader, and the snapshot restores onto the bundle's map files and plays.
 * Loading refuses a bundle that is too large, corrupt, or tampered with,
 * and exporting leaves the live editor as it was.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import {
  CustomGameMap,
  GameMapSize,
  Structures,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { afterEach, expect, test, vi } from "vitest";
import {
  gunzipInBrowser,
  gzipInBrowser,
} from "../../../src/client/replay/BrowserGzip";
import {
  DocumentEditor,
  type Edit,
} from "../../../src/client/scenario/DocumentEditor";
import {
  blankMapFiles,
  editorStartInfo,
} from "../../../src/client/scenario/EditorEngine";
import {
  encodeScenarioBundle,
  loadScenarioBundle,
  MAX_BUNDLE_BYTES,
  type ScenarioBundleContent,
  ScenarioBundleError,
  useScenarioMap,
} from "../../../src/client/scenario/ScenarioBundle";
import {
  IMPASSABLE,
  land,
  newScenarioDocument,
  type ScenarioDocument,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
  WATER,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  type ExportEngine,
  exportScenario,
  thumbnailPixels,
} from "../../../src/client/scenario/ScenarioExport";
import { replayDocument } from "../../../src/client/scenario/ScenarioReplay";
import { terrainMapFileLoader } from "../../../src/client/TerrainMapFileLoader";

const W = 200;
const H = 160;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SCENARIO = { id: "SCEN0001", version: 3 };
// The 12 bytes a webp starts with; the loader checks no more.
const WEBP = new Uint8Array([
  ...new TextEncoder().encode("RIFF"),
  4,
  0,
  0,
  0,
  ...new TextEncoder().encode("WEBP"),
]);

afterEach(() => vi.unstubAllGlobals());

function throwOnError(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) throw new Error(gu.errMsg);
}

const tile = (x: number, y: number) => y * W + x;

function rect(x: number, y: number, w: number, h: number): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) tiles.push(tile(x + dx, y + dy));
  }
  return tiles;
}

function nation(id: string, fields: object = {}) {
  return {
    id,
    name: id.slice(0, 4),
    flag: null,
    troops: 1000,
    gold: 0,
    playable: false,
    ...fields,
  };
}

const CONTINENT = rect(20, 30, 160, 100);

/**
 * Painted land with a mountain range, two allied nations with land, a city,
 * a port and a warship each.
 */
const BUILD: Edit[] = [
  {
    type: "set_terrain",
    tiles: CONTINENT,
    terrain: CONTINENT.map((t) => land(t % 31)),
  },
  {
    type: "set_terrain",
    tiles: rect(95, 40, 4, 60),
    terrain: rect(95, 40, 4, 60).map(() => IMPASSABLE),
  },
  {
    type: "add_nation",
    nation: nation("WESTNAT1", { troops: 20_000, gold: 500, playable: true }),
  },
  { type: "add_nation", nation: nation("EASTNAT1", { flag: "fr" }) },
  { type: "set_owner", tiles: rect(20, 60, 25, 25), owner: "WESTNAT1" },
  { type: "set_owner", tiles: rect(155, 80, 25, 25), owner: "EASTNAT1" },
  {
    type: "place_structure",
    structure: {
      type: UnitType.City,
      tile: tile(30, 65),
      nation: "WESTNAT1",
      level: 2,
    },
  },
  {
    type: "place_structure",
    structure: {
      type: UnitType.Port,
      tile: tile(179, 90),
      nation: "EASTNAT1",
      level: 1,
    },
  },
  {
    type: "place_warship",
    warship: { nation: "WESTNAT1", tile: tile(10, 70) },
  },
  {
    type: "place_warship",
    warship: { nation: "EASTNAT1", tile: tile(190, 90) },
  },
  { type: "add_alliance", nations: ["WESTNAT1", "EASTNAT1"] },
];

interface Live {
  doc: ScenarioDocument;
  runner: GameRunner;
  editor: DocumentEditor;
  editing: (command: EditorCommand) => Promise<MapFiles | undefined>;
}

/** The editor as it runs: a document and its engine, edited together. */
async function liveEditor(): Promise<Live> {
  const doc = newScenarioDocument("Test", W, H);
  doc.config.donateGold = true;
  const runner = await createGameRunner(
    editorStartInfo(),
    undefined,
    blankMapFiles(W, H),
    throwOnError,
    true,
  );
  replayDocument(doc, (c) => runner.applyEditorCommand(c));
  const editor = new DocumentEditor(doc, (c) => runner.applyEditorCommand(c));
  for (const edit of BUILD) editor.apply(edit);
  editor.commit();
  return {
    doc,
    runner,
    editor,
    editing: async (c) => runner.applyEditorCommand(c),
  };
}

/** The export's second engine, on a GameRunner as in the worker. */
async function runnerEngine(
  start: GameStartInfo,
  files: MapFiles,
): Promise<ExportEngine> {
  const runner = await createGameRunner(
    start,
    undefined,
    files,
    throwOnError,
    true,
  );
  return {
    command: async (c) => runner.applyEditorCommand(c),
    snapshot: async (gitCommit) => runner.snapshot(gitCommit),
    close: () => {},
  };
}

function exportLive(live: Live): Promise<Uint8Array> {
  return exportScenario(live.doc, live.editing, {
    scenario: SCENARIO,
    gitCommit: COMMIT,
    startEngine: runnerEngine,
    renderThumbnail: async () => WEBP,
  });
}

function copy(doc: ScenarioDocument): ScenarioDocument {
  return ScenarioDocumentSchema.parse(serializeScenarioDocument(doc));
}

/** Loads a bundle as a game on it does, and restores its snapshot. */
async function restore(gzipped: Uint8Array): Promise<GameRunner> {
  const bundle = await loadScenarioBundle(gzipped);
  useScenarioMap(bundle);
  return createGameRunnerFromSnapshot(
    editorStartInfo(),
    bundle.snapshot,
    undefined,
    await loadMapFiles(terrainMapFileLoader, CustomGameMap, GameMapSize.Normal),
    throwOnError,
  );
}

/** What a game holds of a document, by nation id. */
function gameState(runner: GameRunner) {
  const game = runner.game;
  const map = game.map();
  const terrain: Uint8Array = new Uint8Array(map.width() * map.height());
  const owners: (string | null)[] = [];
  game.forEachTile((t) => {
    // The authored bits (see SetTerrainCommandSchema).
    const b = map.terrainByte(t);
    terrain[t] = (b & 0x80) === 0 ? 0 : b & 0x9f;
    const owner = game.owner(t);
    owners.push(owner.isPlayer() ? owner.id() : null);
  });
  return {
    terrain,
    owners,
    nations: game
      .nations()
      .map((n) => game.player(n.playerInfo.id))
      .map((p) => ({
        id: p.id(),
        name: p.name(),
        flag: p.info().nationFlag,
        troops: p.troops(),
        gold: Number(p.gold()),
        playable: p.playable(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    structures: game
      .units(Structures.types)
      .map((u) => ({
        type: u.type(),
        tile: u.tile(),
        nation: u.owner().id(),
        level: u.level(),
      }))
      .sort((a, b) => a.tile - b.tile),
    warships: game
      .units(UnitType.Warship)
      .map((u) => ({ nation: u.owner().id(), tile: u.tile() }))
      .sort((a, b) => a.tile - b.tile),
    // Each once, though both allies have it: requestor first.
    alliances: [
      ...new Set(
        game.nations().flatMap((n) => game.player(n.playerInfo.id).alliances()),
      ),
    ]
      .map((a): [string, string] => [a.requestor().id(), a.recipient().id()])
      .sort((x, y) => (x.join() < y.join() ? -1 : 1)),
  };
}

function documentState(doc: ScenarioDocument): ReturnType<typeof gameState> {
  return {
    terrain: doc.terrain,
    owners: Array.from(doc.owners, (o) =>
      o === 0 ? null : doc.nations[o - 1].id,
    ),
    nations: [...doc.nations].sort((a, b) => a.id.localeCompare(b.id)),
    structures: doc.structures,
    warships: doc.warships,
    alliances: doc.alliances,
  };
}

test("an exported bundle loads and restores to the document, and plays", async () => {
  const live = await liveEditor();
  const gzipped = await exportLive(live);

  const bundle = await loadScenarioBundle(gzipped);
  expect(bundle.header).toMatchObject({
    format: 1,
    scenario: SCENARIO,
    engineCommit: COMMIT,
    nations: [
      { id: "WESTNAT1", name: "WEST", flag: null, playable: true },
      { id: "EASTNAT1", name: "EAST", flag: "fr", playable: false },
    ],
  });
  // The mountain range is not land a nation can take.
  expect(bundle.files.manifest.map.num_land_tiles).toBe(
    CONTINENT.length - 4 * 60,
  );
  expect(bundle.thumbnail).toEqual(WEBP);

  const runner = await restore(gzipped);
  expect(live.doc.structures).toHaveLength(2);
  expect(live.doc.warships).toHaveLength(2);
  expect(live.doc.alliances).toEqual([["EASTNAT1", "WESTNAT1"]]);
  expect(gameState(runner)).toEqual(documentState(live.doc));
  // Made at the start, for the settings' alliance duration.
  const alliance = runner.game
    .player("EASTNAT1")
    .allianceWith(runner.game.player("WESTNAT1"))!;
  expect(alliance.createdAt()).toBe(0);
  expect(alliance.expiresAt()).toBe(runner.game.config().allianceDuration());
  // The snapshot keeps the document's settings and the exporting build.
  expect(runner.game.config().gameConfig().donateGold).toBe(true);
  expect(runner.game.inSpawnPhase()).toBe(false);

  for (let turn = 0; turn < 20; turn++) {
    runner.addTurn({ turnNumber: turn, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
  expect(runner.game.player("WESTNAT1").isAlive()).toBe(true);
  expect(runner.game.player("EASTNAT1").isAlive()).toBe(true);
  expect(
    runner.game.player("WESTNAT1").isAlliedWith(runner.game.player("EASTNAT1")),
  ).toBe(true);
  // Each warship still patrols around the tile it was placed on.
  expect(
    runner.game
      .units(UnitType.Warship)
      .map((u) => [u.owner().id(), u.warshipState().patrolTile])
      .sort(),
  ).toEqual([
    ["EASTNAT1", tile(190, 90)],
    ["WESTNAT1", tile(10, 70)],
  ]);
}, 30_000);

test("exporting leaves the live editor as it was, and edits made meanwhile out", async () => {
  const live = await liveEditor();
  const before = copy(live.doc);
  const engineBefore = gameState(live.runner);

  const exporting = exportLive(live);
  // An edit while the export runs: the live editor takes it, the bundle
  // doesn't.
  live.editor.apply({
    type: "set_terrain",
    tiles: rect(20, 30, 10, 10),
    terrain: rect(20, 30, 10, 10).map(() => WATER),
  });
  live.editor.apply({ type: "set_nation", id: "EASTNAT1", name: "Orient" });
  live.editor.commit();
  const gzipped = await exporting;

  const restored = gameState(await restore(gzipped));
  expect(restored).toEqual(documentState(before));
  expect(restored).toEqual(engineBefore);

  // The live engine is still an editor's and holds the edit.
  expect(live.runner.game.inSpawnPhase()).toBe(true);
  expect(gameState(live.runner)).toEqual(documentState(live.doc));
  live.editor.undo();
  expect(live.doc).toEqual(before);
  expect(gameState(live.runner)).toEqual(engineBefore);

  // And editing goes on.
  live.editor.apply({
    type: "set_owner",
    tiles: rect(100, 40, 20, 20),
    owner: "EASTNAT1",
  });
  live.editor.commit();
  expect(gameState(live.runner)).toEqual(documentState(live.doc));
  expect(live.runner.game.player("EASTNAT1").numTilesOwned()).toBe(1025);
}, 30_000);

// --- Loading untrusted bytes ---

let content: ScenarioBundleContent | undefined;

/** A small valid bundle's parts, exported once. */
async function validContent(): Promise<ScenarioBundleContent> {
  if (content === undefined) {
    const live = await liveEditor();
    // The header's format and hash are written over when it's encoded.
    content = await loadScenarioBundle(await exportLive(live));
  }
  return structuredClone(content);
}

/** The bundle's frames before gzip. */
function readFrames(raw: Uint8Array): Uint8Array[] {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.length);
  const out: Uint8Array[] = [];
  for (let at = 0; at < raw.length;) {
    const length = view.getUint32(at, true);
    out.push(raw.slice(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return out;
}

function writeFrames(sections: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(sections.reduce((n, s) => n + 4 + s.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const s of sections) {
    view.setUint32(at, s.length, true);
    out.set(s, at + 4);
    at += 4 + s.length;
  }
  return out;
}

/** A valid bundle with its frames changed after it was hashed. */
async function tampered(
  change: (sections: Uint8Array[]) => void,
): Promise<Uint8Array> {
  const raw = await gunzipInBrowser(
    await encodeScenarioBundle(await validContent()),
  );
  const sections = readFrames(raw);
  change(sections);
  return gzipInBrowser(writeFrames(sections));
}

/** gzip of `n` zero bytes, never all in memory at once. */
async function gzipZeros(n: number): Promise<Uint8Array> {
  const chunk = new Uint8Array(1 << 20);
  let left = n;
  const zeros = new ReadableStream<Uint8Array<ArrayBuffer>>({
    pull(c) {
      if (left === 0) return c.close();
      const size = Math.min(left, chunk.length);
      c.enqueue(chunk.subarray(0, size));
      left -= size;
    },
  });
  const gz = zeros.pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(gz).arrayBuffer());
}

test("a bundle that inflates past the cap is refused before it is all inflated", async () => {
  const bomb = await gzipZeros(2 * MAX_BUNDLE_BYTES);
  expect(bomb.length).toBeLessThan(MAX_BUNDLE_BYTES / 500);

  // Counts what the browser's inflater hands out.
  let inflated = 0;
  const Real = DecompressionStream;
  vi.stubGlobal(
    "DecompressionStream",
    class {
      readonly writable: WritableStream<Uint8Array>;
      readonly readable: ReadableStream<Uint8Array>;
      constructor(format: CompressionFormat) {
        const real = new Real(format);
        this.writable = real.writable as WritableStream<Uint8Array>;
        this.readable = real.readable.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, c) {
              inflated += chunk.byteLength;
              c.enqueue(chunk);
            },
          }),
        );
      }
    },
  );
  const error = await loadScenarioBundle(bomb).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ScenarioBundleError);
  expect((error as ScenarioBundleError).problem).toBe("too_large");
  expect((error as Error).message).toContain(
    `inflates past ${MAX_BUNDLE_BYTES} bytes`,
  );
  expect(inflated).toBeGreaterThan(MAX_BUNDLE_BYTES);
  expect(inflated).toBeLessThan(1.1 * MAX_BUNDLE_BYTES);
}, 60_000);

test("a bundle that isn't gzip, or whose gzip is corrupt, is refused", async () => {
  await expect(
    loadScenarioBundle(new TextEncoder().encode("not a bundle")),
  ).rejects.toThrow("the bundle doesn't inflate");

  const gzipped = await encodeScenarioBundle(await validContent());
  const cut = gzipped.slice(0, gzipped.length - 100);
  await expect(loadScenarioBundle(cut)).rejects.toThrow(
    "the bundle doesn't inflate",
  );
  const flipped = gzipped.slice();
  flipped[gzipped.length - 6] ^= 0xff; // in the CRC
  await expect(loadScenarioBundle(flipped)).rejects.toThrow(
    "the bundle doesn't inflate",
  );
  await expect(loadScenarioBundle(flipped)).rejects.toMatchObject({
    problem: "malformed",
  });
});

test("a bundle that isn't the version its listing names is refused", async () => {
  const gzipped = await encodeScenarioBundle(await validContent());
  const { header } = await loadScenarioBundle(gzipped);
  await expect(loadScenarioBundle(gzipped, header.hash)).resolves.toMatchObject(
    { header },
  );
  await expect(loadScenarioBundle(gzipped, "f".repeat(64))).rejects.toThrow(
    "the bundle is not the scenario version asked for",
  );
  await expect(
    loadScenarioBundle(gzipped, "f".repeat(64)),
  ).rejects.toMatchObject({ problem: "hash" });
});

test("a bundle with a section that fails its check is refused", async () => {
  const valid = await validContent();
  const load = async (change: (c: ScenarioBundleContent) => void) => {
    const c = await validContent();
    change(c);
    return loadScenarioBundle(await encodeScenarioBundle(c));
  };

  await expect(
    load((c) => (c.header.scenario = { id: "not an id!", version: 1 })),
  ).rejects.toThrow("the bundle's header");
  await expect(
    load((c) => (c.header.nations = [{ ...valid.header.nations[0], id: "" }])),
  ).rejects.toThrow("the bundle's header");
  await expect(
    load(
      (c) =>
        (c.files.manifest = { ...valid.files.manifest, name: "No/slashes" }),
    ),
  ).rejects.toThrow("the bundle's manifest");
  await expect(
    load(
      (c) =>
        (c.files.manifest = {
          ...valid.files.manifest,
          map4x: { ...valid.files.manifest.map4x, width: 102 },
        }),
    ),
  ).rejects.toThrow("the manifest's maps don't scale from 200x160");
  await expect(
    load((c) => (c.files.map4xBin = valid.files.map4xBin!.subarray(1))),
  ).rejects.toThrow("a 100x80 map file has 7999 bytes");
  await expect(
    load((c) => (c.thumbnail = new Uint8Array([0x89, 0x50, 0x4e, 0x47]))),
  ).rejects.toThrow("the thumbnail is not webp");

  await expect(
    loadScenarioBundle(
      await tampered((sections) => sections.push(new Uint8Array(1))),
    ),
  ).rejects.toThrow("the bundle doesn't match its hash");
  await expect(
    loadScenarioBundle(await gzipInBrowser(new Uint8Array([200, 0, 0, 0]))),
  ).rejects.toThrow("the bundle is cut short");
});

test("a bundle whose content doesn't match its hash is refused", async () => {
  const bundle = await tampered((sections) => {
    // A tile of the map changed hands, after the hash was taken.
    sections[2][tile(50, 50)] ^= 0x80;
  });
  await expect(loadScenarioBundle(bundle)).rejects.toThrow(
    "the bundle doesn't match its hash",
  );

  const rehashed = await tampered((sections) => {
    const header = JSON.parse(new TextDecoder().decode(sections[0]));
    header.hash = "0".repeat(64);
    sections[0] = new TextEncoder().encode(JSON.stringify(header));
  });
  await expect(loadScenarioBundle(rehashed)).rejects.toThrow(
    "the bundle doesn't match its hash",
  );
  await expect(loadScenarioBundle(rehashed)).rejects.toMatchObject({
    problem: "hash",
  });
});

test("a bundle of another format is refused before anything else is read", async () => {
  for (const format of [2, 0, "1", undefined]) {
    const bundle = await tampered((sections) => {
      const header = JSON.parse(new TextDecoder().decode(sections[0]));
      header.format = format;
      sections[0] = new TextEncoder().encode(JSON.stringify(header));
      sections[1] = new Uint8Array([1, 2, 3]);
    });
    await expect(loadScenarioBundle(bundle)).rejects.toThrow(
      `bundle format ${String(format)}, this build reads 1`,
    );
    await expect(loadScenarioBundle(bundle)).rejects.toMatchObject({
      problem: "format",
    });
  }
});

test("the thumbnail is drawn from the 4x map as the map generator draws one", () => {
  const terrain = [
    WATER | 0x20, // ocean
    0x80 | 0x40 | 2, // shoreline land
    land(3),
    land(15),
    land(25),
    IMPASSABLE,
  ];
  // Every other tile of the top row; the rest is never drawn.
  const map4xBin = new Uint8Array(12 * 2).fill(land(0));
  terrain.forEach((b, i) => (map4xBin[2 * i] = b));
  const meta = (width: number, height: number) => ({
    width,
    height,
    num_land_tiles: 0,
  });
  const files = {
    ...blankMapFiles(24, 4),
    manifest: { ...blankMapFiles(24, 4).manifest, map4x: meta(12, 2) },
    map4xBin,
  };
  expect(Array.from(thumbnailPixels(files))).toEqual([
    // Transparent water keeps the generator's colour, as its webp does.
    ...[71, 133, 181, 0],
    ...[204, 203, 158, 255],
    ...[190, 214, 138, 255],
    ...[230, 213, 168, 255],
    ...[242, 242, 242, 255],
    ...[0, 0, 0, 0],
  ]);
});
