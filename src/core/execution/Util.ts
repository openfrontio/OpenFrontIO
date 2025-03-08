import { euclDistFN, GameMap, TileRef } from "../game/GameMap";

export function getSpawnTiles(gm: GameMap, tile: TileRef): TileRef[] {
  return Array.from(gm.bfs(tile, euclDistFN(tile, 4, false))).filter(
    (t) => !gm.hasOwner(t) && gm.isLand(t),
  );
}

export function closestTwoTiles(
  gm: GameMap,
  x: Iterable<TileRef>,
  y: Iterable<TileRef>,
): { x: TileRef; y: TileRef } {
  const xSorted = Array.from(x).sort((a, b) => gm.x(a) - gm.x(b));
  const ySorted = Array.from(y).sort((a, b) => gm.x(a) - gm.x(b));

  if (xSorted.length == 0 || ySorted.length == 0) {
    return null;
  }

  let i = 0;
  let j = 0;
  let minDistance = Infinity;
  let result = { x: xSorted[0], y: ySorted[0] };

  while (i < xSorted.length && j < ySorted.length) {
    const currentX = xSorted[i];
    const currentY = ySorted[j];

    const distance =
      Math.abs(gm.x(currentX) - gm.x(currentY)) +
      Math.abs(gm.y(currentX) - gm.y(currentY));

    if (distance < minDistance) {
      minDistance = distance;
      result = { x: currentX, y: currentY };
    }

    // If we're at the end of X, must move Y forward
    if (i === xSorted.length - 1) {
      j++;
    }
    // If we're at the end of Y, must move X forward
    else if (j === ySorted.length - 1) {
      i++;
    }
    // Otherwise, move whichever pointer has smaller x value
    else if (gm.x(currentX) < gm.x(currentY)) {
      i++;
    } else {
      j++;
    }
  }

  return result;
}
