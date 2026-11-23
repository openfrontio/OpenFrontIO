/**
 * The structure tool: a click on a structure removes it, and a click
 * elsewhere places one for the nation that owns the tile, or says why not.
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DocumentEditor,
  type Edit,
} from "../../../src/client/scenario/DocumentEditor";
import {
  land,
  newScenarioDocument,
  type ScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  structureClick,
  type StructureType,
} from "../../../src/client/scenario/StructureTool";

const W = 100;
const H = 100;
const tile = (x: number, y: number) => y * W + x;

/** Land in columns 10-89; West owns columns 10-29, columns 30+ are free. */
function setup(): { doc: ScenarioDocument; editor: DocumentEditor } {
  const doc = newScenarioDocument("Test", W, H);
  const editor = new DocumentEditor(doc, () => {});
  const tiles: number[] = [];
  const west: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 10; x < 90; x++) {
      tiles.push(tile(x, y));
      if (x < 30) west.push(tile(x, y));
    }
  }
  editor.apply({
    type: "set_terrain",
    tiles,
    terrain: tiles.map(() => land(5)),
  });
  editor.apply({
    type: "add_nation",
    nation: {
      id: "WESTNAT1",
      name: "West",
      flag: null,
      troops: 1000,
      gold: 0,
      playable: false,
    },
  });
  editor.apply({ type: "set_owner", tiles: west, owner: "WESTNAT1" });
  editor.commit();
  return { doc, editor };
}

/** The edit a click makes, which must be one. */
function edit(
  doc: ScenarioDocument,
  t: number,
  type: StructureType,
  reach: number,
): Edit {
  const result = structureClick(doc, t, type, 1, reach);
  if (typeof result === "string") throw new Error(result);
  return result;
}

test("a click on a nation's land places a structure for it", () => {
  const { doc } = setup();
  expect(structureClick(doc, tile(20, 50), UnitType.City, 3, 2)).toEqual({
    type: "place_structure",
    structure: {
      type: UnitType.City,
      tile: tile(20, 50),
      nation: "WESTNAT1",
      level: 3,
    },
  });
});

test("a defense post is placed at level 1, whatever level is picked", () => {
  const { doc } = setup();
  const edit = structureClick(doc, tile(20, 50), UnitType.DefensePost, 4, 2);
  expect(edit).toMatchObject({ structure: { level: 1 } });
});

test("a click on land nobody owns, or on water, places nothing", () => {
  const { doc } = setup();
  expect(structureClick(doc, tile(50, 50), UnitType.City, 1, 2)).toBe(
    "unowned",
  );
  expect(structureClick(doc, tile(5, 50), UnitType.City, 1, 2)).toBe("unowned");
});

test("a port goes only on a shore", () => {
  const { doc } = setup();
  expect(structureClick(doc, tile(20, 50), UnitType.Port, 1, 2)).toBe(
    "no_shore",
  );
  expect(structureClick(doc, tile(10, 50), UnitType.Port, 1, 2)).toMatchObject({
    type: "place_structure",
  });
});

test("a click on or near a structure removes the nearest, and undo puts it back", () => {
  const { doc, editor } = setup();
  for (const [x, y] of [
    [20, 20],
    [23, 20],
  ]) {
    editor.apply(edit(doc, tile(x, y), UnitType.City, 0));
    editor.commit();
  }
  expect(doc.structures.map((s) => s.tile)).toEqual([
    tile(20, 20),
    tile(23, 20),
  ]);
  // Within reach of both: the nearer goes.
  expect(structureClick(doc, tile(22, 21), UnitType.Factory, 1, 3)).toEqual({
    type: "remove_structure",
    tile: tile(23, 20),
  });
  // Out of reach: a new one.
  expect(
    structureClick(doc, tile(20, 25), UnitType.Factory, 1, 3),
  ).toMatchObject({ type: "place_structure" });

  const before = structuredClone(doc.structures);
  editor.apply(edit(doc, tile(20, 21), UnitType.Factory, 3));
  editor.commit();
  expect(doc.structures.map((s) => s.tile)).toEqual([tile(23, 20)]);
  editor.undo();
  expect(doc.structures).toEqual(before);
});

test("a type the settings disable is not placed, but one already there can be removed", () => {
  const { doc, editor } = setup();
  editor.apply(edit(doc, tile(10, 50), UnitType.Port, 0));
  editor.commit();
  doc.config.disabledUnits = [UnitType.Port];
  expect(structureClick(doc, tile(10, 20), UnitType.Port, 1, 2)).toBe(
    "disabled",
  );
  expect(structureClick(doc, tile(10, 50), UnitType.Port, 1, 2)).toEqual({
    type: "remove_structure",
    tile: tile(10, 50),
  });
});
