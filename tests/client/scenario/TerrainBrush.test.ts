/**
 * The terrain and territory brushes (docs/ScenarioEditor.md, "Terrain"): the
 * tiles a disc and a drag cover, and a stroke's edits through the
 * DocumentEditor.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { DocumentEditor } from "../../../src/client/scenario/DocumentEditor";
import {
  IMPASSABLE,
  land,
  newScenarioDocument,
  type ScenarioDocument,
  WATER,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  discTiles,
  lineTiles,
  TerrainStroke,
  TerritoryStroke,
} from "../../../src/client/scenario/TerrainBrush";

const W = 100;
const H = 100;
const xy = (t: number): [number, number] => [t % W, Math.floor(t / W)];
const sorted = (tiles: number[]) => [...tiles].sort((a, b) => a - b);

describe("discTiles", () => {
  test("covers the tiles whose centres are within radius + 0.5", () => {
    expect(discTiles(10, 10, 0, W, H)).toEqual([10 * W + 10]);
    expect(discTiles(10, 10, 1, W, H)).toHaveLength(9);
    expect(discTiles(10, 10, 2, W, H)).toHaveLength(21);
    for (const r of [0, 1, 2, 5, 13]) {
      const disc = new Set(discTiles(50, 40, r, W, H));
      for (let t = 0; t < W * H; t++) {
        const [x, y] = xy(t);
        expect(disc.has(t)).toBe(Math.hypot(x - 50, y - 40) <= r + 0.5);
      }
    }
  });

  test("is clipped to the map", () => {
    expect(sorted(discTiles(0, 0, 1, W, H))).toEqual([0, 1, W, W + 1]);
    expect(discTiles(W - 1, H - 1, 1, W, H)).toHaveLength(4);
    expect(discTiles(-5, -5, 2, W, H)).toEqual([]);
    expect(discTiles(W + 2, 10, 2, W, H)).toEqual([]);
  });
});

describe("lineTiles", () => {
  test("a radius-0 line is connected, with one tile per step", () => {
    const line = lineTiles(10, 10, 40, 25, 0, W, H);
    expect(line).toHaveLength(31);
    expect(line[0]).toBe(10 * W + 10);
    expect(line[line.length - 1]).toBe(25 * W + 40);
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = xy(line[i - 1]);
      const [x1, y1] = xy(line[i]);
      expect(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))).toBe(1);
    }
  });

  test("stamps the disc at each tile of the line, each tile once", () => {
    const path = lineTiles(5, 70, 60, 3, 0, W, H);
    const union = new Set(path.flatMap((t) => discTiles(...xy(t), 3, W, H)));
    const line = lineTiles(5, 70, 60, 3, 3, W, H);
    expect(new Set(line).size).toBe(line.length);
    expect(sorted(line)).toEqual(sorted([...union]));
  });

  test("a line of one point is its disc", () => {
    expect(lineTiles(20, 20, 20, 20, 4, W, H)).toEqual(
      discTiles(20, 20, 4, W, H),
    );
  });

  test("is clipped to the map", () => {
    const line = lineTiles(-10, 5, W + 10, 5, 2, W, H);
    expect(line.every((t) => t >= 0 && t < W * H)).toBe(true);
    expect(line).toHaveLength(W * 5);
  });
});

describe("TerrainStroke", () => {
  function setup() {
    const doc = newScenarioDocument("Brush", W, H);
    const sent: EditorCommand[] = [];
    const editor = new DocumentEditor(doc, (c) => sent.push(c));
    return { doc, sent, editor };
  }

  test("applies its tiles on flush, and undoes as one step", () => {
    const { doc, sent, editor } = setup();
    const stroke = new TerrainStroke(editor, land(7), 2);
    stroke.moveTo(10, 10);
    stroke.moveTo(30, 10);
    expect(sent).toEqual([]);
    stroke.flush();
    expect(sent.map((c) => c.type)).toEqual(["set_terrain"]);
    stroke.moveTo(30, 40);
    // Off the map, then back.
    stroke.moveTo(-20, 40);
    stroke.moveTo(0, 0);
    expect(stroke.end()).toBe(true);
    expect(sent.map((c) => c.type)).toEqual([
      "set_terrain",
      "set_terrain",
      "end_terrain_edit",
    ]);
    const painted = new Set(
      [
        lineTiles(10, 10, 30, 10, 2, W, H),
        lineTiles(30, 10, 30, 40, 2, W, H),
        lineTiles(30, 40, -20, 40, 2, W, H),
        lineTiles(-20, 40, 0, 0, 2, W, H),
      ].flat(),
    );
    doc.terrain.forEach((b, t) =>
      expect(b).toBe(painted.has(t) ? land(7) : WATER),
    );
    // Each tile is written once.
    const written = sent.flatMap((c) =>
      c.type === "set_terrain" ? c.tiles : [],
    );
    expect(sorted(written)).toEqual(sorted([...painted]));

    editor.undo();
    expect(doc.terrain.every((b) => b === WATER)).toBe(true);
    expect(editor.canUndo()).toBe(false);
  });

  test("skips tiles that already hold the terrain, and a stroke that changes nothing sends nothing", () => {
    const { doc, sent, editor } = setup();
    const water = new TerrainStroke(editor, WATER, 5);
    water.moveTo(50, 40);
    water.moveTo(60, 50);
    expect(water.end()).toBe(false);
    expect(sent).toEqual([]);
    expect(editor.canUndo()).toBe(false);

    const first = new TerrainStroke(editor, IMPASSABLE, 1);
    first.moveTo(50, 40);
    first.end();
    sent.length = 0;
    const second = new TerrainStroke(editor, IMPASSABLE, 2);
    second.moveTo(50, 40);
    second.end();
    const written = sent.flatMap((c) =>
      c.type === "set_terrain" ? c.tiles : [],
    );
    expect(written).toHaveLength(21 - 9);
    expect(doc.terrain[40 * W + 50]).toBe(IMPASSABLE);
  });
});

describe("TerritoryStroke", () => {
  /** Land in columns 20-79 but impassable in 45-49; nations A and B. */
  function setup() {
    const doc = newScenarioDocument("Territory", W, H);
    for (let t = 0; t < W * H; t++) {
      const [x] = xy(t);
      if (x >= 20 && x < 80) {
        doc.terrain[t] = x >= 45 && x < 50 ? IMPASSABLE : land(3);
      }
    }
    const sent: EditorCommand[] = [];
    const editor = new DocumentEditor(doc, (c) => sent.push(c));
    for (const id of ["NATIONAA", "NATIONBB"]) {
      editor.apply({
        type: "add_nation",
        nation: {
          id,
          name: id,
          flag: null,
          troops: 0,
          gold: 0,
          playable: false,
        },
      });
    }
    editor.commit();
    sent.length = 0;
    return { doc, sent, editor };
  }

  const ownerOf = (doc: ScenarioDocument, t: number) =>
    doc.owners[t] === 0 ? null : doc.nations[doc.owners[t] - 1].id;
  const ownerTiles = (sent: EditorCommand[]) =>
    sent.flatMap((c) => (c.type === "set_owner" ? c.tiles : []));

  test("paints only land a nation can own, as one undo step", () => {
    const { doc, sent, editor } = setup();
    const stroke = new TerritoryStroke(editor, "NATIONAA", 4);
    // From the water, over the impassable band, onto land again.
    stroke.moveTo(10, 30);
    stroke.flush();
    expect(sent).toEqual([]);
    stroke.moveTo(60, 30);
    stroke.flush();
    stroke.moveTo(60, 60);
    expect(stroke.end()).toBe(true);
    expect(sent.map((c) => c.type)).toEqual(["set_owner", "set_owner"]);

    const swept = new Set([
      ...lineTiles(10, 30, 60, 30, 4, W, H),
      ...lineTiles(60, 30, 60, 60, 4, W, H),
    ]);
    const owned = (t: number) => {
      const [x] = xy(t);
      return swept.has(t) && x >= 20 && x < 80 && !(x >= 45 && x < 50);
    };
    for (let t = 0; t < W * H; t++) {
      expect(ownerOf(doc, t)).toBe(owned(t) ? "NATIONAA" : null);
    }
    expect(sorted(ownerTiles(sent))).toEqual(sorted([...swept].filter(owned)));

    // One undo takes the whole stroke back and leaves the nations.
    editor.undo();
    expect(doc.owners.every((o) => o === 0)).toBe(true);
    expect(doc.nations).toHaveLength(2);
    editor.redo();
    expect(ownerOf(doc, 30 * W + 30)).toBe("NATIONAA");
  });

  test("skips tiles the nation already owns, and takes other nations' land", () => {
    const { doc, sent, editor } = setup();
    const a = new TerritoryStroke(editor, "NATIONAA", 1);
    a.moveTo(30, 30);
    a.end();
    sent.length = 0;

    const again = new TerritoryStroke(editor, "NATIONAA", 1);
    again.moveTo(30, 30);
    expect(again.end()).toBe(false);
    expect(sent).toEqual([]);

    const wider = new TerritoryStroke(editor, "NATIONAA", 2);
    wider.moveTo(30, 30);
    wider.end();
    expect(ownerTiles(sent)).toHaveLength(21 - 9);
    sent.length = 0;

    const b = new TerritoryStroke(editor, "NATIONBB", 0);
    b.moveTo(30, 30);
    b.end();
    expect(ownerTiles(sent)).toEqual([30 * W + 30]);
    expect(ownerOf(doc, 30 * W + 30)).toBe("NATIONBB");
    expect(ownerOf(doc, 30 * W + 31)).toBe("NATIONAA");
  });

  test("erases to nobody, only where there is an owner", () => {
    const { doc, sent, editor } = setup();
    const a = new TerritoryStroke(editor, "NATIONAA", 3);
    a.moveTo(30, 30);
    a.end();
    const b = new TerritoryStroke(editor, "NATIONBB", 3);
    b.moveTo(36, 30);
    b.end();
    const before = doc.owners.slice();
    sent.length = 0;

    const eraser = new TerritoryStroke(editor, null, 5);
    eraser.moveTo(33, 30);
    expect(eraser.end()).toBe(true);
    const erased = discTiles(33, 30, 5, W, H).filter((t) => before[t] !== 0);
    expect(sorted(ownerTiles(sent))).toEqual(sorted(erased));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: "set_owner", owner: null });
    for (const t of discTiles(33, 30, 5, W, H)) expect(doc.owners[t]).toBe(0);

    editor.undo();
    expect(doc.owners).toEqual(before);
  });
});
