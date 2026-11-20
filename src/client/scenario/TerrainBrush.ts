/**
 * The terrain and territory brushes (docs/ScenarioEditor.md, "Terrain"):
 * which tiles a round brush covers, and a stroke that paints them through
 * the DocumentEditor in batches.
 */

import type { DocumentEditor, Edit } from "./DocumentEditor";
import { isOwnable } from "./ScenarioDocument";

/**
 * The tiles within `radius` of tile (cx, cy), clipped to a `width` x
 * `height` map: those whose centre lies in a circle of radius + 0.5 tiles
 * about the centre tile's, so radius 0 is one tile and the brush preview,
 * a circle 2 * radius + 1 tiles across, outlines them.
 */
export function discTiles(
  cx: number,
  cy: number,
  radius: number,
  width: number,
  height: number,
): number[] {
  const tiles: number[] = [];
  addDisc(tiles, null, cx, cy, radius, width, height);
  return tiles;
}

/**
 * The tiles the brush covers moving from tile (x0, y0) to tile (x1, y1): a
 * disc at each tile of the line between, each tile once.
 */
export function lineTiles(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  width: number,
  height: number,
): number[] {
  const tiles: number[] = [];
  const seen = new Set<number>();
  // Bresenham.
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    addDisc(tiles, seen, x, y, radius, width, height);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return tiles;
}

function addDisc(
  tiles: number[],
  seen: Set<number> | null,
  cx: number,
  cy: number,
  radius: number,
  width: number,
  height: number,
): void {
  const r2 = radius * radius + radius;
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(width - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(height - 1, cy + radius);
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) continue;
      const t = y * width + x;
      if (seen !== null) {
        if (seen.has(t)) continue;
        seen.add(t);
      }
      tiles.push(t);
    }
  }
}

/**
 * One stroke of a brush: moveTo() collects the tiles it passes that it would
 * change, flush() applies them as one edit, and end() makes the stroke one
 * undo step. A stroke that changes nothing sends nothing.
 */
export class BrushStroke {
  private last: { x: number; y: number } | null = null;
  private readonly pending = new Set<number>();
  private changed = false;

  constructor(
    private readonly editor: DocumentEditor,
    readonly radius: number,
    /** Whether painting the tile would change it. */
    private readonly changes: (tile: number) => boolean,
    /** The edit that paints the tiles. */
    private readonly edit: (tiles: number[]) => Edit,
  ) {}

  /** Moves the brush to tile (x, y), which may lie off the map. */
  moveTo(x: number, y: number): void {
    const { width, height } = this.editor.doc;
    const from = this.last ?? { x, y };
    const tiles = lineTiles(from.x, from.y, x, y, this.radius, width, height);
    for (const t of tiles) {
      if (this.changes(t)) this.pending.add(t);
    }
    this.last = { x, y };
  }

  /** Applies the tiles collected since the last flush. */
  flush(): void {
    if (this.pending.size === 0) return;
    const tiles = [...this.pending];
    this.pending.clear();
    this.editor.apply(this.edit(tiles));
    this.changed = true;
  }

  /** Flushes and commits; returns whether the stroke changed anything. */
  end(): boolean {
    this.flush();
    this.editor.commit();
    return this.changed;
  }
}

/** Paints a terrain byte, skipping tiles that already hold it. */
export class TerrainStroke extends BrushStroke {
  constructor(editor: DocumentEditor, terrain: number, radius: number) {
    const { doc } = editor;
    super(
      editor,
      radius,
      (t) => doc.terrain[t] !== terrain,
      (tiles) => ({
        type: "set_terrain",
        tiles,
        terrain: tiles.map(() => terrain),
      }),
    );
  }
}

/**
 * Gives land to the nation with id `owner`, or to nobody when it's null.
 * Skips water, impassable tiles and tiles the owner already has.
 */
export class TerritoryStroke extends BrushStroke {
  constructor(editor: DocumentEditor, owner: string | null, radius: number) {
    const { doc } = editor;
    super(
      editor,
      radius,
      (t) => {
        const o = doc.owners[t];
        if (owner === null) return o !== 0;
        return (
          isOwnable(doc.terrain[t]) &&
          (o === 0 || doc.nations[o - 1].id !== owner)
        );
      },
      (tiles) => ({ type: "set_owner", tiles, owner }),
    );
  }
}
