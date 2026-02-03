import { Game, Player, TerraNullius } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { DebugSpan } from "../../utilities/DebugSpan";
import { PathFinding } from "../PathFinder";
import { AStarWaterBounded } from "../algorithms/AStar.WaterBounded";

type Owner = Player | TerraNullius;

const REFINE_MAX_SEARCH_AREA = 100 * 100;

export class SpatialQuery {
  private boundedAStar: AStarWaterBounded | null = null;

  constructor(private game: Game) {}

  private getBoundedAStar(): AStarWaterBounded {
    this.boundedAStar ??= new AStarWaterBounded(
      this.game.map(),
      REFINE_MAX_SEARCH_AREA,
    );

    return this.boundedAStar;
  }

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
    return DebugSpan.wrap("SpatialQuery.closestShoreByWater", () => {
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

      return DebugSpan.wrap("SpatialQuery.refineStartTile", () =>
        this.refineStartTile(path, shores, gm),
      );
    });
  }

  private refineStartTile(
    path: TileRef[],
    shores: TileRef[],
    gm: Game,
  ): TileRef {
    const CANDIDATE_RADIUS = 20;
    const MIN_WAYPOINT_DIST = 50;
    const MAX_WAYPOINT_DIST = 200;
    const PADDING = 10;

    if (path.length <= MIN_WAYPOINT_DIST) {
      return path[0];
    }

    const bestTile = path[0];
    const map = gm.map();

    const candidates = shores.filter(
      (s) => map.manhattanDist(s, bestTile) <= CANDIDATE_RADIUS,
    );

    if (candidates.length <= 1) return bestTile;

    // Precompute candidate bounds
    let candMinX = map.x(candidates[0]);
    let candMaxX = candMinX;
    let candMinY = map.y(candidates[0]);
    let candMaxY = candMinY;

    for (let i = 1; i < candidates.length; i++) {
      const sx = map.x(candidates[i]);
      const sy = map.y(candidates[i]);
      candMinX = Math.min(candMinX, sx);
      candMaxX = Math.max(candMaxX, sx);
      candMinY = Math.min(candMinY, sy);
      candMaxY = Math.max(candMaxY, sy);
    }

    // Binary search for furthest waypoint that keeps bounds within limit
    let lo = MIN_WAYPOINT_DIST;
    let hi = Math.min(MAX_WAYPOINT_DIST, path.length - 1);
    let bestWaypointIdx = lo;

    for (let i = 0; i < 5 && lo <= hi; i++) {
      const mid = (lo + hi) >> 1;
      const wp = path[mid];
      const wpX = map.x(wp);
      const wpY = map.y(wp);

      const minX = Math.min(candMinX, wpX) - PADDING;
      const maxX = Math.max(candMaxX, wpX) + PADDING;
      const minY = Math.min(candMinY, wpY) - PADDING;
      const maxY = Math.max(candMaxY, wpY) + PADDING;

      const area = (maxX - minX + 1) * (maxY - minY + 1);
      if (area <= REFINE_MAX_SEARCH_AREA) {
        bestWaypointIdx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const waypoint = path[bestWaypointIdx];
    const wpX = map.x(waypoint);
    const wpY = map.y(waypoint);

    const bounds = {
      minX: Math.max(0, Math.min(candMinX, wpX) - PADDING),
      maxX: Math.min(map.width() - 1, Math.max(candMaxX, wpX) + PADDING),
      minY: Math.max(0, Math.min(candMinY, wpY) - PADDING),
      maxY: Math.min(map.height() - 1, Math.max(candMaxY, wpY) + PADDING),
    };

    const boundsArea =
      (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
    if (boundsArea > REFINE_MAX_SEARCH_AREA) return bestTile;

    const refinedPath = this.getBoundedAStar().searchBounded(
      candidates,
      waypoint,
      bounds,
    );

    DebugSpan.set("$candidates", () => candidates);
    DebugSpan.set("$refinedPath", () => refinedPath);
    DebugSpan.set("$originalBestTile", () => bestTile);
    DebugSpan.set("$newBestTile", () => refinedPath?.[0] ?? bestTile);

    return refinedPath?.[0] ?? bestTile;
  }
}
