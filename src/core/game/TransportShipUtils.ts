import { MultiSourceAnyTargetBFS } from "../pathfinding/MultiSourceAnyTargetBFS";
import { Game, Player, UnitType } from "./Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./GameMap";

type BoatRoute = {
  src: TileRef;
  dst: TileRef;
  path: TileRef[];
};

let boatBfs: MultiSourceAnyTargetBFS | null = null;
let boatBfsNumTiles = 0;
function getBoatBfs(gm: GameMap): MultiSourceAnyTargetBFS {
  const numTiles = gm.width() * gm.height();
  if (boatBfs === null || boatBfsNumTiles !== numTiles) {
    boatBfs = new MultiSourceAnyTargetBFS(numTiles);
    boatBfsNumTiles = numTiles;
  }
  return boatBfs;
}

function insertTopK(
  items: { tile: TileRef; dist: number }[],
  tile: TileRef,
  dist: number,
  k: number,
) {
  if (items.length === 0) {
    items.push({ tile, dist });
    return;
  }
  if (items.length === k && dist >= items[items.length - 1]!.dist) {
    return;
  }
  let i = items.length;
  items.push({ tile, dist });
  while (i > 0 && items[i - 1]!.dist > dist) {
    items[i] = items[i - 1]!;
    i--;
  }
  items[i] = { tile, dist };
  if (items.length > k) items.pop();
}

function shoreTargetsNearClick(
  gm: Game,
  attacker: Player,
  click: TileRef,
  targetOwner: Player | ReturnType<Game["terraNullius"]>,
  maxTargets: number,
  scanRadiusTN: number,
): TileRef[] {
  // Explicit target: if user clicks a shore tile, use that exact shore.
  if (gm.isShore(click) && gm.owner(click) !== attacker) {
    const owner = gm.owner(click);
    if (!owner.isPlayer() || !attacker.isFriendly(owner)) {
      return [click];
    }
    return [];
  }

  // Water click: search a larger area but return only the closest shore tile.
  // This prevents "snapping" to far-away shores while still being usable on open water.
  if (gm.isWater(click)) {
    const cx = gm.x(click);
    const cy = gm.y(click);
    const r = 50;
    let best: TileRef | null = null;
    let bestDist = Infinity;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (!gm.isValidCoord(x, y)) continue;
        const tile = gm.ref(x, y);
        if (!gm.isShore(tile)) continue;
        const owner = gm.owner(tile);
        if (owner === attacker) continue;
        if (owner.isPlayer() && attacker.isFriendly(owner)) continue;
        const dist = Math.abs(x - cx) + Math.abs(y - cy);
        if (dist < bestDist) {
          bestDist = dist;
          best = tile;
        }
      }
    }
    return best === null ? [] : [best];
  }

  // Default behavior: scan a bounding box near the click for candidate shore tiles.
  // (Previously, player targets used all border tiles, which could pick very distant shores.)
  const top: { tile: TileRef; dist: number }[] = [];
  const cx = gm.x(click);
  const cy = gm.y(click);
  const r = scanRadiusTN;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (!gm.isValidCoord(x, y)) continue;
      const tile = gm.ref(x, y);
      if (!gm.isShore(tile)) continue;

      if (targetOwner.isPlayer()) {
        if (gm.owner(tile) !== targetOwner) continue;
      } else {
        if (gm.hasOwner(tile)) continue;
      }

      if (gm.owner(tile) === attacker) continue;
      const dist = Math.abs(x - cx) + Math.abs(y - cy);
      insertTopK(top, tile, dist, maxTargets);
    }
  }
  return top.map((x) => x.tile);
}

function adjacentWaterTiles(gm: GameMap, shore: TileRef): TileRef[] {
  const out: TileRef[] = [];
  for (const n of gm.neighbors(shore)) {
    if (gm.isWater(n)) out.push(n);
  }
  return out;
}

function pickLandingForTargetWater(
  gm: GameMap,
  click: TileRef,
  targetWater: TileRef,
  targetShores: readonly TileRef[],
): TileRef | null {
  // targetShores are already sorted by closeness to click; first adjacency wins.
  for (const shore of targetShores) {
    for (const n of gm.neighbors(shore)) {
      if (n === targetWater) return shore;
    }
  }
  // Fallback: should not happen if targetWater was built from these shores.
  let best: TileRef | null = null;
  let bestDist = Infinity;
  for (const shore of targetShores) {
    if (!gm.neighbors(shore).some((n) => gm.isWater(n))) continue;
    const d = gm.manhattanDist(click, shore);
    if (d < bestDist) {
      bestDist = d;
      best = shore;
    }
  }
  return best;
}

export function boatPathFromTileToShore(
  gm: GameMap,
  startTile: TileRef,
  dstShore: TileRef,
): TileRef[] | null {
  if (!gm.isValidRef(startTile) || !gm.isValidRef(dstShore)) return null;
  if (!gm.isShore(dstShore)) return null;

  const targetWater = adjacentWaterTiles(gm, dstShore);
  if (targetWater.length === 0) return null;

  const bfs = getBoatBfs(gm);

  let seedNodes: TileRef[] = [];
  let seedOrigins: TileRef[] = [];
  if (gm.isWater(startTile)) {
    seedNodes = [startTile];
    seedOrigins = [startTile];
  } else if (gm.isShore(startTile)) {
    const adj = adjacentWaterTiles(gm, startTile);
    if (adj.length === 0) return null;
    seedNodes = adj;
    seedOrigins = adj.map(() => startTile);
  } else {
    return null;
  }

  const result = bfs.findWaterPathFromSeeds(gm, seedNodes, seedOrigins, targetWater, {
    kingMoves: true,
    noCornerCutting: true,
    maxVisited: 300_000,
  });
  if (result === null) return null;

  if (gm.isWater(startTile)) {
    return [...result.path, dstShore];
  }
  return [startTile, ...result.path, dstShore];
}

export function bestTransportShipRoute(
  gm: Game,
  attacker: Player,
  clickTile: TileRef,
  preferredSrc: TileRef | null = null,
  maxTargetShores = 96,
): BoatRoute | false {
  const other = gm.owner(clickTile);
  if (other === attacker) return false;
  if (other.isPlayer() && attacker.isFriendly(other)) return false;

  const targetShores = shoreTargetsNearClick(
    gm,
    attacker,
    clickTile,
    other,
    maxTargetShores,
    10,
  );
  if (targetShores.length === 0) return false;

  const targetWater: TileRef[] = [];
  for (const shore of targetShores) {
    targetWater.push(...adjacentWaterTiles(gm, shore));
  }
  if (targetWater.length === 0) return false;

  const sourceShores: TileRef[] =
    preferredSrc !== null && gm.isValidRef(preferredSrc)
      ? [preferredSrc]
      : candidateShoreTiles(gm, attacker, clickTile);

  const seedNodeToOrigin = new Map<TileRef, TileRef>();
  for (const shore of sourceShores) {
    if (!gm.isValidRef(shore)) continue;
    if (gm.owner(shore) !== attacker) continue;
    if (!gm.isShore(shore)) continue;
    for (const w of adjacentWaterTiles(gm, shore)) {
      if (!seedNodeToOrigin.has(w)) {
        seedNodeToOrigin.set(w, shore);
      }
    }
  }
  if (seedNodeToOrigin.size === 0) return false;

  const seedNodes: TileRef[] = [];
  const seedOrigins: TileRef[] = [];
  for (const [node, origin] of seedNodeToOrigin.entries()) {
    seedNodes.push(node);
    seedOrigins.push(origin);
  }

  const bfs = getBoatBfs(gm);
  const result = bfs.findWaterPathFromSeeds(gm, seedNodes, seedOrigins, targetWater, {
    kingMoves: true,
    noCornerCutting: true,
    // Hard budget to avoid pathological cases; tweak as needed.
    maxVisited: 300_000,
  });
  if (result === null) return false;

  const dst = pickLandingForTargetWater(gm, clickTile, result.target, targetShores);
  if (dst === null) return false;

  const src = result.source;
  // Full route includes the shore endpoints to drive unit movement.
  const path = [src, ...result.path, dst];
  return { src, dst, path };
}

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
  const route = bestTransportShipRoute(gm, player, target, null);
  if (route === false) return false;
  return route.src;
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
