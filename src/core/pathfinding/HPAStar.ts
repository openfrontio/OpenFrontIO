import { SerialAStar } from "./SerialAStar";
import { GameMap, TileRef } from "../game/GameMap";
import { AStar, PathFindResultType } from "./AStar";
import { Game } from "../game/Game";
import { AbstractGraph, Gateway } from "./AbstractGraph";

export class HPAStar implements AStar {
  private graph: AbstractGraph;
  private phase: "abstract" | "refine" = "abstract";

  private hiAstar: SerialAStar;
  private loAstar: SerialAStar | null = null;

  private hiPath: Gateway[] = [];
  private finalPath: TileRef[] = [];

  constructor(
    private game: Game,
    private src: TileRef,
    private dst: TileRef,
    private iterations: number,
    private maxTries: number,
  ) {
    this.graph = HPAStar.getOrCreateGraph(this.game.map());

    const srcGW = this.closestGateway(this.src);
    const dstGW = this.closestGateway(this.dst);

    this.hiAstar = new SerialAStar(
      srcGW.pos,
      dstGW.pos,
      /* iterations = */ 500,
      /* maxTries = */ 1,
      this.game.map(),
    );
  }

  compute(): PathFindResultType {
    if (this.phase === "abstract") {
      const res = this.hiAstar.compute();
      if (res === PathFindResultType.Completed) {
        this.hiPath = this.hiAstar.reconstructPath() as unknown as Gateway[];
        this.phase = "refine";
      } else {
        return res;
      }
    }

    if (this.finalPath.length === 0) {
      const firstTarget =
        this.hiPath.length > 0 ? this.hiPath[0].pos : this.dst;
      this.loAstar = new SerialAStar(
        this.src,
        firstTarget,
        this.iterations,
        this.maxTries,
        this.game.map(),
      );
      this.finalPath.push(this.src);
    }

    while (this.loAstar) {
      const status = this.loAstar.compute();
      if (status === PathFindResultType.Pending) return status;
      if (status === PathFindResultType.PathNotFound)
        return PathFindResultType.PathNotFound;

      const chunk = this.loAstar.reconstructPath();
      this.finalPath.push(...chunk.slice(1));

      if (this.hiPath.length === 0) {
        return PathFindResultType.Completed;
      }

      const nextGW = this.hiPath.shift()!.pos;
      const nextTarget = this.hiPath.length > 0 ? this.hiPath[0].pos : this.dst;
      this.loAstar = new SerialAStar(
        nextGW,
        nextTarget,
        this.iterations,
        this.maxTries,
        this.game.map(),
      );
    }
    return PathFindResultType.Pending;
  }

  reconstructPath(): TileRef[] {
    return this.finalPath;
  }

  private closestGateway(tile: TileRef): Gateway {
    const gm = this.game.map() as GameMap;
    let best: Gateway = this.graph.gateways[0];
    let bestD = Infinity;
    for (const gw of this.graph.gateways) {
      const d =
        Math.abs(gm.x(tile) - gm.x(gw.pos)) +
        Math.abs(gm.y(tile) - gm.y(gw.pos));
      if (d < bestD) {
        bestD = d;
        best = gw;
      }
    }
    return best;
  }

  private static cache = new WeakMap<GameMap, AbstractGraph>();
  private static getOrCreateGraph(gm: GameMap): AbstractGraph {
    let g = this.cache.get(gm);
    if (!g) {
      g = new AbstractGraph(gm);
      this.cache.set(gm, g);
    }
    return g;
  }
}
