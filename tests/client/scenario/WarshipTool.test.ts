/**
 * The warship tool: a click on a warship removes it, and a click elsewhere
 * places one for the picked nation, or says why not.
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
import { warshipClick } from "../../../src/client/scenario/WarshipTool";

const W = 100;
const H = 100;
const tile = (x: number, y: number) => y * W + x;

/** Land in columns 10-89, water either side, and one nation. */
function setup(): { doc: ScenarioDocument; editor: DocumentEditor } {
  const doc = newScenarioDocument("Test", W, H);
  const editor = new DocumentEditor(doc, () => {});
  const tiles: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 10; x < 90; x++) tiles.push(tile(x, y));
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
  editor.commit();
  return { doc, editor };
}

/** The edit a click makes, which must be one. */
function edit(doc: ScenarioDocument, t: number, reach: number): Edit {
  const result = warshipClick(doc, t, "WESTNAT1", reach);
  if (typeof result === "string") throw new Error(result);
  return result;
}

test("a click on water places a warship for the picked nation", () => {
  const { doc } = setup();
  expect(warshipClick(doc, tile(5, 50), "WESTNAT1", 2)).toEqual({
    type: "place_warship",
    warship: { nation: "WESTNAT1", tile: tile(5, 50) },
  });
});

test("a click on land, or with no nation picked, places nothing", () => {
  const { doc } = setup();
  expect(warshipClick(doc, tile(50, 50), "WESTNAT1", 2)).toBe("land");
  expect(warshipClick(doc, tile(5, 50), null, 2)).toBe("no_nation");
});

test("a click on or near a warship removes the nearest, and undo puts it back", () => {
  const { doc, editor } = setup();
  for (const [x, y] of [
    [2, 20],
    [5, 20],
  ]) {
    editor.apply(edit(doc, tile(x, y), 0));
    editor.commit();
  }
  // Within reach of both: the nearer goes, whoever is picked.
  expect(warshipClick(doc, tile(4, 21), null, 3)).toEqual({
    type: "remove_warship",
    tile: tile(5, 20),
  });
  // Out of reach: a new one.
  expect(warshipClick(doc, tile(2, 25), "WESTNAT1", 3)).toMatchObject({
    type: "place_warship",
  });

  const before = structuredClone(doc.warships);
  editor.apply(edit(doc, tile(2, 21), 3));
  editor.commit();
  expect(doc.warships.map((w) => w.tile)).toEqual([tile(5, 20)]);
  editor.undo();
  expect(doc.warships).toEqual(before);
});

test("disabled warships are not placed, but one already there can be removed", () => {
  const { doc, editor } = setup();
  editor.apply(edit(doc, tile(5, 50), 0));
  editor.commit();
  doc.config.disabledUnits = [UnitType.Warship];
  expect(warshipClick(doc, tile(5, 20), "WESTNAT1", 2)).toBe("disabled");
  expect(warshipClick(doc, tile(5, 50), "WESTNAT1", 2)).toEqual({
    type: "remove_warship",
    tile: tile(5, 50),
  });
});

test("no more than MAX_WARSHIPS are placed", () => {
  const { doc } = setup();
  // Water tiles in columns 0-9 and 90-99, far enough apart to miss.
  doc.warships = Array.from({ length: MAX_WARSHIPS }, (_, i) => ({
    nation: "WESTNAT1",
    tile: tile(i % 10, Math.floor(i / 10)),
  }));
  expect(warshipClick(doc, tile(95, 50), "WESTNAT1", 0)).toBe("too_many");
});
