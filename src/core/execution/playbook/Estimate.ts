// Attack estimator: replays AttackExecution's per-tile loop against a virtual copy of the defender's
// troops and tiles, without touching game state. Pure; floats stay inside the estimate.
//
// What is real and what is replayed:
// - Tile order: the same priority queue as AttackExecution (a PseudoRandom(123), the same draw order,
//   (rand+10)*(1 - ownedByMe/2 + terrain/2) + tick), so the attack walks the defender's border the way
//   the engine would.
// - Per-tile losses: `Config.attackLogic` reads the defender's live troops and tile count, which the sim
//   must vary. We therefore call the real attackLogic twice per tile class (terrain x posts x fallout) at
//   two attack sizes, solve for its two internal coefficients (the ratio-scaled part and the density part)
//   and re-evaluate the same formula at the virtual troops/tiles. Posts, terrain, fallout, size debuffs
//   and traitor modifiers come from those real calls. The defender's size debuff is frozen at its
//   starting tile count (it moves by < 1 % over a single war).
// - Tiles per tick: `attackTilesPerTick` is a one-liner on the live troop ratio; replayed directly.
// - Defender regen (`reinforce`): `Config.troopIncreaseRate` is sampled once to get the player-type
//   multiplier and then re-evaluated per tick at the virtual troop count with the starting cap.
//
// Cost cap: at most MAX_TILES tiles are conquered (and at most 8x that dequeued — the queue holds duplicates,
// like the engine's); a war that has not resolved by then returns wins=false and the state so far. A 4000-tile
// war costs about 100k troops at the cheapest, so the cap only bites on estimates that were never affordable.

import { Game, Player, TerrainType, UnitType } from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import { PseudoRandom } from "../../PseudoRandom";
import { FlatBinaryHeap } from "../utils/FlatBinaryHeap";

export interface AttackEstimate {
  tilesTaken: number;
  attackerLoss: number;
  defenderLoss: number;
  ticks: number;
  troopsLeft: number;
  wins: boolean; // the defender's troops (or land) ran out before ours fell below `stopBelow`
}

export interface EstimateOptions {
  horizonTicks?: number; // default 3000 (5 minutes)
  stopBelow?: number; // stop when the attack's troops fall below this (default 1)
  reinforce?: boolean; // add the defender's troop regen per tick (default true)
}

export const MAX_TILES = 20_000; // conquered tiles per estimate; ~1 ms per 10k tiles on an M-series core

const RATIO_A = 1.0; // the two probe ratios (defender troops / attack troops), both inside within(0.6, 2)
const RATIO_B = 1.5;

function within(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Per tile-class coefficients: attackerLoss = 0.6 * within(D/A, 0.6, 2) * x + (D/T) * y; tilesPerTickUsed = within(D/(5A), 0.2, 1.5) * s */
interface TileClass {
  x: number;
  y: number;
  s: number;
}

export function estimateAttack(
  mg: Game,
  attacker: Player,
  defender: Player,
  troops: number,
  opts: EstimateOptions = {},
): AttackEstimate {
  const horizon = opts.horizonTicks ?? 3000;
  const stopBelow = opts.stopBelow ?? 1;
  const reinforce = opts.reinforce ?? true;
  const map = mg.map();
  const config = mg.config();
  const mine = attacker.smallID();
  const theirs = defender.smallID();

  let a = Math.floor(troops);
  let d = defender.troops();
  let t = defender.numTilesOwned();
  const d0 = d;
  const result: AttackEstimate = { tilesTaken: 0, attackerLoss: 0, defenderLoss: 0, ticks: 0, troopsLeft: a, wins: false };
  if (a < 1 || t === 0) return result;

  // regen: sample the real rate once to recover the player-type multiplier, re-evaluate on the virtual count
  const cap = config.maxTroops(defender);
  let regenMult = 0;
  if (reinforce && d0 > 0 && d0 < cap) {
    const base = (10 + Math.pow(d0, 0.73) / 4) * (1 - d0 / cap);
    regenMult = base > 0 ? config.troopIncreaseRate(defender) / base : 0;
  }
  const regen = (troopsNow: number) => {
    if (regenMult === 0 || troopsNow >= cap) return 0;
    return Math.floor(Math.min(cap - troopsNow, regenMult * (10 + Math.pow(troopsNow, 0.73) / 4) * (1 - troopsNow / cap)));
  };

  // per tile-class coefficients from two real attackLogic calls (the real calls read the live defender)
  const classes = new Map<number, TileClass>();
  const tileClass = (tile: TileRef): TileClass => {
    const key = map.terrainType(tile) * 2 + (map.hasFallout(tile) ? 1 : 0) + (posted(tile) ? 8 : 0);
    let c = classes.get(key);
    if (c !== undefined) return c;
    // only reached while d0 > 0: an empty defender ends the estimate before any tile is examined
    const r1 = config.attackLogic(mg, d0 / RATIO_A, attacker, defender, tile);
    const r2 = config.attackLogic(mg, d0 / RATIO_B, attacker, defender, tile);
    const x = (r2.attackerTroopLoss - r1.attackerTroopLoss) / (0.6 * (RATIO_B - RATIO_A));
    const density = r1.defenderTroopLoss; // = D0 / T0
    const y = density > 0 ? (r1.attackerTroopLoss - 0.6 * RATIO_A * x) / density : 0;
    const s = r2.tilesPerTickUsed / within(RATIO_B / 5, 0.2, 1.5);
    c = { x, y, s };
    classes.set(key, c);
    return c;
  };
  // defence posts: the same check attackLogic makes (any post of the defender within defensePostRange)
  const posts = defender.units(UnitType.DefensePost).map((u) => u.tile());
  const range2 = config.defensePostRange() ** 2;
  function posted(tile: TileRef): boolean {
    for (const p of posts) if (mg.euclideanDistSquared(p, tile) <= range2) return true;
    return false;
  }

  // the priority queue, seeded and ordered exactly like AttackExecution
  const random = new PseudoRandom(123);
  const heap = new FlatBinaryHeap();
  const border = new Set<TileRef>();
  const taken = new Set<TileRef>();
  const nbuf: TileRef[] = [0, 0, 0, 0];
  const nbuf2: TileRef[] = [0, 0, 0, 0];
  const ownedByMe = (tile: TileRef) => map.ownerID(tile) === mine || taken.has(tile);
  const ownedByThem = (tile: TileRef) => map.ownerID(tile) === theirs && !taken.has(tile);
  const tickNow = mg.ticks();
  let simTick = 0;
  const addNeighbors = (tile: TileRef) => {
    const n = map.neighbors4(tile, nbuf);
    for (let i = 0; i < n; i++) {
      const nb = nbuf[i];
      if (map.isWater(nb) || map.isImpassable(nb) || !ownedByThem(nb)) continue;
      border.add(nb);
      let numOwnedByMe = 0;
      const ni = map.neighbors4(nb, nbuf2);
      for (let j = 0; j < ni; j++) if (ownedByMe(nbuf2[j])) numOwnedByMe++;
      let mag: number;
      switch (map.terrainType(nb)) {
        case TerrainType.Plains: mag = 1; break;
        case TerrainType.Highland: mag = 1.5; break;
        case TerrainType.Mountain: mag = 2; break;
        default: mag = 0; break;
      }
      heap.enqueue(nb, (random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) + tickNow + simTick);
    }
  };
  for (const tile of attacker.borderTiles()) addNeighbors(tile);
  if (heap.size() === 0) return result; // no shared land border: nothing to take, wins=false

  let examined = 0;
  const finish = (wins: boolean): AttackEstimate => {
    result.ticks = simTick;
    result.troopsLeft = Math.max(0, a);
    result.attackerLoss = Math.floor(troops) - result.troopsLeft;
    result.wins = wins;
    return result;
  };
  while (simTick < horizon) {
    simTick++;
    if (reinforce) d += regen(d);
    if (d <= 0 || t < 100) return finish(true); // out of troops, or the engine hands over the remainder
    if (a < stopBelow) return finish(false);
    let perTick = within(((5 * a) / d) * 2, 0.01, 0.5) * (border.size + random.nextInt(0, 5)) * 3;
    while (perTick > 0) {
      if (a < 1) return finish(false);
      if (heap.size() === 0) return finish(result.tilesTaken > 0); // the front is exhausted: everything reachable is ours
      if (result.tilesTaken >= MAX_TILES || examined++ >= MAX_TILES * 8) return finish(false);
      const tile = heap.dequeue();
      border.delete(tile);
      if (!ownedByThem(tile)) continue;
      let onBorder = false;
      const n = map.neighbors4(tile, nbuf);
      for (let i = 0; i < n; i++) if (ownedByMe(nbuf[i])) { onBorder = true; break; }
      if (!onBorder || !map.isLand(tile) || map.isImpassable(tile)) continue;
      taken.add(tile);
      addNeighbors(tile);
      const c = tileClass(tile);
      const density = d / Math.max(1, t);
      const attackerLoss = d > 0 ? 0.6 * within(d / a, 0.6, 2) * c.x + density * c.y : 0;
      perTick -= (d > 0 ? within(d / (5 * a), 0.2, 1.5) : 0.2) * c.s;
      a -= attackerLoss;
      const dl = Math.floor(density); // Player.removeTroops floors
      d -= dl;
      result.defenderLoss += dl;
      t--;
      result.tilesTaken++;
    }
  }
  return finish(d <= 0);
}
