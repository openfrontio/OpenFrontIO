import { Game, Player, UnitType } from "./Game";
import { andFN, GameMap, manhattanDistFN, TileRef } from "./GameMap";

class MinHeap<T> {
  private data: { key: number; value: T }[] = [];

  get size(): number {
    return this.data.length;
  }

  push(key: number, value: T): void {
    const node = { key, value };
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): { key: number; value: T } | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].key <= this.data[i].key) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = i * 2 + 1;
      const r = l + 1;
      let smallest = i;

      if (l < n && this.data[l].key < this.data[smallest].key) smallest = l;
      if (r < n && this.data[r].key < this.data[smallest].key) smallest = r;

      if (smallest === i) break;
      [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
      i = smallest;
    }
  }
}

function isWaterTile(gm: GameMap, t: TileRef): boolean {
  const anyGM = gm as any;
  if (typeof anyGM.isWater === "function") return anyGM.isWater(t);
  if (typeof anyGM.isOcean === "function") {
    if (anyGM.isOcean(t)) return true;
    return gm.isLake(t);
  }
  return gm.isLake(t);
}

function adjacentWaterTiles(gm: GameMap, shore: TileRef): TileRef[] {
  return gm.neighbors(shore).filter((n) => isWaterTile(gm, n));
}

export function closestShoreFromPlayerByWater(
  gm: GameMap,
  player: Player,
  targetShore: TileRef,
  opts?: {
    maxSteps?: number; // safety bound
    waterFilter?: (t: TileRef) => boolean;
  },
): TileRef | null {
  if (!gm.isShore(targetShore)) return null;

  const maxSteps = opts?.maxSteps ?? 250_000;
  const waterFilter = opts?.waterFilter ?? ((t: TileRef) => isWaterTile(gm, t));

  const playerShoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );
  if (playerShoreTiles.length === 0) return null;

  const goalWaterToShore = new Map<TileRef, TileRef>();
  for (const shore of playerShoreTiles) {
    for (const w of gm.neighbors(shore)) {
      if (!waterFilter(w)) continue;
      if (!goalWaterToShore.has(w)) goalWaterToShore.set(w, shore);
    }
  }
  if (goalWaterToShore.size === 0) return null;

  // Start from water right next to the destination shore
  const starts = adjacentWaterTiles(gm, targetShore).filter(waterFilter);
  if (starts.length === 0) return null;

  // If the like destination water is already next to the player's shore, return immediately
  for (const s of starts) {
    const hit = goalWaterToShore.get(s);
    if (hit !== undefined) return hit;
  }

  const heap = new MinHeap<TileRef>();
  const dist = new Map<TileRef, number>();

  for (const s of starts) {
    dist.set(s, 0);
    heap.push(0, s);
  }

  let popped = 0;

  while (heap.size > 0) {
    const node = heap.pop()!;
    const d = node.key;
    const cur = node.value;

    const best = dist.get(cur);
    if (best === undefined || d !== best) continue;

    popped++;
    if (popped > maxSteps) {
      return null;
    }

    const shoreHit = goalWaterToShore.get(cur);
    if (shoreHit !== undefined) {
      return shoreHit;
    }

    for (const nb of gm.neighbors(cur)) {
      if (!waterFilter(nb)) continue;

      const nd = d + 1;
      const prev = dist.get(nb);
      if (prev === undefined || nd < prev) {
        dist.set(nb, nd);
        heap.push(nd, nb);
      }
    }
  }

  return null;
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

  const spawn = closestShoreFromPlayerByWater(game, player, dst, {
    waterFilter: (t) => game.isLake(t),
    maxSteps: 3_000_000,
  });

  if (spawn === null) return false;
  return transportShipSpawn(game, player, spawn);
}

function transportShipSpawn(
  game: Game,
  player: Player,
  targetTile: TileRef,
): TileRef | false {
  if (!game.isShore(targetTile)) {
    return false;
  }

  const spawn = closestShoreFromPlayerByWater(game, player, targetTile, {
    maxSteps: 3_000_000,
  });

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

  const srcTarget = targetTransportTile(gm, tile);
  const srcTile = srcTarget
    ? closestShoreFromPlayerByWater(gm, src, srcTarget)
    : null;

  let dstTile: TileRef | null = null;
  if (dst.isPlayer()) {
    // destination side is their closest reachable shore by water as well
    const dt = targetTransportTile(gm, tile);
    dstTile = dt ? closestShoreFromPlayerByWater(gm, dst as Player, dt) : null;
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
  const t = targetTransportTile(gm, target);
  if (t === null) return false;

  // IMPORTANT CHANGE:One exact water search replaces MiniAStar + sampling.
  const best = closestShoreFromPlayerByWater(gm, player, t, {
    maxSteps: 500_000,
  });
  if (best === null) return false;

  if (!gm.isShore(best) || gm.owner(best) !== player) return false;
  return best;
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

  maxY = 1;
  const borderShoreTiles = Array.from(player.borderTiles()).filter((t) =>
    gm.isShore(t),
  );

  for (const tile of borderShoreTiles) {
    const distance = gm.manhattanDist(tile, target);
    const cell = gm.cell(tile);

    if (distance < closestManhattanDistance) {
      closestManhattanDistance = distance;
      bestByManhattan = tile;
    }

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
      extremumTiles.maxY = tile;
    }
  }

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
