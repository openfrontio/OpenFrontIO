import { Cell } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { SerialAStar } from "./SerialAStar";

// TODO: test this, get it work
export class MiniAStar implements AStar {
  private aStar: SerialAStar;

  constructor(
    private gameMap: GameMap,
    private miniMap: GameMap,
    private src: TileRef,
    private dst: TileRef,
    private canMove: (t: TileRef) => boolean,
    private iterations: number,
    private maxTries: number,
  ) {
    const miniSrc = this.miniMap.ref(
      Math.floor(gameMap.x(src) / 2),
      Math.floor(gameMap.y(src) / 2),
    );
    const miniDst = this.miniMap.ref(
      Math.floor(gameMap.x(dst) / 2),
      Math.floor(gameMap.y(dst) / 2),
    );
    this.aStar = new SerialAStar(
      miniSrc,
      miniDst,
      canMove,
      iterations,
      maxTries,
      this.miniMap,
    );
  }

  compute(): PathFindResultType {
    return this.aStar.compute();
  }

  reconstructPath(): TileRef[] {
    const upscaled = upscalePath(
      this.aStar
        .reconstructPath()
        .map((tr) => new Cell(this.miniMap.x(tr), this.miniMap.y(tr))),
    );
    upscaled.push(new Cell(this.gameMap.x(this.dst), this.gameMap.y(this.dst)));
    return upscaled.map((c) => this.gameMap.ref(c.x, c.y));
  }
}

function upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
  // Scale up each point
  const scaledPath = path.map(
    (point) => new Cell(point.x * scaleFactor, point.y * scaleFactor),
  );

  const smoothPath: Cell[] = [];

  for (let i = 0; i < scaledPath.length - 1; i++) {
    const current = scaledPath[i];
    const next = scaledPath[i + 1];

    // Add the current point
    smoothPath.push(current);

    // Always interpolate between scaled points
    const dx = next.x - current.x;
    const dy = next.y - current.y;

    // Calculate number of steps needed
    const distance = Math.max(Math.abs(dx), Math.abs(dy));
    const steps = distance;

    // Add intermediate points
    for (let step = 1; step < steps; step++) {
      smoothPath.push(
        new Cell(
          Math.round(current.x + (dx * step) / steps),
          Math.round(current.y + (dy * step) / steps),
        ),
      );
    }
  }

  // Add the last point
  if (scaledPath.length > 0) {
    smoothPath.push(scaledPath[scaledPath.length - 1]);
  }

  return smoothPath;
}
