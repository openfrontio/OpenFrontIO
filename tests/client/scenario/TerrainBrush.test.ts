/**
 * The terrain brush (docs/ScenarioEditor.md, "Terrain"): the tiles a disc
 * and a drag cover, and a stroke's edits through the DocumentEditor.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import { DocumentEditor } from "../../../src/client/scenario/DocumentEditor";
import {
  IMPASSABLE,
  land,
  newScenarioDocument,
  WATER,
} from "../../../src/client/scenario/ScenarioDocument";
import {
  discTiles,
  lineTiles,
  TerrainStroke,
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
