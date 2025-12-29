import { Game, Player } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { calculateBoundingBox, inscribed } from "../../Util";

/**
 * Checks whether a cluster (set of tiles) is fully surrounded by the owners in `allowedOwners`.
 * Mirrors the annexation surround logic (bounding-box inscribe) but allows multiple owners.
 */
export function isClusterSurroundedBy(
  game: Game,
  cluster: ReadonlySet<TileRef>,
  ownerId: number,
  allowedOwners: Set<number> | undefined,
): boolean {
  if (cluster.size === 0) return false;

  const enemyTiles = new Set<TileRef>();

  for (const tr of cluster) {
    if (game.isShore(tr) || game.isOnEdgeOfMap(tr)) {
      return false;
    }
    const neighbors = game.neighbors(tr);
    if (neighbors.some((n) => !game.hasOwner(n))) return false;
    let hadEnemyNeighbor = false;
    for (const n of neighbors) {
      const owner = game.ownerID(n);
      if (owner === ownerId) continue; // same owner as cluster
      if (allowedOwners && !allowedOwners.has(owner)) return false;
      enemyTiles.add(n);
      hadEnemyNeighbor = true;
    }
    if (!hadEnemyNeighbor) return false;
  }

  if (enemyTiles.size === 0) return false;

  const enemyBox = calculateBoundingBox(game, enemyTiles);
  const clusterBox = calculateBoundingBox(game, cluster);
  return inscribed(enemyBox, clusterBox);
}
