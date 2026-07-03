import { GameMap, TileRef } from "../../game/GameMap";
import { PathFinder } from "../types";

export class MiniMapTransformer implements PathFinder<number> {
  constructor(
    private inner: PathFinder<number>,
    private map: GameMap,
    private miniMap: GameMap,
  ) {}

  findPath(from: TileRef | TileRef[], to: TileRef): TileRef[] | null {
    // Convert game coords → minimap coords (supports multi-source)
    const fromArray = Array.isArray(from) ? from : [from];
    const miniFromArray = fromArray.map((f) =>
      this.miniMap.ref(
        Math.floor(this.map.x(f) / 2),
        Math.floor(this.map.y(f) / 2),
      ),
    );
    const miniFrom =
      miniFromArray.length === 1 ? miniFromArray[0] : miniFromArray;

    const miniTo = this.miniMap.ref(
      Math.floor(this.map.x(to) / 2),
      Math.floor(this.map.y(to) / 2),
    );

    // Search on minimap
    const path = this.inner.findPath(miniFrom, miniTo);
    if (!path || path.length === 0) {
      return null;
    }

    // Upscale minimap path to main-map refs. All coordinate work stays
    // numeric (paths can be thousands of points, so per-point wrapper
    // objects are significant churn).
    const upscaledPath = this.upscalePath(path);

    // For multi-source, find closest source to path start
    let srcRef: TileRef | undefined;
    if (Array.isArray(from)) {
      if (upscaledPath.length > 0) {
        const startX = this.map.x(upscaledPath[0]);
        const startY = this.map.y(upscaledPath[0]);
        let minDist = Infinity;
        for (const f of from) {
          const dist =
            Math.abs(this.map.x(f) - startX) + Math.abs(this.map.y(f) - startY);
          if (dist < minDist) {
            minDist = dist;
            srcRef = f;
          }
        }
      }
    } else {
      srcRef = from;
    }
    return this.fixExtremes(upscaledPath, to, srcRef);
  }

  /**
   * Scale a minimap path up to main-map refs, inserting interpolated points
   * so consecutive path tiles stay adjacent.
   */
  private upscalePath(path: TileRef[], scaleFactor: number = 2): TileRef[] {
    const mini = this.miniMap;
    const main = this.map;
    const smoothPath: TileRef[] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const curX = mini.x(path[i]) * scaleFactor;
      const curY = mini.y(path[i]) * scaleFactor;
      const nextX = mini.x(path[i + 1]) * scaleFactor;
      const nextY = mini.y(path[i + 1]) * scaleFactor;

      smoothPath.push(main.ref(curX, curY));

      const dx = nextX - curX;
      const dy = nextY - curY;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));

      for (let step = 1; step < steps; step++) {
        smoothPath.push(
          main.ref(
            Math.round(curX + (dx * step) / steps),
            Math.round(curY + (dy * step) / steps),
          ),
        );
      }
    }

    if (path.length > 0) {
      const last = path[path.length - 1];
      smoothPath.push(
        main.ref(mini.x(last) * scaleFactor, mini.y(last) * scaleFactor),
      );
    }

    return smoothPath;
  }

  private fixExtremes(
    upscaled: TileRef[],
    dst: TileRef,
    src?: TileRef,
  ): TileRef[] {
    if (src !== undefined) {
      const srcIndex = upscaled.indexOf(src);
      if (srcIndex === -1) {
        upscaled.unshift(src);
      } else if (srcIndex !== 0) {
        upscaled = upscaled.slice(srcIndex);
      }
    }

    const dstIndex = upscaled.indexOf(dst);
    if (dstIndex === -1) {
      upscaled.push(dst);
    } else if (dstIndex !== upscaled.length - 1) {
      upscaled = upscaled.slice(0, dstIndex + 1);
    }
    return upscaled;
  }
}
