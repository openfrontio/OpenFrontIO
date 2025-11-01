import { Game } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { DistanceBasedBezierCurve } from "../utilities/Line";
import { AStar, AStarResult, PathFindResultType } from "./AStar";
import { MiniAStar } from "./MiniAStar";

const parabolaMinHeight = 50;

export class ParabolaPathFinder {
  constructor(
    private mg: GameMap,
    private wrapHorizontally: boolean = false,
    private wrapVertically: boolean = false,
  ) {}
  private curve: DistanceBasedBezierCurve | undefined;

  computeControlPoints(
    orig: TileRef,
    dst: TileRef,
    increment: number = 3,
    distanceBasedHeight = true,
  ) {
    // Compute tile center coordinates for origin and destination, but adjust
    // destination to the equivalent wrapped coordinate that yields the
    // shortest displacement if the map supports wrapping. This allows
    // parabola paths (used by nukes/MIRVs) to traverse map edges smoothly.
    const p0 = { x: this.mg.x(orig), y: this.mg.y(orig) };
    let p3x = this.mg.x(dst);
    let p3y = this.mg.y(dst);

    // If the map wraps horizontally/vertically, choose the closest image of dst
    // by shifting p3 by +/- width/height when that yields a smaller delta.
    const w = this.mg.width();
    const h = this.mg.height();

    if (this.wrapHorizontally) {
      const rawDx = p3x - p0.x;
      // consider wrapping left and right
      const altDx1 = p3x - w - p0.x; // wrapped left
      const altDx2 = p3x + w - p0.x; // wrapped right
      // choose the dx with minimal absolute value
      const bestDx =
        Math.abs(rawDx) <= Math.abs(altDx1) &&
        Math.abs(rawDx) <= Math.abs(altDx2)
          ? rawDx
          : Math.abs(altDx1) <= Math.abs(altDx2)
            ? altDx1
            : altDx2;
      p3x = p0.x + bestDx;
    }

    if (this.wrapVertically) {
      const rawDy = p3y - p0.y;
      // consider wrapping up and down
      const altDy1 = p3y - h - p0.y; // wrapped up
      const altDy2 = p3y + h - p0.y; // wrapped down
      const bestDy =
        Math.abs(rawDy) <= Math.abs(altDy1) &&
        Math.abs(rawDy) <= Math.abs(altDy2)
          ? rawDy
          : Math.abs(altDy1) <= Math.abs(altDy2)
            ? altDy1
            : altDy2;
      p3y = p0.y + bestDy;
    }

    const p3 = { x: p3x, y: p3y };
    const dx = p3.x - p0.x;
    const dy = p3.y - p0.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxHeight = distanceBasedHeight
      ? Math.max(distance / 3, parabolaMinHeight)
      : 0;
    // Use a bezier curve always pointing up
    const p1 = {
      x: p0.x + (p3.x - p0.x) / 4,
      y: Math.max(p0.y + (p3.y - p0.y) / 4 - maxHeight, 0),
    };
    const p2 = {
      x: p0.x + ((p3.x - p0.x) * 3) / 4,
      y: Math.max(p0.y + ((p3.y - p0.y) * 3) / 4 - maxHeight, 0),
    };

    this.curve = new DistanceBasedBezierCurve(p0, p1, p2, p3, increment);
  }

  nextTile(speed: number): TileRef | true {
    if (!this.curve) {
      throw new Error("ParabolaPathFinder not initialized");
    }
    const nextPoint = this.curve.increment(speed);
    if (!nextPoint) {
      return true;
    }

    // Normalize / wrap coordinates so they map into the game's tile grid.
    // When maps wrap horizontally/vertically the bezier control points may
    // produce points outside the nominal 0..width-1 / 0..height-1 range.
    // Use the map's wrap settings to fold them back into valid coordinates.
    let x = Math.floor(nextPoint.x);
    let y = Math.floor(nextPoint.y);

    const w = this.mg.width();
    const h = this.mg.height();

    if (this.wrapHorizontally) {
      x = ((x % w) + w) % w;
    }
    if (this.wrapVertically) {
      y = ((y % h) + h) % h;
    }

    return this.mg.ref(x, y);
  }

  currentIndex(): number {
    if (!this.curve) {
      return 0;
    }
    return this.curve.getCurrentIndex();
  }

  allTiles(): TileRef[] {
    if (!this.curve) {
      return [];
    }

    // Fold sampled bezier points relative to the previous sample so that when
    // the map wraps the trajectory doesn't draw a long line across the entire
    // world. For each sampled point choose the wrapped image closest to the
    // previously chosen point (in the unwrapped coordinate space), then map
    // that chosen image back into 0..width-1 / 0..height-1 when producing
    // the TileRef instances.
    const w = this.mg.width();
    const h = this.mg.height();
    const points = this.curve.getAllPoints();
    const tiles: TileRef[] = [];

    // prev holds the chosen (possibly unwrapped) coordinates for the previous
    // sample. We keep it in the same coordinate space used to select the best
    // wrapped image so distance comparisons are meaningful.
    let prev: { x: number; y: number } | null = null;

    for (const point of points) {
      const baseX = Math.floor(point.x);
      const baseY = Math.floor(point.y);

      // If no wrapping is enabled, this is a simple mapping.
      if (!this.wrapHorizontally && !this.wrapVertically) {
        tiles.push(this.mg.ref(baseX, baseY));
        prev = { x: baseX, y: baseY };
        continue;
      }

      // For wrapped maps consider alternative images offset by +/- width and/or +/- height.
      const xShifts = this.wrapHorizontally ? [0, -w, w] : [0];
      const yShifts = this.wrapVertically ? [0, -h, h] : [0];

      // If this is the first point, pick the canonical wrapped position and
      // initialize prev to its unwrapped counterpart (baseX/baseY).
      if (prev === null) {
        const wrappedX = this.wrapHorizontally ? ((baseX % w) + w) % w : baseX;
        const wrappedY = this.wrapVertically ? ((baseY % h) + h) % h : baseY;
        tiles.push(this.mg.ref(wrappedX, wrappedY));
        prev = { x: baseX, y: baseY };
        continue;
      }

      // Choose the candidate image (base + shift) that is closest to prev.
      let best = { cx: baseX, cy: baseY, dist2: Number.POSITIVE_INFINITY };
      for (const sx of xShifts) {
        for (const sy of yShifts) {
          const cx = baseX + sx;
          const cy = baseY + sy;
          const dx = cx - prev.x;
          const dy = cy - prev.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < best.dist2) {
            best = { cx, cy, dist2: d2 };
          }
        }
      }

      // Fold the chosen image back into valid map coordinates for TileRef.
      const finalX = this.wrapHorizontally ? ((best.cx % w) + w) % w : best.cx;
      const finalY = this.wrapVertically ? ((best.cy % h) + h) % h : best.cy;

      tiles.push(this.mg.ref(finalX, finalY));
      // Store the unwrapped chosen coordinates so the next iteration can pick
      // the nearest image relative to this one.
      prev = { x: best.cx, y: best.cy };
    }

    return tiles;
  }
}

export class AirPathFinder {
  constructor(
    private mg: GameMap,
    private random: PseudoRandom,
  ) {}

  nextTile(tile: TileRef, dst: TileRef): TileRef | true {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    const dstX = this.mg.x(dst);
    const dstY = this.mg.y(dst);

    if (x === dstX && y === dstY) {
      return true;
    }

    // Calculate next position
    let nextX = x;
    let nextY = y;

    const ratio = Math.floor(1 + Math.abs(dstY - y) / (Math.abs(dstX - x) + 1));

    if (this.random.chance(ratio) && x !== dstX) {
      if (x < dstX) nextX++;
      else if (x > dstX) nextX--;
    } else {
      if (y < dstY) nextY++;
      else if (y > dstY) nextY--;
    }
    if (nextX === x && nextY === y) {
      return true;
    }
    return this.mg.ref(nextX, nextY);
  }
}

export class PathFinder {
  private curr: TileRef | null = null;
  private dst: TileRef | null = null;
  private path: TileRef[] | null = null;
  private path_idx: number = 0;
  private aStar: AStar<TileRef>;
  private computeFinished = true;

  private constructor(
    private game: Game,
    private newAStar: (curr: TileRef, dst: TileRef) => AStar<TileRef>,
  ) {}

  public static Mini(
    game: Game,
    iterations: number,
    waterPath: boolean = true,
    maxTries: number = 20,
  ) {
    return new PathFinder(game, (curr: TileRef, dst: TileRef) => {
      return new MiniAStar(
        game.map(),
        game.miniMap(),
        curr,
        dst,
        iterations,
        maxTries,
        waterPath,
      );
    });
  }

  nextTile(
    curr: TileRef | null,
    dst: TileRef | null,
    dist: number = 1,
  ): AStarResult<TileRef> {
    if (curr === null) {
      console.error("curr is null");
      return { type: PathFindResultType.PathNotFound };
    }
    if (dst === null) {
      console.error("dst is null");
      return { type: PathFindResultType.PathNotFound };
    }

    if (this.game.manhattanDist(curr, dst) < dist) {
      this.path = null;
      return { type: PathFindResultType.Completed, node: curr };
    }

    if (this.computeFinished) {
      if (this.shouldRecompute(curr, dst)) {
        this.curr = curr;
        this.dst = dst;
        this.path = null;
        this.path_idx = 0;
        this.aStar = this.newAStar(curr, dst);
        this.computeFinished = false;
        return this.nextTile(curr, dst);
      } else {
        const tile = this.path?.[this.path_idx++];
        if (tile === undefined) {
          throw new Error("missing tile");
        }
        return { type: PathFindResultType.NextTile, node: tile };
      }
    }

    switch (this.aStar.compute()) {
      case PathFindResultType.Completed:
        this.computeFinished = true;
        this.path = this.aStar.reconstructPath();

        // exclude first tile
        this.path_idx = 1;

        return this.nextTile(curr, dst);
      case PathFindResultType.Pending:
        return { type: PathFindResultType.Pending };
      case PathFindResultType.PathNotFound:
        return { type: PathFindResultType.PathNotFound };
      default:
        throw new Error("unexpected compute result");
    }
  }

  private shouldRecompute(curr: TileRef, dst: TileRef) {
    if (this.path === null || this.curr === null || this.dst === null) {
      return true;
    }
    const dist = this.game.manhattanDist(curr, dst);
    let tolerance = 10;
    if (dist > 50) {
      tolerance = 10;
    } else if (dist > 25) {
      tolerance = 5;
    } else {
      tolerance = 0;
    }
    if (this.game.manhattanDist(this.dst, dst) > tolerance) {
      return true;
    }
    return false;
  }
}
