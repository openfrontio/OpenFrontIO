import { Cell } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { SerialAStar } from "./SerialAStar";

export class MiniAStar implements AStar {
  private aStar: AStar | null; 
  private miniPath: TileRef[] | null = null; 
  private static pathCache: Map<string, TileRef[]> = new Map(); 

  constructor(
    private gameMap: GameMap,
    private miniMap: GameMap,
    src: TileRef | TileRef[],
    private dst: TileRef,
    iterations: number,
    maxTries: number,
  ) {
    const srcArray: TileRef[] = Array.isArray(src) ? src : [src];
    const miniSrc = srcArray.map((srcPoint) =>
      this.miniMap.ref(
        Math.floor(gameMap.x(srcPoint) / 2),
        Math.floor(gameMap.y(srcPoint) / 2),
      ),
    );

    const miniDst = this.miniMap.ref(
      Math.floor(gameMap.x(dst) / 2),
      Math.floor(gameMap.y(dst) / 2),
    );

    
    if (miniSrc.length > 0) {
      const key = this.getCacheKey(miniSrc[0], miniDst);
      if (MiniAStar.pathCache.has(key)) {
        this.miniPath = MiniAStar.pathCache.get(key);
        this.aStar = null;
      }
    }

   
    if (this.miniPath == null) {
      this.aStar = new SerialAStar(
        miniSrc,
        miniDst,
        iterations,
        maxTries,
        this.miniMap,
      );
    }
  }

  private getCacheKey(src: TileRef, dst: TileRef): string {
    return `${this.miniMap.x(src)},${this.miniMap.y(src)}-${this.miniMap.x(dst)},${this.miniMap.y(dst)}`;
  }

  compute(): PathFindResultType {
  
    if (this.miniPath != null) {
      return PathFindResultType.Completed;
    }

  
    if (this.aStar == null) {
      return PathFindResultType.PathNotFound;
    }

   
    const result = this.aStar.compute();
    if (result === PathFindResultType.Completed) {
      this.miniPath = this.aStar.reconstructPath();
     
      const miniSrc = (this.aStar as SerialAStar).reconstructPath()[0]; 
      const miniDst = this.miniMap.ref(
        Math.floor(this.gameMap.x(this.dst) / 2),
        Math.floor(this.gameMap.y(this.dst) / 2),
      );
      const key = this.getCacheKey(miniSrc, miniDst);
      MiniAStar.pathCache.set(key, this.miniPath);
    }
    return result;
  }

  reconstructPath(): TileRef[] {
    
    const miniPath = this.miniPath || (this.aStar ? this.aStar.reconstructPath() : []);
    const upscaled = upscalePath(
      miniPath.map((tr) => new Cell(this.miniMap.x(tr), this.miniMap.y(tr))),
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
