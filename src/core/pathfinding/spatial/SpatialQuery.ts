import { Game, Player, TerraNullius } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PathFinding } from "../PathFinder";

type Owner = Player | TerraNullius;

export class SpatialQuery {
  constructor(private game: Game) {}

  /**
   * Find nearest tile matching predicate using BFS traversal.
   * Uses Manhattan distance filter, ignores terrain barriers.
   */
  private bfsNearest(
    from: TileRef,
    maxDist: number,
    predicate: (t: TileRef) => boolean,
  ): TileRef | null {
    const map = this.game.map();
    const candidates: TileRef[] = [];

    for (const tile of map.bfs(
      from,
      (_, t) => map.manhattanDist(from, t) <= maxDist,
    )) {
      if (predicate(tile)) {
        candidates.push(tile);
      }
    }

    if (candidates.length === 0) return null;

    // Sort by Manhattan distance to find actual nearest
    candidates.sort(
      (a, b) => map.manhattanDist(from, a) - map.manhattanDist(from, b),
    );

    return candidates[0];
  }

  /**
   * Find closest shore tile by land BFS.
   * Works for both players and terra nullius.
   */
  closestShore(
    owner: Owner,
    tile: TileRef,
    maxDist: number = 50,
  ): TileRef | null {
    const gm = this.game;
    const ownerId = owner.smallID();

    const isValidTile = (t: TileRef) => {
      if (!gm.isShore(t) || !gm.isLand(t)) return false;
      const tOwner = gm.ownerID(t);
      return tOwner === ownerId;
    };

    return this.bfsNearest(tile, maxDist, isValidTile);
  }

  /**
   * Find closest shore tile by water pathfinding.
   * Returns null for terra nullius (no borderTiles).
   */
  closestShoreByWater(owner: Owner, target: TileRef): TileRef | null {
    if (!owner.isPlayer()) return null;

    const gm = this.game;
    const player = owner as Player;

    // Target must be water or shore (land adjacent to water)
    if (!gm.isWater(target) && !gm.isShore(target)) return null;

    const targetComponent = gm.getWaterComponent(target);
    if (targetComponent === null) return null;

    const isValidTile = (t: TileRef) => {
      if (!gm.isShore(t) || !gm.isLand(t)) return false;
      const tComponent = gm.getWaterComponent(t);
      return tComponent === targetComponent;
    };

    const shores = Array.from(player.borderTiles()).filter(isValidTile);
    if (shores.length === 0) return null;

    const path = PathFinding.Water(gm).findPath(shores, target);
    if (!path || path.length === 0) return null;

    return this.refineStartTile(path, shores, gm);
  }

  private refineStartTile(
    path: TileRef[],
    shores: TileRef[],
    gm: Game,
  ): TileRef {
    const CANDIDATE_RADIUS = 10;
    const WAYPOINT_DIST = 20;

    const bestTile = path[0];
    const map = gm.map();

    const candidates = shores.filter(
      (s) => map.manhattanDist(s, bestTile) <= CANDIDATE_RADIUS,
    );

    if (candidates.length <= 1) return bestTile;

    const waypointIdx = Math.min(WAYPOINT_DIST, path.length - 1);
    const waypoint = path[waypointIdx];

    const refinedPath = PathFinding.WaterSimple(gm).findPath(
      candidates,
      waypoint,
    );
    return refinedPath?.[0] ?? bestTile;
  }
}
