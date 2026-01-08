import { Game } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { NavMesh } from "../navmesh/NavMesh";
import { PathFinder, PathResult, PathStatus } from "../PathFinder";

export class NavMeshAdapter implements PathFinder {
  private navMesh: NavMesh;
  private pathIndex = 0;
  private path: TileRef[] | null = null;
  private lastTo: TileRef | null = null;

  constructor(private game: Game) {
    const navMesh = game.navMesh();
    if (!navMesh) {
      throw new Error("NavMeshAdapter requires game.navMesh() to be available");
    }
    this.navMesh = navMesh;
  }

  next(from: TileRef, to: TileRef, dist?: number): PathResult {
    if (typeof from !== "number" || typeof to !== "number") {
      return { status: PathStatus.NOT_FOUND };
    }

    if (!this.game.isValidRef(from) || !this.game.isValidRef(to)) {
      return { status: PathStatus.NOT_FOUND };
    }

    if (from === to) {
      return { status: PathStatus.COMPLETE, node: to };
    }

    if (dist !== undefined && dist > 0) {
      const distance = this.game.manhattanDist(from, to);

      if (distance <= dist) {
        return { status: PathStatus.COMPLETE, node: from };
      }
    }

    if (this.lastTo !== to) {
      this.path = null;
      this.pathIndex = 0;
      this.lastTo = to;
    }

    if (this.path === null) {
      this.cachePath(from, to);

      if (this.path === null) {
        return { status: PathStatus.NOT_FOUND };
      }
    }

    // Recompute if deviated from planned path
    const expectedPos = this.path[this.pathIndex - 1];
    if (this.pathIndex > 0 && from !== expectedPos) {
      this.cachePath(from, to);

      if (this.path === null) {
        return { status: PathStatus.NOT_FOUND };
      }
    }

    if (this.pathIndex >= this.path.length) {
      return { status: PathStatus.COMPLETE, node: to };
    }

    const nextNode = this.path[this.pathIndex];
    this.pathIndex++;

    return { status: PathStatus.NEXT, node: nextNode };
  }

  findPath(from: TileRef, to: TileRef): TileRef[] | null {
    return this.navMesh.findPath(from, to);
  }

  private cachePath(from: TileRef, to: TileRef): boolean {
    try {
      this.path = this.navMesh.findPath(from, to);
    } catch {
      return false;
    }

    if (this.path === null) {
      return false;
    }

    this.pathIndex = 0;

    // Path starts with 'from', skip to next tile
    if (this.path.length > 0 && this.path[0] === from) {
      this.pathIndex = 1;
    }

    return true;
  }
}
