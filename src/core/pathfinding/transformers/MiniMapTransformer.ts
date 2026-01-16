import { Cell } from "../../game/Game";
import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

export class MiniMapTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
    private miniMap: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    // Convert inputs to minimap coords, mapping shore land to adjacent water
    const fromArray = Array.isArray(from) ? from : [from];
    const miniFromSet = new Set<number>();
    for (const f of fromArray) {
      miniFromSet.add(this.getMiniLocation(f));
    }
    const miniFrom = Array.from(miniFromSet);
    const miniTo = this.getMiniLocation(to);

    // Run Pathfinding on Minimap
    const path = this.inner.findPath(
      miniFrom.length === 1 ? miniFrom[0] : miniFrom,
      miniTo,
    );
    if (!path || path.length === 0) return null;

    // Convert back to World Cells
    const cellTo = new Cell(this.map.x(to), this.map.y(to));
    const cellPath = path.map(
      (ref) => new Cell(this.miniMap.x(ref), this.miniMap.y(ref)),
    );
    const upscaledPath = this.upscalePath(cellPath);

    // Select best Start Tile
    let cellFrom: Cell | undefined;
    if (Array.isArray(from) && upscaledPath.length > 0) {
      const anchor = upscaledPath[0];
      let minScore = Infinity;

      for (const f of from) {
        const fx = this.map.x(f);
        const fy = this.map.y(f);

        // Score = Distance to Target + (0.1 * Distance to Path Start)
        // Heavily favors target proximity, uses path start as a weak tie-breaker.
        const distTarget = Math.abs(fx - cellTo.x) + Math.abs(fy - cellTo.y);
        const distAnchor =
          Math.abs(fx - (anchor.x + 0.5)) + Math.abs(fy - (anchor.y + 0.5));
        const score = distTarget + distAnchor * 0.1;

        if (score < minScore) {
          minScore = score;
          cellFrom = new Cell(fx, fy);
        }
      }
    } else if (!Array.isArray(from)) {
      cellFrom = new Cell(this.map.x(from), this.map.y(from));
    }

    return this.fixExtremes(upscaledPath, cellTo, cellFrom).map((c) =>
      this.map.ref(c.x, c.y),
    );
  }

  // Helper: Gets minimap ref, checking adjacent water if tile is land
  private getMiniLocation(tile: TileRef): number {
    if (this.map.isWater(tile)) return this.toMini(tile);
    for (const n of this.map.neighbors(tile)) {
      if (this.map.isWater(n)) return this.toMini(n);
    }
    return this.toMini(tile);
  }

  private toMini(ref: TileRef): number {
    return this.miniMap.ref(
      Math.floor(this.map.x(ref) / 2),
      Math.floor(this.map.y(ref) / 2),
    );
  }

  private upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
    const scaledPath = path.map(
      (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
    );

    const smoothPath: Cell[] = [];
    for (let i = 0; i < scaledPath.length - 1; i++) {
      const current = scaledPath[i];
      const next = scaledPath[i + 1];
      smoothPath.push(current);

      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));

      for (let step = 1; step < steps; step++) {
        smoothPath.push(
          new Cell(
            Math.round(current.x + (dx * step) / steps),
            Math.round(current.y + (dy * step) / steps),
          ),
        );
      }
    }
    if (scaledPath.length > 0) {
      smoothPath.push(scaledPath[scaledPath.length - 1]);
    }
    return smoothPath;
  }

  private fixExtremes(upscaled: Cell[], cellDst: Cell, cellSrc?: Cell): Cell[] {
    if (cellSrc !== undefined) {
      const srcIndex = this.findCell(upscaled, cellSrc);
      if (srcIndex === -1) {
        upscaled.unshift(cellSrc);
      } else if (srcIndex !== 0) {
        upscaled = upscaled.slice(srcIndex);
      }
    }

    const dstIndex = this.findCell(upscaled, cellDst);
    if (dstIndex === -1) {
      upscaled.push(cellDst);
    } else if (dstIndex !== upscaled.length - 1) {
      upscaled = upscaled.slice(0, dstIndex + 1);
    }
    return upscaled;
  }

  private findCell(cells: Cell[], target: Cell): number {
    for (let i = 0; i < cells.length; i++) {
      if (cells[i].x === target.x && cells[i].y === target.y) {
        return i;
      }
    }
    return -1;
  }
}
