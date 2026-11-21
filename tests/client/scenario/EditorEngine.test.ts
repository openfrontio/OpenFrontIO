// @vitest-environment node
/**
 * What the scenario editor starts its engine on (docs/ScenarioEditor.md,
 * "Editor runtime"): a blank map with the document replayed into it, or a
 * stock map's files for a scenario started from that map.
 */

import {
  authoredTerrain,
  type EditorCommand,
} from "@openfront/engine-api/EditorCommands";
import {
  CustomGameMap,
  GameMapSize,
  GameMapType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles, MapManifest } from "@openfront/engine-api/game/MapFiles";
import { MapManifestSchema } from "@openfront/engine-api/game/MapManifest";
import { createGameRunner, GameRunner } from "@openfront/engine/GameRunner";
import fs from "fs";
import path from "path";
import {
  blankMapFiles,
  editorStartInfo,
  startEditorEngine,
  stockMapStart,
} from "../../../src/client/scenario/EditorEngine";
import {
  land,
  newScenarioDocument,
  type ScenarioDocument,
  ScenarioDocumentSchema,
  serializeScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";

/** The Tutorial map's normal-size files, as the client loads them. */
function tutorialFiles(): MapFiles {
  const dir = path.join(__dirname, "../../../resources/maps/tutorial");
  const read = (file: string) =>
    new Uint8Array(fs.readFileSync(path.join(dir, file)));
  return {
    map: GameMapType.Tutorial,
    mapSize: GameMapSize.Normal,
    manifest: JSON.parse(
      fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
    ) as MapManifest,
    mapBin: read("map.bin"),
    map4xBin: read("map4x.bin"),
  };
}

function throwOnError(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) throw new Error(gu.errMsg);
}

interface Started {
  runner: GameRunner;
  /** The files the engine was started on. */
  files: MapFiles;
  sent: EditorCommand[];
}

/** Builds the editor engine for the document, as the editor does. */
async function start(
  doc: ScenarioDocument,
  stockFiles?: MapFiles,
): Promise<Started> {
  const sent: EditorCommand[] = [];
  let started: Omit<Started, "sent"> | undefined;
  await startEditorEngine(
    doc,
    async (files) => {
      const runner = await createGameRunner(
        editorStartInfo(),
        undefined,
        { ...files, mapBin: files.mapBin!.slice() },
        throwOnError,
        true,
      );
      started = { runner, files };
      return (command) => {
        sent.push(command);
        runner.applyEditorCommand(command);
      };
    },
    stockFiles,
  );
  return { ...started!, sent };
}

function terrainOf(runner: GameRunner): Uint8Array {
  const map = runner.game.map();
  const terrain = new Uint8Array(map.width() * map.height());
  runner.game.forEachTile((t) => (terrain[t] = map.terrainByte(t)));
  return terrain;
}

test("a document starts on a blank map of its size, with its terrain replayed", async () => {
  const doc = newScenarioDocument("Test", 200, 120);
  for (let t = 0; t < 200 * 40; t++) doc.terrain[t] = land(t % 31);
  const { runner, files, sent } = await start(doc);

  expect(files.map).toBe(CustomGameMap);
  expect(MapManifestSchema.parse(files.manifest).map).toEqual({
    width: 200,
    height: 120,
    num_land_tiles: 0,
  });
  expect(sent.map((c) => c.type)).toEqual(["set_terrain", "end_terrain_edit"]);
  expect(terrainOf(runner).map(authoredTerrain)).toEqual(doc.terrain);
});

test("a blank map is all ocean, at full and quarter size", () => {
  const files = blankMapFiles(200, 120);
  expect(files.mapBin).toEqual(new Uint8Array(200 * 120).fill(0x20));
  expect(files.map4xBin).toEqual(new Uint8Array(100 * 60).fill(0x20));
});

describe("starting from a stock map", () => {
  test("copies its authored terrain into the document, and not its nations", () => {
    const shipped = tutorialFiles();
    expect(shipped.manifest.nations.length).toBeGreaterThan(0);
    const { doc, files } = stockMapStart("Tutorial copy", tutorialFiles());

    expect(doc.meta.name).toBe("Tutorial copy");
    expect([doc.width, doc.height]).toEqual([224, 168]);
    expect(doc.terrain).toEqual(shipped.mapBin!.map(authoredTerrain));
    expect(doc.nations).toEqual([]);
    // A valid document.
    expect(
      ScenarioDocumentSchema.parse(serializeScenarioDocument(doc)),
    ).toEqual(doc);

    expect(files.map).toBe(CustomGameMap);
    const manifest = MapManifestSchema.parse(files.manifest);
    expect(manifest.nations).toEqual([]);
    expect(manifest.map).toEqual(shipped.manifest.map);
    expect(manifest.map4x).toEqual(shipped.manifest.map4x);
    expect(files.mapBin).toEqual(shipped.mapBin);
    expect(files.map4xBin).toEqual(shipped.map4xBin);
  });

  test("the engine starts on its files, and the saved draft reopens to the same terrain", async () => {
    const shipped = tutorialFiles();
    const { doc, files } = stockMapStart("Tutorial copy", tutorialFiles());
    const onStock = await start(doc, files);
    // Nothing to replay: the files hold the terrain, as shipped.
    expect(onStock.sent).toEqual([]);
    expect(terrainOf(onStock.runner)).toEqual(shipped.mapBin);

    // Reopened, the draft is replayed onto a blank map.
    const reopened = await start(
      ScenarioDocumentSchema.parse(serializeScenarioDocument(doc)),
    );
    expect(terrainOf(reopened.runner).map(authoredTerrain)).toEqual(
      doc.terrain,
    );
  });

  test("refuses a map too large for a scenario", () => {
    const files = tutorialFiles();
    files.manifest.map = { width: 5004, height: 1600, num_land_tiles: 0 };
    expect(() => stockMapStart("Too large", files)).toThrow(/can't be/);
  });
});
