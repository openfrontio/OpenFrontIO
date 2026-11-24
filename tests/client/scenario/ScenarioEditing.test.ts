// @vitest-environment node
/**
 * The scenario document drives a real editor engine (docs/ScenarioEditor.md,
 * "Editor runtime"): replaying a document rebuilds it, every edit reaches
 * both, and undo takes both back. The check is always the same: the engine
 * holds what a fresh replay of the document gives.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import {
  CustomGameMap,
  Difficulty,
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
import { createGameRunner, GameRunner } from "@openfront/engine/GameRunner";
import {
  DocumentEditor,
  type Edit,
} from "../../../src/client/scenario/DocumentEditor";
import {
  editorStartInfo,
  startEditorEngine,
} from "../../../src/client/scenario/EditorEngine";
import {
  IMPASSABLE,
  land,
  newScenarioDocument,
  resizeScenarioDocument,
  type ScenarioConfig,
  type ScenarioDocument,
  type ScenarioNation,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
  WATER,
} from "../../../src/client/scenario/ScenarioDocument";
import { replayDocument } from "../../../src/client/scenario/ScenarioReplay";
import { TerrainStroke } from "../../../src/client/scenario/TerrainBrush";
import { scriptedGameStart } from "../../util/ScriptedGame";

const W = 200;
const H = 160;
// A terrain batch small enough to cross in a test: the editor's real one,
// MAX_TERRAIN_BATCH, is over a million tiles.
const BATCH = 1000;
const OCEAN_BIT = 0x20;

function editorStart(): GameStartInfo {
  return {
    ...scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    }),
    players: [],
  };
}

/** A blank map: all ocean, as the generator makes one. */
function blankFiles(w: number, h: number): MapFiles {
  const blank = (w: number, h: number) => new Uint8Array(w * h).fill(OCEAN_BIT);
  const meta = (w: number, h: number) => ({
    width: w,
    height: h,
    num_land_tiles: 0,
  });
  return {
    map: CustomGameMap,
    mapSize: GameMapSize.Normal,
    manifest: {
      name: "Scenario",
      translation_key: "map.scenario",
      nations: [],
      map: meta(w, h),
      map4x: meta(w / 2, h / 2),
      map16x: meta(w / 4, h / 4),
    } as unknown as MapFiles["manifest"],
    mapBin: blank(w, h),
    map4xBin: blank(w / 2, h / 2),
  };
}

function throwOnError(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) throw new Error(gu.errMsg);
}

interface Engine {
  runner: GameRunner;
  send: (command: EditorCommand) => void;
  sent: EditorCommand[];
}

async function engine(doc: ScenarioDocument): Promise<Engine> {
  const runner = await createGameRunner(
    editorStart(),
    undefined,
    blankFiles(doc.width, doc.height),
    throwOnError,
    true,
  );
  const sent: EditorCommand[] = [];
  return {
    runner,
    sent,
    send: (command) => {
      sent.push(command);
      runner.applyEditorCommand(command);
    },
  };
}

/** A fresh engine with the document replayed into it. */
async function replayed(doc: ScenarioDocument): Promise<Engine> {
  const e = await engine(doc);
  replayDocument(doc, e.send);
  return e;
}

/**
 * What the engine holds, by id rather than small id: the whole terrain
 * bytes (derived bits included) and minimap, owners, the nations that are
 * there, their structures, warships and alliances.
 */
function engineState(runner: GameRunner) {
  const game = runner.game;
  const map = game.map();
  const mini = game.miniMap();
  const terrain = new Uint8Array(map.width() * map.height());
  const owners: (string | null)[] = [];
  game.forEachTile((t) => {
    terrain[t] = map.terrainByte(t);
    const owner = game.owner(t);
    owners.push(owner.isPlayer() ? owner.id() : null);
  });
  const miniTerrain = new Uint8Array(mini.width() * mini.height());
  for (let t = 0; t < miniTerrain.length; t++) {
    miniTerrain[t] = mini.terrainByte(t);
  }
  return {
    terrain,
    miniTerrain,
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
      .map((a) => [a.requestor().id(), a.recipient().id()])
      // In the document's order, by code unit (ids are alphanumeric).
      .sort((x, y) => (x.join() < y.join() ? -1 : 1)),
  };
}

/** The document's own view of the same, to check an engine against it. */
function expectEngineHolds(runner: GameRunner, doc: ScenarioDocument): void {
  const state = engineState(runner);
  // The authored bits of each terrain byte (see SetTerrainCommandSchema).
  const authored = state.terrain.map((b) => ((b & 0x80) === 0 ? 0 : b & 0x9f));
  expect(authored).toEqual(doc.terrain);
  expect(state.owners).toEqual(
    Array.from(doc.owners, (o) => (o === 0 ? null : doc.nations[o - 1].id)),
  );
  expect(state.nations).toEqual(
    [...doc.nations].sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(state.structures).toEqual(doc.structures);
  expect(state.warships).toEqual(doc.warships);
  expect(state.alliances).toEqual(doc.alliances);
}

const tile = (x: number, y: number) => y * W + x;

function rect(x: number, y: number, w: number, h: number): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) tiles.push(tile(x + dx, y + dy));
  }
  return tiles;
}

function nation(id: string, fields: Partial<ScenarioNation> = {}) {
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
 * A continent with a mountain range, West and East on it with structures,
 * and a nation with no land; each has a warship. West's coast is x = 20,
 * East's x = 179.
 */
const BUILD: Edit[][] = [
  [
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
  ],
  [
    {
      type: "add_nation",
      nation: nation("WESTNAT1", { troops: 20_000, gold: 500, playable: true }),
    },
  ],
  [{ type: "add_nation", nation: nation("EASTNAT1", { flag: "fr" }) }],
  [{ type: "add_nation", nation: nation("NOLAND01") }],
  [{ type: "set_owner", tiles: rect(20, 60, 25, 25), owner: "WESTNAT1" }],
  [{ type: "set_owner", tiles: rect(155, 80, 25, 25), owner: "EASTNAT1" }],
  ...(
    [
      [UnitType.Port, 20, 70, "WESTNAT1", 1],
      [UnitType.City, 30, 65, "WESTNAT1", 2],
      [UnitType.DefensePost, 40, 62, "WESTNAT1", 1],
      [UnitType.Factory, 32, 75, "WESTNAT1", 1],
      [UnitType.Port, 179, 90, "EASTNAT1", 1],
      [UnitType.SAMLauncher, 170, 95, "EASTNAT1", 3],
    ] as const
  ).map(([type, x, y, n, level]): Edit[] => [
    {
      type: "place_structure",
      structure: { type, tile: tile(x, y), nation: n, level },
    },
  ]),
  ...(
    [
      [10, 70, "WESTNAT1"],
      [190, 90, "EASTNAT1"],
      [100, 5, "NOLAND01"],
    ] as const
  ).map(([x, y, n]): Edit[] => [
    { type: "place_warship", warship: { nation: n, tile: tile(x, y) } },
  ]),
  [{ type: "set_nation", id: "EASTNAT1", name: "Orient", gold: 123 }],
  [{ type: "add_alliance", nations: ["WESTNAT1", "EASTNAT1"] }],
  [{ type: "add_alliance", nations: ["NOLAND01", "EASTNAT1"] }],
];

/** Edits on top of BUILD that touch everything undo has to put back. */
const CHANGES: Edit[][] = [
  // A stroke of water across West's land: its port, city and part of its
  // land go under.
  [20, 26, 32].map((x): Edit => ({
    type: "set_terrain",
    tiles: rect(x, 60, 8, 12),
    terrain: rect(x, 60, 8, 12).map(() => WATER),
  })),
  // Land beside East's port takes away its shore, and so the port.
  [
    {
      type: "set_terrain",
      tiles: [tile(180, 90)],
      terrain: [land(3)],
    },
  ],
  // A new mountain under East's SAM.
  [
    {
      type: "set_terrain",
      tiles: [tile(170, 95)],
      terrain: [IMPASSABLE],
    },
  ],
  // Land under East's warship.
  [
    {
      type: "set_terrain",
      tiles: [tile(190, 90)],
      terrain: [land(3)],
    },
  ],
  // A nation first in the list, which moves everyone's owner index.
  [
    { type: "add_nation", index: 0, nation: nation("FIRST001", { gold: 7 }) },
    { type: "set_owner", tiles: rect(100, 40, 20, 20), owner: "FIRST001" },
  ],
  // East loses land to the new nation and to nobody.
  [{ type: "set_owner", tiles: rect(150, 80, 10, 30), owner: "FIRST001" }],
  [{ type: "set_owner", tiles: rect(170, 100, 10, 5), owner: null }],
  [{ type: "remove_nation", id: "WESTNAT1" }],
  [{ type: "set_nation", id: "EASTNAT1", troops: 5, playable: true }],
  // Elevation only: nothing on it changes.
  [
    {
      type: "set_terrain",
      tiles: rect(160, 80, 5, 5),
      terrain: rect(160, 80, 5, 5).map(() => land(30)),
    },
  ],
];

function applySteps(editor: DocumentEditor, steps: Edit[][]): void {
  for (const step of steps) {
    for (const edit of step) editor.apply(edit);
    editor.commit();
  }
}

function copy(doc: ScenarioDocument): ScenarioDocument {
  return ScenarioDocumentSchema.parse(serializeScenarioDocument(doc));
}

/** BUILD, applied to a document alone. */
function built(): ScenarioDocument {
  const doc = newScenarioDocument("Test", W, H);
  applySteps(new DocumentEditor(doc, () => {}), BUILD);
  return doc;
}

test("a replayed document is what the engine holds", async () => {
  const doc = built();
  expect(doc.structures).toHaveLength(6);
  expect(doc.warships).toHaveLength(3);
  const { runner } = await replayed(doc);
  expectEngineHolds(runner, doc);
  expect(runner.game.ticks()).toBe(0);
});

test("editing live gives the engine and map files a replay gives", async () => {
  const doc = newScenarioDocument("Test", W, H);
  const live = await engine(doc);
  const editor = new DocumentEditor(doc, live.send);
  applySteps(editor, BUILD);
  applySteps(editor, CHANGES);
  editor.undo();
  editor.undo();
  editor.redo();
  expectEngineHolds(live.runner, doc);

  // The edits did what the engine does: East's port lost its shore, its
  // SAM its land, and West took its structures with it. East's warship's
  // water became land, and West took its warship.
  expect(doc.structures).toEqual([]);
  expect(doc.warships).toEqual([{ nation: "NOLAND01", tile: tile(100, 5) }]);

  const fresh = await replayed(doc);
  expect(engineState(live.runner)).toEqual(engineState(fresh.runner));
  const exported = (e: Engine) =>
    e.runner.applyEditorCommand({ type: "export_terrain" })!;
  const a = exported(live);
  const b = exported(fresh);
  expect(a.mapBin).toEqual(b.mapBin);
  expect(a.map4xBin).toEqual(b.map4xBin);
  expect(a.map16xBin).toEqual(b.map16xBin);
  expect(a.manifest).toEqual(b.manifest);
}, 30_000);

test("undo takes every edit back, and redo does it again", async () => {
  const doc = built();
  const original = copy(doc);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  applySteps(editor, CHANGES);
  const edited = copy(doc);
  const editedEngine = engineState(live.runner);

  while (editor.canUndo()) editor.undo();
  expect(doc).toEqual(original);
  expect(engineState(live.runner)).toEqual(
    engineState((await replayed(original)).runner),
  );

  while (editor.canRedo()) editor.redo();
  expect(doc).toEqual(edited);
  expect(engineState(live.runner)).toEqual(editedEngine);
}, 30_000);

test("undoing remove_nation brings back its land, troops, gold, structures, warships and alliances", async () => {
  const doc = built();
  const original = copy(doc);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  editor.apply({ type: "remove_nation", id: "WESTNAT1" });
  editor.commit();
  expect(doc.nations.map((n) => n.id)).toEqual(["EASTNAT1", "NOLAND01"]);
  expect(doc.structures.every((s) => s.nation === "EASTNAT1")).toBe(true);
  expect(doc.warships.map((w) => w.nation)).toEqual(["NOLAND01", "EASTNAT1"]);
  expect(doc.alliances).toEqual([["EASTNAT1", "NOLAND01"]]);
  // East was nations[1], owner 2; now it's owner 1.
  expect(doc.owners[tile(160, 90)]).toBe(1);
  expect(live.runner.game.hasPlayer("WESTNAT1")).toBe(false);
  expectEngineHolds(live.runner, doc);

  editor.undo();
  expect(doc).toEqual(original);
  expectEngineHolds(live.runner, doc);
  const west = live.runner.game.player("WESTNAT1");
  expect(west.numTilesOwned()).toBe(625);
  expect(west.troops()).toBe(20_000);
  expect(west.gold()).toBe(500n);
  expect(west.playable()).toBe(true);
  expect(west.units(UnitType.Warship).map((u) => u.tile())).toEqual([
    tile(10, 70),
  ]);

  // And redo takes it away again.
  editor.redo();
  expect(live.runner.game.hasPlayer("WESTNAT1")).toBe(false);
  editor.undo();
  expectEngineHolds(live.runner, doc);
});

test("land given to another nation loses the old owner's structure, and undo gives both back", async () => {
  const doc = built();
  const original = copy(doc);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  // East's SAM stands at (170, 95); West takes the tiles around it.
  editor.apply({
    type: "set_owner",
    tiles: rect(168, 93, 5, 5),
    owner: "WESTNAT1",
  });
  editor.commit();
  expect(doc.structures.map((s) => s.type)).not.toContain(UnitType.SAMLauncher);
  expect(doc.structures).toHaveLength(5);
  expectEngineHolds(live.runner, doc);

  editor.undo();
  expect(doc).toEqual(original);
  expectEngineHolds(live.runner, doc);
});

test("an alliance made or ended is one undo step, in the document and the engine", async () => {
  const doc = built();
  expect(doc.alliances).toEqual([
    ["EASTNAT1", "NOLAND01"],
    ["EASTNAT1", "WESTNAT1"],
  ]);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  const game = live.runner.game;
  const west = game.player("WESTNAT1");
  const east = game.player("EASTNAT1");
  // The lesser id is the requestor, whatever order the edit gave.
  expect(east.allianceWith(west)!.requestor()).toBe(east);

  applySteps(editor, [
    [{ type: "remove_alliance", nations: ["WESTNAT1", "EASTNAT1"] }],
    [{ type: "add_alliance", nations: ["WESTNAT1", "NOLAND01"] }],
  ]);
  expect(doc.alliances).toEqual([
    ["EASTNAT1", "NOLAND01"],
    ["NOLAND01", "WESTNAT1"],
  ]);
  expect(west.isAlliedWith(east)).toBe(false);
  expectEngineHolds(live.runner, doc);

  editor.undo();
  expect(doc.alliances).toEqual([["EASTNAT1", "NOLAND01"]]);
  expectEngineHolds(live.runner, doc);
  editor.undo();
  expect(doc.alliances).toEqual([
    ["EASTNAT1", "NOLAND01"],
    ["EASTNAT1", "WESTNAT1"],
  ]);
  expectEngineHolds(live.runner, doc);
  editor.redo();
  expectEngineHolds(live.runner, doc);
});

test("a stroke is one undo, with one full terrain pass", async () => {
  const doc = built();
  const original = copy(doc);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  live.sent.length = 0;
  applySteps(editor, [CHANGES[0]]);
  const types = live.sent.map((c) => c.type);
  expect(types.filter((t) => t === "set_terrain")).toHaveLength(3);
  expect(types[types.length - 1]).toBe("end_terrain_edit");
  expect(types.filter((t) => t === "end_terrain_edit")).toHaveLength(1);

  live.sent.length = 0;
  editor.undo();
  expect(doc).toEqual(original);
  expect(live.sent.filter((c) => c.type === "end_terrain_edit")).toHaveLength(
    1,
  );
  expect(editor.canUndo()).toBe(false);
  expectEngineHolds(live.runner, doc);
});

test("a new edit ends redo", () => {
  const doc = built();
  const editor = new DocumentEditor(doc, () => {});
  applySteps(editor, [[{ type: "set_nation", id: "EASTNAT1", troops: 1 }]]);
  editor.undo();
  expect(editor.canRedo()).toBe(true);
  editor.apply({ type: "set_nation", id: "EASTNAT1", troops: 2 });
  expect(editor.canRedo()).toBe(false);
});

test("an edit that can't apply changes nothing", () => {
  const doc = built();
  const original = copy(doc);
  const sent: EditorCommand[] = [];
  const editor = new DocumentEditor(doc, (c) => sent.push(c));
  const bad: Edit[] = [
    { type: "set_owner", tiles: [tile(0, 0)], owner: "EASTNAT1" },
    { type: "set_owner", tiles: [W * H], owner: null },
    { type: "add_nation", nation: nation("EASTNAT1") },
    { type: "remove_nation", id: "NOBODY01" },
    { type: "set_nation", id: "EASTNAT1", name: "" },
    { type: "set_terrain", tiles: [0], terrain: [0x40] },
    { type: "set_terrain", tiles: [0], terrain: [128.5] },
    {
      type: "place_structure",
      structure: {
        type: UnitType.City,
        tile: tile(100, 100),
        nation: "EASTNAT1",
        level: 1,
      },
    },
    { type: "remove_structure", tile: tile(100, 100) },
    // On land, for nobody, and on a tile with one.
    {
      type: "place_warship",
      warship: { nation: "EASTNAT1", tile: tile(100, 100) },
    },
    {
      type: "place_warship",
      warship: { nation: "NOBODY01", tile: tile(0, 0) },
    },
    {
      type: "place_warship",
      warship: { nation: "EASTNAT1", tile: tile(10, 70) },
    },
    { type: "remove_warship", tile: tile(0, 0) },
    { type: "add_alliance", nations: ["EASTNAT1", "WESTNAT1"] },
    { type: "add_alliance", nations: ["EASTNAT1", "EASTNAT1"] },
    { type: "add_alliance", nations: ["EASTNAT1", "NOBODY01"] },
    { type: "remove_alliance", nations: ["WESTNAT1", "NOLAND01"] },
    { type: "set_config", config: { ...doc.config, goldMultiplier: 0 } },
    { type: "set_config", config: { ...doc.config, maxTimerValue: 121 } },
  ];
  for (const edit of bad) expect(() => editor.apply(edit)).toThrow();
  expect(doc).toEqual(original);
  expect(sent).toEqual([]);
  expect(editor.canUndo()).toBe(false);
});

test("a terrain write over the batch limit goes in several batches", () => {
  // More tiles than one set_terrain holds, with the batch made small: at
  // MAX_TERRAIN_BATCH it is over a million tiles, seconds of work.
  const doc = newScenarioDocument("Big", W, H);
  const sent: EditorCommand[] = [];
  const editor = new DocumentEditor(doc, (c) => sent.push(c), BATCH);
  const tiles = Array.from({ length: 150 * 10 }, (_, i) => {
    return Math.floor(i / 150) * W + 25 + (i % 150);
  });
  editor.apply({
    type: "set_terrain",
    tiles,
    terrain: tiles.map(() => land(2)),
  });
  editor.commit();
  const written = (commands: EditorCommand[]) =>
    commands.flatMap((c) => (c.type === "set_terrain" ? [c.tiles] : []));
  expect(written(sent).map((t) => t.length)).toEqual([
    BATCH,
    tiles.length - BATCH,
  ]);
  expect(written(sent).flat()).toEqual(tiles);
  expect(sent[sent.length - 1]).toEqual({ type: "end_terrain_edit" });

  sent.length = 0;
  editor.undo();
  expect(written(sent)).toHaveLength(2);
  expect(doc.terrain.every((b) => b === WATER)).toBe(true);
});

test("a defense post is the one structure without levels, as the document checks", async () => {
  const { runner } = await engine(newScenarioDocument("Levels", W, H));
  expect(
    Structures.types.filter((t) => !runner.game.unitInfo(t).upgradable),
  ).toEqual([UnitType.DefensePost]);
});

test("a port that loses its shore in one batch of a write goes, and undo keeps the ports the write kept", async () => {
  // Over one batch of tiles, all land but one water tile beside the port.
  const w = W;
  const doc = newScenarioDocument("Ports", w, H);
  doc.terrain.fill(land(2));
  const at = (x: number, y: number) => y * w + x;
  const port = at(10, 11);
  doc.terrain[at(10, 10)] = WATER;
  doc.nations.push(nation("PORTNAT1"));
  doc.owners[port] = 1;
  doc.structures.push({
    type: UnitType.Port,
    tile: port,
    nation: "PORTNAT1",
    level: 1,
  });
  const e = await replayed(doc);
  const editor = new DocumentEditor(doc, e.send, BATCH);
  // The first batch fills the port's water; the second digs new water
  // beside it, which comes too late for the port.
  const filler = Array.from({ length: BATCH - 1 }, (_, i) => at(0, 20) + i);
  const tiles = [at(10, 10), ...filler, at(10, 12)];
  editor.apply({
    type: "set_terrain",
    tiles,
    terrain: [land(2), ...filler.map(() => land(2)), WATER],
  });
  editor.commit();
  const structures = () => engineState(e.runner).structures;
  expect(doc.structures).toEqual([]);
  expect(structures()).toEqual([]);

  editor.undo();
  expect(doc.structures).toHaveLength(1);
  expect(structures()).toEqual(doc.structures);

  // The other way round, the port keeps a shore throughout: the first batch
  // digs water below it, the second fills the water above. So does undo,
  // which writes the second batch back first.
  editor.apply({
    type: "set_terrain",
    tiles: [at(10, 12), ...filler, at(10, 10)],
    terrain: [WATER, ...filler.map(() => land(2)), land(2)],
  });
  editor.commit();
  expect(doc.structures).toHaveLength(1);
  editor.undo();
  expect(doc.terrain[at(10, 10)]).toBe(WATER);
  expect(doc.terrain[at(10, 12)]).toBe(land(2));
  expect(doc.structures).toHaveLength(1);
  expect(structures()).toEqual(doc.structures);
});

test("a brush stroke reaches the engine in batches, and undo takes it all back", async () => {
  const doc = built();
  const original = copy(doc);
  const live = await replayed(doc);
  const editor = new DocumentEditor(doc, live.send);
  live.sent.length = 0;
  // Water dragged across West's port, the mountains and East's port and
  // SAM launcher, flushed now and then as the frames go by.
  const stroke = new TerrainStroke(editor, WATER, 4);
  stroke.moveTo(5, 70);
  stroke.moveTo(60, 70);
  stroke.flush();
  stroke.moveTo(120, 90);
  stroke.flush();
  stroke.flush();
  stroke.moveTo(190, 93);
  expect(stroke.end()).toBe(true);
  expect(doc.structures.map((s) => s.type).sort()).toEqual(
    [UnitType.City, UnitType.DefensePost, UnitType.Factory].sort(),
  );
  const types = live.sent.map((c) => c.type);
  expect(types.filter((t) => t === "set_terrain")).toHaveLength(3);
  expect(types.filter((t) => t === "end_terrain_edit")).toHaveLength(1);
  expect(types[types.length - 1]).toBe("end_terrain_edit");
  expect(doc).not.toEqual(original);
  expectEngineHolds(live.runner, doc);

  editor.undo();
  expect(doc).toEqual(original);
  expect(editor.canUndo()).toBe(false);
  expectEngineHolds(live.runner, doc);
});

describe("settings", () => {
  test("a change is one undo step, and reaches the engine only through what it removes", async () => {
    const doc = built();
    const original = copy(doc);
    const live = await replayed(doc);
    const editor = new DocumentEditor(doc, live.send);
    live.sent.length = 0;
    const config: ScenarioConfig = {
      ...doc.config,
      difficulty: Difficulty.Hard,
      instantBuild: true,
      maxTimerValue: 45,
      goldMultiplier: 2.5,
      customAllianceDuration: 10,
      doomsdayClock: { enabled: true, speed: "fast" },
      overtime: { enabled: true, startMinutes: 30 },
    };
    applySteps(editor, [[{ type: "set_config", config }]]);
    expect(doc.config).toEqual(config);
    expect(live.sent).toEqual([]);
    expect(copy(doc)).toEqual(doc);

    editor.undo();
    expect(doc).toEqual(original);
    expect(editor.canUndo()).toBe(false);
    editor.redo();
    expect(doc.config).toEqual(config);
    expectEngineHolds(live.runner, doc);
  });

  const removals: [
    string,
    (c: ScenarioConfig) => ScenarioConfig,
    (d: ScenarioDocument) => unknown[],
  ][] = [
    [
      "disabling a structure type removes its structures",
      (c) => ({
        ...c,
        disabledUnits: [UnitType.Port, UnitType.MissileSilo],
      }),
      (d) => d.structures.filter((s) => s.type === UnitType.Port),
    ],
    [
      "disabling warships removes every warship",
      (c) => ({ ...c, disabledUnits: [UnitType.Warship] }),
      (d) => d.warships,
    ],
    [
      "turning alliances off removes every alliance",
      (c) => ({ ...c, customAllianceDuration: 0 }),
      (d) => d.alliances,
    ],
  ];

  test.each(removals)(
    "%s, and undo puts the settings and them back",
    async (_, change, removed) => {
      const doc = built();
      const original = copy(doc);
      expect(removed(doc).length).toBeGreaterThan(0);
      const live = await replayed(doc);
      const editor = new DocumentEditor(doc, live.send);
      const config = change(doc.config);
      applySteps(editor, [[{ type: "set_config", config }]]);
      expect(doc.config).toEqual(config);
      expect(removed(doc)).toEqual([]);
      expectEngineHolds(live.runner, doc);
      // The document still parses: nothing in it conflicts with its settings.
      expect(copy(doc)).toEqual(doc);

      editor.undo();
      expect(doc).toEqual(original);
      expect(editor.canUndo()).toBe(false);
      expectEngineHolds(live.runner, doc);

      editor.redo();
      expect(removed(doc)).toEqual([]);
      expectEngineHolds(live.runner, doc);
      editor.undo();
      expect(doc).toEqual(original);
    },
  );

  test("one change can remove structures, warships and alliances together", async () => {
    const doc = built();
    const original = copy(doc);
    const live = await replayed(doc);
    const editor = new DocumentEditor(doc, live.send);
    applySteps(editor, [
      [
        {
          type: "set_config",
          config: {
            ...doc.config,
            disabledUnits: [...Structures.types, UnitType.Warship],
            customAllianceDuration: 0,
          },
        },
      ],
    ]);
    expect(doc.structures).toEqual([]);
    expect(doc.warships).toEqual([]);
    expect(doc.alliances).toEqual([]);
    expectEngineHolds(live.runner, doc);
    expect(copy(doc)).toEqual(doc);

    editor.undo();
    expect(doc).toEqual(original);
    expectEngineHolds(live.runner, doc);
  });
});

describe("resizing", () => {
  /** An engine built for the document the way the editor builds one. */
  async function rebuilt(doc: ScenarioDocument): Promise<GameRunner> {
    let runner: GameRunner | undefined;
    await startEditorEngine(doc, async (files) => {
      const r = await createGameRunner(
        editorStartInfo(),
        undefined,
        files,
        throwOnError,
        true,
      );
      runner = r;
      return (command) => {
        r.applyEditorCommand(command);
      };
    });
    return runner!;
  }

  function expectSameTiles(from: ScenarioDocument, to: ScenarioDocument) {
    for (let y = 0; y < to.height; y++) {
      for (let x = 0; x < to.width; x++) {
        const t = y * to.width + x;
        const inside = x < from.width && y < from.height;
        const f = y * from.width + x;
        expect(to.terrain[t]).toBe(inside ? from.terrain[f] : WATER);
        expect(to.owners[t]).toBe(inside ? from.owners[f] : 0);
      }
    }
  }

  test("cropping keeps the top-left corner and drops a port off the coast and a warship off the map", async () => {
    const doc = built();
    // At width 180 East's port, at x = 179, has no water beside it.
    const cropped = resizeScenarioDocument(doc, 180, 120);
    expectSameTiles(doc, cropped);
    const moved = (s: (typeof doc.structures)[number]) => ({
      ...s,
      tile: Math.floor(s.tile / W) * 180 + (s.tile % W),
    });
    expect(cropped.structures).toEqual(
      doc.structures.filter((s) => s.tile !== tile(179, 90)).map(moved),
    );
    // East's warship, at x = 190, is cropped.
    expect(cropped.warships).toEqual([
      { nation: "NOLAND01", tile: 5 * 180 + 100 },
      { nation: "WESTNAT1", tile: 70 * 180 + 10 },
    ]);
    expect(cropped.nations).toEqual(doc.nations);
    expect(cropped.alliances).toEqual(doc.alliances);
    // Still a valid document, and the engine built for it holds it.
    expect(copy(cropped)).toEqual(cropped);
    expectEngineHolds(await rebuilt(cropped), cropped);
  });

  test("growing adds water and keeps everything", async () => {
    const doc = built();
    const grown = resizeScenarioDocument(doc, 240, 200);
    expectSameTiles(doc, grown);
    expect(grown.structures).toHaveLength(doc.structures.length);
    expect(grown.warships).toHaveLength(doc.warships.length);
    expectEngineHolds(await rebuilt(grown), grown);
  });

  test("only to a size a scenario can have", () => {
    const doc = built();
    expect(() => resizeScenarioDocument(doc, 202, 160)).toThrow();
    expect(() => resizeScenarioDocument(doc, 200, 96)).toThrow();
    expect(() => resizeScenarioDocument(doc, 5004, 200)).toThrow();
  });
});
