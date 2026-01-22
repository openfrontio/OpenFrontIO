import { GameMap, TileRef } from "./GameMap";
import { Railroad } from "./Railroad";

export class RailSpatialGrid {
  private cells = new Map<string, Set<Railroad>>();
  // Quick access to avoid iterating over the cells
  private railToCells = new Map<Railroad, Set<string>>();

  constructor(
    private game: GameMap,
    private cellSize: number,
  ) {
    if (cellSize <= 0) {
      throw new Error("cellSize must be > 0");
    }
  }

  register(rail: Railroad) {
    // Defensive: avoid double-registration but it should never happen
    this.unregister(rail);

    const visited = new Set<string>();
    const railCells = new Set<string>();

    for (const tile of rail.tiles) {
      const { cx, cy } = this.cellOf(this.game.x(tile), this.game.y(tile));
      const k = this.key(cx, cy);
      if (visited.has(k)) continue;
      visited.add(k);

      let set = this.cells.get(k);
      if (!set) {
        set = new Set();
        this.cells.set(k, set);
      }
      railCells.add(k);
      set.add(rail);
    }

    if (railCells.size > 0) {
      this.railToCells.set(rail, railCells);
    }
  }

  unregister(rail: Railroad) {
    const keys = this.railToCells.get(rail);
    if (!keys) return;

    for (const k of keys) {
      const set = this.cells.get(k);
      if (!set) continue;
      set.delete(rail);

      if (set.size === 0) {
        this.cells.delete(k);
      }
    }

    this.railToCells.delete(rail);
  }

  query(tile: TileRef, radius: number): Set<Railroad> {
    const x = this.game.x(tile);
    const y = this.game.y(tile);

    const minX = x - radius;
    const minY = y - radius;
    const maxX = x + radius;
    const maxY = y + radius;

    const c0 = this.cellOf(minX, minY);
    const c1 = this.cellOf(maxX, maxY);

    const result = new Set<Railroad>();

    for (let cx = c0.cx; cx <= c1.cx; cx++) {
      for (let cy = c0.cy; cy <= c1.cy; cy++) {
        const set = this.cells.get(this.key(cx, cy));
        if (!set) continue;
        for (const rail of set) {
          result.add(rail);
        }
      }
    }

    return result;
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  private cellOf(x: number, y: number): { cx: number; cy: number } {
    return {
      cx: Math.floor(x / this.cellSize),
      cy: Math.floor(y / this.cellSize),
    };
  }
}
