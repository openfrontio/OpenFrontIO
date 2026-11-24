/**
 * The units tool: a click on or near a structure or warship removes the
 * nearest, and a click elsewhere places one of the picked type, a structure
 * for the nation that owns the tile or a warship for the picked nation, or
 * says why not.
 */

import { UnitType } from "@openfront/engine-api/game/GameTypes";
import {
  DocumentEditor,
  type Edit,
} from "../../../src/client/scenario/DocumentEditor";
import {
  land,
  MAX_WARSHIPS,
  newScenarioDocument,
  type ScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  unitClick,
  type UnitPick,
} from "../../../src/client/scenario/UnitTool";

const W = 100;
const H = 100;
const tile = (x: number, y: number) => y * W + x;

/**
 * Land in columns 10-89, water either side; West owns columns 10-29,
 * columns 30+ are free.
 */
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

/** The edit a click makes for West, which must be one. */
function edit(
  doc: ScenarioDocument,
  t: number,
  type: UnitPick,
  reach: number,
): Edit {
  const result = unitClick(doc, t, type, 1, "WESTNAT1", reach);
  if (typeof result === "string") throw new Error(result);
  return result;
}

test("a click on a nation's land places a structure for it", () => {
  const { doc } = setup();
  expect(unitClick(doc, tile(20, 50), UnitType.City, 3, null, 2)).toEqual({
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
  const edit = unitClick(doc, tile(20, 50), UnitType.DefensePost, 4, null, 2);
  expect(edit).toMatchObject({ structure: { level: 1 } });
});

test("a structure on land nobody owns, or on water, is not placed", () => {
  const { doc } = setup();
  expect(unitClick(doc, tile(50, 50), UnitType.City, 1, null, 2)).toBe(
    "unowned",
  );
  expect(unitClick(doc, tile(5, 50), UnitType.City, 1, null, 2)).toBe(
    "unowned",
  );
});

test("a port goes only on a shore", () => {
  const { doc } = setup();
  expect(unitClick(doc, tile(20, 50), UnitType.Port, 1, null, 2)).toBe(
    "no_shore",
  );
  expect(unitClick(doc, tile(10, 50), UnitType.Port, 1, null, 2)).toMatchObject(
    { type: "place_structure" },
  );
});

test("a click on water places a warship for the picked nation", () => {
  const { doc } = setup();
  expect(
    unitClick(doc, tile(5, 50), UnitType.Warship, 1, "WESTNAT1", 2),
  ).toEqual({
    type: "place_warship",
    warship: { nation: "WESTNAT1", tile: tile(5, 50) },
  });
});

test("a warship on land, or with no nation picked, is not placed", () => {
  const { doc } = setup();
  expect(unitClick(doc, tile(50, 50), UnitType.Warship, 1, "WESTNAT1", 2)).toBe(
    "land",
  );
  expect(unitClick(doc, tile(5, 50), UnitType.Warship, 1, null, 2)).toBe(
    "no_nation",
  );
});

test("a click on or near a unit removes the nearest, whatever type is picked, and undo puts it back", () => {
  const { doc, editor } = setup();
  editor.apply(edit(doc, tile(10, 20), UnitType.City, 0));
  editor.apply(edit(doc, tile(13, 20), UnitType.City, 0));
  editor.apply(edit(doc, tile(8, 20), UnitType.Warship, 0));
  editor.commit();
  // Within reach of all three: the nearer goes.
  expect(unitClick(doc, tile(12, 21), UnitType.Warship, 1, null, 3)).toEqual({
    type: "remove_structure",
    tile: tile(13, 20),
  });
  expect(unitClick(doc, tile(8, 21), UnitType.Factory, 1, null, 3)).toEqual({
    type: "remove_warship",
    tile: tile(8, 20),
  });
  // Out of reach: a new one.
  expect(
    unitClick(doc, tile(20, 25), UnitType.Factory, 1, null, 3),
  ).toMatchObject({ type: "place_structure" });

  const structures = structuredClone(doc.structures);
  const warships = structuredClone(doc.warships);
  editor.apply(edit(doc, tile(11, 21), UnitType.Factory, 3));
  editor.commit();
  editor.apply(edit(doc, tile(7, 20), UnitType.City, 3));
  editor.commit();
  expect(doc.structures.map((s) => s.tile)).toEqual([tile(13, 20)]);
  expect(doc.warships).toEqual([]);
  editor.undo();
  editor.undo();
  expect(doc.structures).toEqual(structures);
  expect(doc.warships).toEqual(warships);
});

test("a type the settings disable is not placed, but one already there can be removed", () => {
  const { doc, editor } = setup();
  editor.apply(edit(doc, tile(10, 50), UnitType.Port, 0));
  editor.apply(edit(doc, tile(5, 50), UnitType.Warship, 0));
  editor.commit();
  doc.config.disabledUnits = [UnitType.Port, UnitType.Warship];
  expect(unitClick(doc, tile(10, 20), UnitType.Port, 1, null, 2)).toBe(
    "disabled",
  );
  expect(unitClick(doc, tile(5, 20), UnitType.Warship, 1, "WESTNAT1", 2)).toBe(
    "disabled",
  );
  expect(unitClick(doc, tile(10, 50), UnitType.Port, 1, null, 2)).toEqual({
    type: "remove_structure",
    tile: tile(10, 50),
  });
  expect(
    unitClick(doc, tile(5, 50), UnitType.Warship, 1, "WESTNAT1", 2),
  ).toEqual({ type: "remove_warship", tile: tile(5, 50) });
});

test("no more than MAX_WARSHIPS are placed", () => {
  const { doc } = setup();
  // Water tiles in columns 0-9, far enough from the click to miss.
  doc.warships = Array.from({ length: MAX_WARSHIPS }, (_, i) => ({
    nation: "WESTNAT1",
    tile: tile(i % 10, Math.floor(i / 10)),
  }));
  expect(unitClick(doc, tile(95, 50), UnitType.Warship, 1, "WESTNAT1", 0)).toBe(
    "too_many",
  );
});
