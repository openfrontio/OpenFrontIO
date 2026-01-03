import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { Game, Player, UnitType } from "./Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./GameMap";

export function canBuildTransportShip(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  if (
    player.unitCount(UnitType.TransportShip) >= game.config().boatMaxNumber()
  ) {
    return false;
  }

  const dst = targetTransportTile(game, tile);
  if (dst === null) {
    return false;
  }

  const other = game.owner(tile);
  if (other === player) {
    return false;
  }
  if (other.isPlayer() && player.isFriendly(other)) {
    return false;
  }

  if (game.isOceanShore(dst)) {
    let myPlayerBordersOcean = false;
    for (const bt of player.borderTiles()) {
      if (game.isOceanShore(bt)) {
        myPlayerBordersOcean = true;
        break;
      }
    }

    let otherPlayerBordersOcean = false;
    if (!game.hasOwner(tile)) {
      otherPlayerBordersOcean = true;
    } else {
      for (const bt of (other as Player).borderTiles()) {
        if (game.isOceanShore(bt)) {
          otherPlayerBordersOcean = true;
          break;
        }
      }
    }

    if (myPlayerBordersOcean && otherPlayerBordersOcean) {
      return transportShipSpawn(game, player, dst);
    } else {
      return false;
    }
  }

  // Now we are boating in a lake, so do a bfs from target until we find
  // a border tile owned by the player

  const tiles = game.bfs(
    dst,
    andFN(
      manhattanDistFN(dst, 300),
      (_, t: TileRef) => game.isLake(t) || game.isShore(t),
    ),
  );

  const sorted = Array.from(tiles).sort(
    (a, b) => game.manhattanDist(dst, a) - game.manhattanDist(dst, b),
  );

  for (const t of sorted) {
    if (game.owner(t) === player) {
      return transportShipSpawn(game, player, t);
    }
  }
  return false;
}

function transportShipSpawn(
  game: Game,
  player: Player,
  targetTile: TileRef,
): TileRef | false {
  if (!game.isShore(targetTile)) {
    return false;
  }
  const spawn = closestShoreFromPlayer(game, player, targetTile);
  if (spawn === null) {
    return false;
  }
  return spawn;
}

export function sourceDstOceanShore(
  gm: Game,
  src: Player,
  tile: TileRef,
): [TileRef | null, TileRef | null] {
  const dst = gm.owner(tile);
  const srcTile = closestShoreFromPlayer(gm, src, tile);
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return [srcTile, dstTile];
}

export function targetTransportTile(gm: Game, tile: TileRef): TileRef | null {
  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }
  return dstTile;
}

/**
 * Identifies the shore tile closest to a given target for a specific player.
 * Uses a single-pass loop fusion to avoid multiple iterations and array allocations.
 * Tie-breaking is deterministic based on Tile ID.
 */
export function closestShoreFromPlayer(
  gm: GameMap,
  player: Player,
  target: TileRef,
): TileRef | null {
  let bestTile: TileRef | null = null;
  let minDistance = Infinity;

  for (const t of player.borderTiles()) {
    if (gm.isShore(t)) {
      const dist = gm.manhattanDist(target, t);

      if (dist < minDistance) {
        minDistance = dist;
        bestTile = t;
      } else if (dist === minDistance) {
        // Tie-breaker: prefer higher tile ID for determinism
        if (bestTile !== null && t > bestTile) {
          bestTile = t;
        }
      }
    }
  }

  return bestTile;
}

export function bestShoreDeploymentSource(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef | false {
  const t = targetTransportTile(gm, target);
  if (t === null) return false;

  const candidates = candidateShoreTiles(gm, player, t);
  if (candidates.length === 0) return false;

  const aStar = new MiniAStar(gm, gm.miniMap(), candidates, t, 1_000_000, 1);
  const result = aStar.compute();
  if (result !== PathFindResultType.Completed) {
    console.warn(`bestShoreDeploymentSource: path not found: ${result}`);
    return false;
  }
  const path = aStar.reconstructPath();
  if (path.length === 0) {
    return false;
  }
  const potential = path[0];
  // Since mini a* downscales the map, we need to check the neighbors
  // of the potential tile to find a valid deployment point
  const neighbors = gm
    .neighbors(potential)
    .filter((n) => gm.isShore(n) && gm.owner(n) === player);
  if (neighbors.length === 0) {
    return false;
  }
  return neighbors[0];
}

/**
 * Gathers a set of candidate shore tiles for naval operations, including extremum
 * points (Min/Max X/Y) and a representative sample of the player's border.
 * Optimized for performance on large maps with single-pass logic.
 */
export function candidateShoreTiles(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef[] {
  let closestManhattanDistance = Infinity;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  let bestByManhattan: TileRef | null = null;
  // Extremum tiles
  let tMinX: TileRef | null = null;
  let tMinY: TileRef | null = null;
  let tMaxX: TileRef | null = null;
  let tMaxY: TileRef | null = null;

  const borderShoreTiles: TileRef[] = [];

  // Single pass to gather tiles AND find extremums
  for (const tile of player.borderTiles()) {
    if (!gm.isShore(tile)) continue;

    borderShoreTiles.push(tile);
    const distance = gm.manhattanDist(tile, target);

    // Check Manhattan Best
    if (distance < closestManhattanDistance) {
      closestManhattanDistance = distance;
      bestByManhattan = tile;
    } else if (distance === closestManhattanDistance) {
      // Deterministic tie-break
      if (bestByManhattan === null || tile > bestByManhattan) {
        bestByManhattan = tile;
      }
    }

    // Check Extremums (Using fast property access)
    const cx = gm.x(tile);
    const cy = gm.y(tile);

    if (cx < minX) {
      minX = cx;
      tMinX = tile;
    } else if (cx === minX && tMinX !== null && tile > tMinX) {
      tMinX = tile;
    }

    if (cy < minY) {
      minY = cy;
      tMinY = tile;
    } else if (cy === minY && tMinY !== null && tile > tMinY) {
      tMinY = tile;
    }

    if (cx > maxX) {
      maxX = cx;
      tMaxX = tile;
    } else if (cx === maxX && tMaxX !== null && tile < tMaxX) {
      tMaxX = tile;
    }

    if (cy > maxY) {
      maxY = cy;
      tMaxY = tile;
    } else if (cy === maxY && tMaxY !== null && tile < tMaxY) {
      tMaxY = tile;
    }
  }

  // Sampling logic
  const len = borderShoreTiles.length;
  if (len === 0) return [];

  const samplingInterval = Math.max(10, Math.ceil(len / 50));
  const candidates: TileRef[] = [];

  if (bestByManhattan !== null) candidates.push(bestByManhattan);
  if (tMinX !== null) candidates.push(tMinX);
  if (tMinY !== null) candidates.push(tMinY);
  if (tMaxX !== null) candidates.push(tMaxX);
  if (tMaxY !== null) candidates.push(tMaxY);

  for (let i = 0; i < len; i += samplingInterval) {
    candidates.push(borderShoreTiles[i]);
  }

  // Remove duplicates and return
  return Array.from(new Set(candidates));
}

function closestShoreTN(
  gm: GameMap,
  tile: TileRef,
  searchDist: number,
): TileRef | null {
  const tn = Array.from(
    gm.bfs(
      tile,
      andFN((_, t) => !gm.hasOwner(t), manhattanDistFN(tile, searchDist)),
    ),
  )
    .filter((t) => gm.isShore(t))
    .sort((a, b) => gm.manhattanDist(tile, a) - gm.manhattanDist(tile, b));
  if (tn.length === 0) {
    return null;
  }
  return tn[0];
}
