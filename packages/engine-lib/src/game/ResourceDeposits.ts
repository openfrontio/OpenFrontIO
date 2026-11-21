import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import { TerrainType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";

/** A circular uranium deposit: centre tile coordinates and radius in tiles. */
export interface Deposit {
  x: number;
  y: number;
  r: number;
}

export const DEFAULT_DEPOSIT_RADIUS = 3;
const MIN_DEPOSITS = 4;
const MAX_DEPOSITS = 48;
const LAND_TILES_PER_DEPOSIT = 60_000;
const MIN_CENTRE_SPACING = 60;
const ATTEMPTS_PER_DEPOSIT = 200;

/** How many deposits a map with `numLandTiles` land tiles gets. */
export function depositCount(numLandTiles: number): number {
  const n = Math.round(numLandTiles / LAND_TILES_PER_DEPOSIT);
  return Math.max(MIN_DEPOSITS, Math.min(MAX_DEPOSITS, n));
}

/**
 * The seed a map's deposits derive from. It depends only on the map's shape,
 * so every game on the same map gets the same deposits (players can learn
 * them) and every client computes the same set.
 */
export function depositSeed(map: GameMap): number {
  return simpleHash(`uranium:${map.width()}x${map.height()}:${map.numLandTiles()}`);
}

function isGoodCentre(map: GameMap, t: TileRef): boolean {
  if (!map.isLand(t) || map.isImpassable(t) || map.isShore(t)) return false;
  const terrain = map.terrainType(t);
  return terrain === TerrainType.Plains || terrain === TerrainType.Highland;
}

/**
 * Places uranium deposits deterministically with rejection sampling: centres
 * on non-shore plains or highland, at least MIN_CENTRE_SPACING apart (scaled
 * down for small maps). Pure integer math plus the seeded PRNG.
 */
export function seedUraniumDeposits(
  map: GameMap,
  seed: number = depositSeed(map),
): Deposit[] {
  const w = map.width();
  const h = map.height();
  if (w === 0 || h === 0 || map.numLandTiles() === 0) return [];
  const want = depositCount(map.numLandTiles());
  // Small maps cannot fit MIN_CENTRE_SPACING between every deposit.
  const spacing = Math.max(
    8,
    Math.min(MIN_CENTRE_SPACING, Math.floor(Math.min(w, h) / 4)),
  );
  const spacingSq = spacing * spacing;
  const rand = new PseudoRandom(seed);
  const out: Deposit[] = [];
  const maxAttempts = want * ATTEMPTS_PER_DEPOSIT;
  for (let attempt = 0; attempt < maxAttempts && out.length < want; attempt++) {
    const x = rand.nextInt(0, w);
    const y = rand.nextInt(0, h);
    const t = map.ref(x, y);
    if (!isGoodCentre(map, t)) continue;
    let tooClose = false;
    for (const d of out) {
      const dx = d.x - x;
      const dy = d.y - y;
      if (dx * dx + dy * dy < spacingSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    out.push({ x, y, r: DEFAULT_DEPOSIT_RADIUS });
  }
  return out;
}

/**
 * Validates manifest-supplied deposits against the map: drops any whose
 * centre is off the map, and clamps radii to 1..8.
 */
export function sanitizeDeposits(map: GameMap, deposits: Deposit[]): Deposit[] {
  const out: Deposit[] = [];
  for (const d of deposits) {
    const x = Math.floor(d.x);
    const y = Math.floor(d.y);
    if (!map.isValidCoord(x, y)) continue;
    const r = Math.max(1, Math.min(8, Math.floor(d.r ?? DEFAULT_DEPOSIT_RADIUS)));
    out.push({ x, y, r });
  }
  return out;
}

/** Per-tile lookup: 1 where a tile lies inside any deposit, else 0. */
export function rasterizeDeposits(map: GameMap, deposits: Deposit[]): Uint8Array {
  const w = map.width();
  const h = map.height();
  const mask = new Uint8Array(w * h);
  for (const d of deposits) {
    const r2 = d.r * d.r;
    for (let dy = -d.r; dy <= d.r; dy++) {
      const y = d.y + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -d.r; dx <= d.r; dx++) {
        const x = d.x + dx;
        if (x < 0 || x >= w) continue;
        if (dx * dx + dy * dy > r2) continue;
        mask[y * w + x] = 1;
      }
    }
  }
  return mask;
}
