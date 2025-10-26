import { PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";
import { Game, Player, UnitType } from "./Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./GameMap";
interface CacheEntry<T> {
  tick: number;
  value: T;
}

const transportTileCache = new Map<string, CacheEntry<TileRef | null>>();
const buildTransportShipCache = new Map<string, CacheEntry<TileRef | false>>();

function getTransportTileCacheKey(tile: TileRef, tick: number): string {
  return `transport_${tile}_${tick}`;
}

function getBuildCacheKey(
  playerId: string,
  tile: TileRef,
  tick: number,
): string {
  return `build_${playerId}_${tile}_${tick}`;
}

let lastCleanupTick = 0;

function cleanupCache<T>(
  cache: Map<string, CacheEntry<T>>,
  currentTick: number,
  cacheName: string, //TODO: remove after testing
): void {
  if (currentTick < lastCleanupTick + 20) {
    return;
  }
  lastCleanupTick = currentTick;

  for (const [key, entry] of cache.entries()) {
    if (entry.tick < currentTick) {
      console.log(
        `Cleaning up ${cacheName} cache for key ${key} at tick ${entry.tick}`,
      );
      cache.delete(key);
    }
  }
}

export function canBuildTransportShip(
  game: Game,
  player: Player,
  tile: TileRef,
): TileRef | false {
  const currentTick = game.ticks();
  const key = getBuildCacheKey(player.id(), tile, currentTick);

  const cached = buildTransportShipCache.get(key);
  if (cached?.tick === currentTick) {
    console.log(
      "Using cached canBuildTransportShip for player " +
        player.id() +
        " tile " +
        tile +
        " at tick " +
        currentTick,
    ); //TODO: remove after testing
    return cached.value;
  }

  if (
    player.unitCount(UnitType.TransportShip) >= game.config().boatMaxNumber()
  ) {
    buildTransportShipCache.set(key, { tick: currentTick, value: false });
    return false;
  }

  const other = game.owner(tile);
  if (other === player || (other.isPlayer() && player.isFriendly(other))) {
    buildTransportShipCache.set(key, { tick: currentTick, value: false });
    return false;
  }

  const dst = targetTransportTile(game, tile);
  if (dst === null) {
    buildTransportShipCache.set(key, { tick: currentTick, value: false });
    return false;
  }

  let result: TileRef | false = false;

  if (game.isOceanShore(dst)) {
    let myPlayerBordersOcean = false;
    for (const bt of player.borderTiles()) {
      if (game.isOceanShore(bt)) {
        myPlayerBordersOcean = true;
        break;
      }
    }
    if (myPlayerBordersOcean) {
      result = transportShipSpawn(game, player, dst);
    }
  } else {
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
        result = transportShipSpawn(game, player, t);
        break;
      }
    }
  }

  buildTransportShipCache.set(key, { tick: currentTick, value: result });
  cleanupCache(buildTransportShipCache, currentTick, "buildTransportShip"); //TODO: remove last param after testing

  return result;
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

export function targetTransportTile(gm: Game, tile: TileRef): TileRef | null {
  const currentTick = gm.ticks();
  const key = getTransportTileCacheKey(tile, currentTick);

  const cached = transportTileCache.get(key);
  if (cached?.tick === currentTick) {
    console.log(
      "Using cached transport tile for " + tile + " at tick " + currentTick,
    ); //TODO: remove after testing
    return cached.value;
  }

  const dst = gm.playerBySmallID(gm.ownerID(tile));
  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    dstTile = closestShoreFromPlayer(gm, dst as Player, tile);
  } else {
    dstTile = closestShoreTN(gm, tile, 50);
  }

  transportTileCache.set(key, { tick: currentTick, value: dstTile });
  cleanupCache(transportTileCache, currentTick, "transportTile"); //TODO: remove last param after testing

  return dstTile;
}

export function closestShoreFromPlayer(
  gm: GameMap,
  player: Player,
  target: TileRef,
): TileRef | null {
  const shoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );
  if (shoreTiles.length === 0) {
    return null;
  }

  return shoreTiles.reduce((closest, current) => {
    const closestDistance = gm.manhattanDist(target, closest);
    const currentDistance = gm.manhattanDist(target, current);
    return currentDistance < closestDistance ? current : closest;
  });
}

export function bestShoreDeploymentSource(
  gm: Game,
  player: Player,
  target: TileRef,
): TileRef | false {
  const t = targetTransportTile(gm, target);
  if (t === null) return false;

  const candidates = candidateShoreTiles(gm, player, t);
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
  const extremumTiles: Record<string, TileRef | null> = {
    minX: null,
    minY: null,
    maxX: null,
    maxY: null,
  };

  const borderShoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );

  for (const tile of borderShoreTiles) {
    const distance = gm.manhattanDist(tile, target);
    const cell = gm.cell(tile);

    // Manhattan-closest tile
    if (distance < closestManhattanDistance) {
      closestManhattanDistance = distance;
      bestByManhattan = tile;
    }

    // Extremum tiles
    if (cell.x < minX) {
      minX = cell.x;
      extremumTiles.minX = tile;
    } else if (cell.y < minY) {
      minY = cell.y;
      extremumTiles.minY = tile;
    } else if (cell.x > maxX) {
      maxX = cell.x;
      extremumTiles.maxX = tile;
    } else if (cell.y > maxY) {
      maxY = cell.y;
      extremumTiles.maxY = tile;
    }
  }

  // Calculate sampling interval to ensure we get at most 50 tiles
  const samplingInterval = Math.max(
    10,
    Math.ceil(borderShoreTiles.length / 50),
  );
  const sampledTiles = borderShoreTiles.filter(
    (_, index) => index % samplingInterval === 0,
  );

  const candidates = [
    bestByManhattan,
    extremumTiles.minX,
    extremumTiles.minY,
    extremumTiles.maxX,
    extremumTiles.maxY,
    ...sampledTiles,
  ].filter(Boolean) as number[];

  return candidates;
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
