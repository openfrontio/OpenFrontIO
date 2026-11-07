import { TileRef } from "@openfront/engine-api/game/GameMap";
import { Game } from "../game/Game";

/** Land a tank can drive on. */
export function isDrivable(mg: Game, tile: TileRef): boolean {
  return mg.isLand(tile) && !mg.isImpassable(tile);
}

/**
 * One step of a straight, eight-direction flight from `from` towards `to`.
 * Integer math only, so every client takes the same route.
 */
export function stepAir(mg: Game, from: TileRef, to: TileRef): TileRef {
  if (from === to) return from;
  const dx = mg.x(to) - mg.x(from);
  const dy = mg.y(to) - mg.y(from);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let mx = Math.sign(dx);
  let my = Math.sign(dy);
  // Mostly horizontal or vertical: do not zig-zag.
  if (ax > 2 * ay) my = 0;
  else if (ay > 2 * ax) mx = 0;
  return mg.ref(mg.x(from) + mx, mg.y(from) + my);
}

/**
 * The neighbouring drivable tile that gets closest to `to`, or undefined when
 * every neighbour is further away (a lake or cliff in the way).
 */
export function stepLand(
  mg: Game,
  from: TileRef,
  to: TileRef,
): TileRef | undefined {
  let best: TileRef | undefined;
  let bestDist = mg.euclideanDistSquared(from, to);
  for (const n of mg.neighbors(from)) {
    if (!isDrivable(mg, n)) continue;
    const d = mg.euclideanDistSquared(n, to);
    if (d < bestDist) {
      best = n;
      bestDist = d;
    }
  }
  return best;
}
